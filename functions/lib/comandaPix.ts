/// <reference types="@cloudflare/workers-types" />

// Pix administrativo (geração e regeneração pelo admin, fora do checkout do
// cliente) — Payments API, não Orders API (produção usa Orders API; decisão
// deliberada de não copiar de carona, documentada no README). Cancelamento
// autônomo (sem substituto) fica fora de escopo: a Payments API não tem
// cancelamento real de Pix pendente, então essa ação só faria sentido como
// "esconder da UI sem substituir" — semanticamente estranho sem um Pix novo.
//
// external_reference: SITE continua usando `token_publico` do pedido
// (checkout.ts intocado). ADMIN usa o `idempotency_key` da própria
// tentativa de pagamento — único por natureza (índice único já existe,
// migration 0008), o que evita a ambiguidade que `token_publico` teria
// assim que dois Pix administrativos coexistirem no mesmo pedido.
// `resolveWebhookPayment` (paymentSync.ts) aprende os dois formatos sem
// alterar o caminho SITE.

import {
  getComandaSaldo,
  getItensComSaldo,
  computeWaterfallAllocations,
  type LedgerMetodo,
} from "./comandaLedger";
import { liberarReservaPedido } from "./stock";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface PedidoParaPix {
  id: number;
  valor_total_centavos: number;
  status_comanda: string;
  reserva_status: string;
  cliente_nome: string;
  cliente_whatsapp: string;
}

interface PedidoItemParaReserva {
  id: number;
  produto_id: number | null;
  quantidade: number;
}

export interface GerarPixAdminParams {
  pedidoId: number;
  valorCentavos?: number;
  usuarioId: number;
  /** Regeneração: id do Pix administrativo sendo substituído. `undefined`/`null` = geração normal. */
  substituiId?: number | null;
}

export interface GerarPixAdminSucesso {
  ok: true;
  pagamentoId: number;
  valorCentavos: number;
  mpPaymentId: string;
  mpStatus: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

export interface GerarPixAdminFalha {
  ok: false;
  erro:
    | "PEDIDO_NAO_ENCONTRADO"
    | "COMANDA_ENCERRADA"
    | "PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO"
    | "VALOR_INVALIDO"
    | "CAPACIDADE_INSUFICIENTE"
    | "PIX_PARA_SUBSTITUIR_INVALIDO"
    | "ESTOQUE_INSUFICIENTE"
    | "MERCADO_PAGO_RECUSOU"
    | "MERCADO_PAGO_INDISPONIVEL";
}

export type GerarPixAdminResult = GerarPixAdminSucesso | GerarPixAdminFalha;

const METODO_PIX: LedgerMetodo = "PIX_MP";
const PIX_EXPIRATION_MINUTES = 30;
const MAX_TEXT_LENGTH = 200;

// "Quanto ainda podemos transformar em cobrança Pix nova" — não confundir
// com saldo financeiro devido. Todo PIX_MP/ADMIN/PENDENTE ainda ATIVO
// (nenhum outro pagamento aponta `substitui_pagamento_id` pra ele) já
// consome parte dessa capacidade, mesmo sem ter sido pago ainda: dois QR
// codes simultaneamente pagáveis somando mais que o saldo devido é
// exatamente o oversell financeiro que essa conta impede.
//
// `substituiId`: null numa geração normal; numa regeneração, é o id do Pix
// sendo substituído — precisa ser excluído da soma mesmo antes de o
// substituto existir, porque o `NOT EXISTS` sozinho não conseguiria
// reconhecer uma substituição que está sendo criada no mesmo INSERT (o
// substituto ainda não tem linha na tabela no instante em que o `WHERE` é
// avaliado).
//
// "Já tem substituto" só conta se o substituto estiver VIVO
// (`PENDENTE`/`PAGO`) — nunca um substituto que morreu (`FALHOU`/
// `CANCELADO`/`EXPIRADO`). Sem esse filtro de status, uma regeneração
// rejeitada pelo Mercado Pago trancaria o Pix original pra sempre: ele
// ficaria excluído da capacidade e "já substituído" indefinidamente, mesmo
// o substituto nunca tendo virado dinheiro nem QR válido — o pedido
// ficaria sem nenhum Pix administrativo utilizável.
const SUCESSOR_VIVO = `NOT EXISTS (
  SELECT 1 FROM pedido_pagamentos sub
  WHERE sub.substitui_pagamento_id = %ALVO%
    AND sub.status IN ('PENDENTE', 'PAGO')
)`;

const CAPACIDADE_COBRAVEL_SQL = `(
  SELECT p.valor_total_centavos
    - COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id = p.id AND status = 'PAGO'), 0)
    - COALESCE((
        SELECT SUM(pp.valor_centavos) FROM pedido_pagamentos pp
        WHERE pp.pedido_id = p.id AND pp.metodo = 'PIX_MP' AND pp.origem = 'ADMIN' AND pp.status = 'PENDENTE'
          AND pp.id != COALESCE(?, -1)
          AND ${SUCESSOR_VIVO.replace("%ALVO%", "pp.id")}
      ), 0)
  FROM pedidos p WHERE p.id = ?
)`;

export async function getCapacidadeCobravel(
  db: D1Database,
  pedidoId: number,
  substituiId: number | null = null,
): Promise<number> {
  const row = await db
    .prepare(`SELECT ${CAPACIDADE_COBRAVEL_SQL} AS capacidade`)
    .bind(substituiId, pedidoId)
    .first<{ capacidade: number }>();
  return Math.max(0, Number(row?.capacidade || 0));
}

export interface PixAdminPendente {
  id: number;
  valorCentavos: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

interface PixAdminPendenteRow {
  id: number;
  valor_centavos: number;
  mp_qr_code: string | null;
  mp_qr_code_base64: string | null;
  mp_ticket_url: string | null;
  pix_expira_em: string | null;
}

// Leitura pura — nenhuma escrita, nenhuma decisão financeira nova. Reaproveita
// a MESMA definição de "ainda vivo" usada pela regeneração (SUCESSOR_VIVO):
// um pedido pode legitimamente ter vários PIX_MP/ADMIN/PENDENTE simultâneos
// (Pix parciais aditivos, não uma cadeia de substituição entre si) — por
// isso é uma LISTA, nunca "o mais recente". `expiresAt` vencido não é
// escondido/filtrado aqui: só o backend/reconciliação (paymentSync.ts) tem
// autoridade para transicionar PENDENTE -> EXPIRADO; esta função devolve o
// que o ledger diz agora, sem inventar estado.
export async function getPixAdminPendentesAtivos(
  db: D1Database,
  pedidoId: number,
): Promise<PixAdminPendente[]> {
  const { results } = await db
    .prepare(
      `SELECT id, valor_centavos, mp_qr_code, mp_qr_code_base64, mp_ticket_url, pix_expira_em
       FROM pedido_pagamentos pp
       WHERE pp.pedido_id = ? AND pp.metodo = 'PIX_MP' AND pp.origem = 'ADMIN' AND pp.status = 'PENDENTE'
         AND ${SUCESSOR_VIVO.replace("%ALVO%", "pp.id")}
       ORDER BY id ASC`,
    )
    .bind(pedidoId)
    .all<PixAdminPendenteRow>();

  return (results || []).map((r) => ({
    id: r.id,
    valorCentavos: r.valor_centavos,
    qrCode: r.mp_qr_code,
    qrCodeBase64: r.mp_qr_code_base64,
    ticketUrl: r.mp_ticket_url,
    expiresAt: r.pix_expira_em,
  }));
}

export async function createAdminPixCharge(
  env: Env,
  params: GerarPixAdminParams,
): Promise<GerarPixAdminResult> {
  const db = env.DB;

  const pedido = await db
    .prepare(
      `SELECT id, valor_total_centavos, status_comanda, reserva_status, cliente_nome, cliente_whatsapp
       FROM pedidos WHERE id = ?`,
    )
    .bind(params.pedidoId)
    .first<PedidoParaPix>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  if (pedido.status_comanda !== "ABERTA") return { ok: false, erro: "COMANDA_ENCERRADA" };

  // Mesma limitação explícita e temporária do Passo 5 usada em
  // registerAdminPayment: com reembolso confirmado, a leitura de saldo por
  // item (getItensComSaldo) ainda não sabe reabrir a alocação parcialmente
  // devolvida — preferível recusar a criar uma alocação sutilmente errada.
  const temReembolso = await db
    .prepare(`SELECT 1 FROM pedido_reembolsos WHERE pedido_id = ? AND status = 'REEMBOLSADO' LIMIT 1`)
    .bind(params.pedidoId)
    .first();
  if (temReembolso) {
    const saldoAtual = await getComandaSaldo(db, params.pedidoId);
    if (saldoAtual.pago < saldoAtual.total) {
      return { ok: false, erro: "PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO" };
    }
  }

  const substituiId = params.substituiId ?? null;

  // Pré-checagem só pra UX (mensagem de erro cedo, antes de montar o
  // batch) — a proteção real contra corrida é a condição idêntica
  // reavaliada atomicamente dentro do próprio INSERT, mais abaixo. Duas
  // regenerações do mesmo A simultâneas NUNCA podem ambas suceder: a
  // condição de "A ainda é substituível" (pertence a este pedido, é
  // PIX_MP/ADMIN/PENDENTE, e ninguém mais já o substituiu) precisa valer
  // no instante exato da escrita, não apenas neste SELECT anterior.
  if (substituiId !== null) {
    const substituivel = await db
      .prepare(
        `SELECT 1 FROM pedido_pagamentos a
         WHERE a.id = ? AND a.pedido_id = ? AND a.metodo = 'PIX_MP' AND a.origem = 'ADMIN' AND a.status = 'PENDENTE'
           AND ${SUCESSOR_VIVO.replace("%ALVO%", "a.id")}`,
      )
      .bind(substituiId, params.pedidoId)
      .first();
    if (!substituivel) return { ok: false, erro: "PIX_PARA_SUBSTITUIR_INVALIDO" };
  }

  // Leitura prévia só pra UX (mensagem de erro cedo / default de valor) —
  // a proteção real é o CAS na escrita, avaliado de novo no INSERT abaixo.
  const capacidadePrevia = await getCapacidadeCobravel(db, params.pedidoId, substituiId);
  const valorCentavos = params.valorCentavos ?? capacidadePrevia;
  if (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0) {
    return { ok: false, erro: "VALOR_INVALIDO" };
  }
  if (valorCentavos > capacidadePrevia) {
    return { ok: false, erro: "CAPACIDADE_INSUFICIENTE" };
  }

  const itens = await getItensComSaldo(db, params.pedidoId);
  const waterfall = computeWaterfallAllocations(itens, valorCentavos);
  if (!waterfall.ok) return { ok: false, erro: "VALOR_INVALIDO" };

  // Reserva ainda ATIVA na escrita não é recriada nem tem TTL renovado.
  // A leitura inicial pode perder uma corrida para a liberação. Sempre
  // preparamos a aquisição; somente os guards no batch decidem se ela ocorre.
  const { results: itensReserva } = await db
    .prepare(`SELECT id, produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?`)
    .bind(params.pedidoId)
    .all<PedidoItemParaReserva>();
  const itensParaReserva = (itensReserva || []).filter((i) => i.produto_id !== null);
  const podeAdquirirReserva = `reserva_status IN ('SEM_RESERVA', 'LIBERADA') AND estoque_baixado_em IS NULL
    AND NOT EXISTS (SELECT 1 FROM pedido_itens pi WHERE pi.pedido_id = pedidos.id AND pi.estoque_baixado_em IS NOT NULL)`;

  const idempotencyKey = crypto.randomUUID();
  const externalReference = idempotencyKey; // trava 2: identidade inequívoca por tentativa, nunca token_publico

  // Ordem importa: os incrementos de estoque_reservado (se houver) e o
  // flip de reserva_status precisam rodar ANTES do INSERT do pagamento,
  // guardados pela condição de reserva adquirível reavaliada no
  // início desta transação — nunca o estado pós-flip da própria transação.
  // Isso é o que torna o re-reserve seguro contra duas gerações
  // concorrentes no mesmo pedido órfão: a segunda a commitar já vê
  // `reserva_status='ATIVA'` (gravado pela primeira) e vira no-op, nunca
  // um segundo incremento de estoque_reservado.
  const statements = [
    ...itensParaReserva.map((item) =>
      db
        .prepare(
          `UPDATE produtos SET estoque_reservado = estoque_reservado + ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND EXISTS (SELECT 1 FROM pedidos WHERE id = ? AND ${podeAdquirirReserva})`,
        )
        .bind(item.quantidade, item.produto_id, params.pedidoId),
    ),
    db
      .prepare(
        `UPDATE pedidos SET reserva_status = 'ATIVA', reserva_expira_em = datetime('now', '+31 minutes'),
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND ${podeAdquirirReserva}`,
      )
      .bind(params.pedidoId),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, idempotency_key, substitui_pagamento_id
         )
         SELECT ?, ?, 'ADMIN', ?, 'PENDENTE', ?, ?, ?
         WHERE ? <= ${CAPACIDADE_COBRAVEL_SQL}
           AND EXISTS (SELECT 1 FROM pedidos WHERE id = ? AND reserva_status = 'ATIVA' AND estoque_baixado_em IS NULL
             AND NOT EXISTS (SELECT 1 FROM pedido_itens pi WHERE pi.pedido_id = pedidos.id AND pi.estoque_baixado_em IS NOT NULL))
           AND (
             ? IS NULL
             OR (
               EXISTS (
                 SELECT 1 FROM pedido_pagamentos a
                 WHERE a.id = ? AND a.pedido_id = ? AND a.metodo = 'PIX_MP' AND a.origem = 'ADMIN' AND a.status = 'PENDENTE'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM pedido_pagamentos suc
                 WHERE suc.substitui_pagamento_id = ? AND suc.status IN ('PENDENTE', 'PAGO')
               )
             )
           )`,
      )
      .bind(
        params.pedidoId,
        METODO_PIX,
        valorCentavos,
        params.usuarioId,
        idempotencyKey,
        substituiId,
        valorCentavos,
        substituiId,
        params.pedidoId,
        params.pedidoId,
        substituiId,
        substituiId,
        params.pedidoId,
        substituiId,
      ),
    ...waterfall.alocacoes.map((a) =>
      db
        .prepare(
          `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
           SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), ?, ?`,
        )
        .bind(idempotencyKey, a.itemId, a.valorCentavos),
    ),
  ];

  let batchResults;
  try {
    batchResults = await db.batch(statements);
  } catch (err) {
    if (String((err as Error)?.message || "").includes("CHECK")) {
      return { ok: false, erro: "ESTOQUE_INSUFICIENTE" };
    }
    throw err;
  }

  const reservaFlipIndex = itensParaReserva.length;
  const pagamentoStmtIndex = itensParaReserva.length + 1;
  const pagamentoId = Number(batchResults[pagamentoStmtIndex]?.meta?.last_row_id || 0);
  if (!pagamentoId) {
    // CAS na escrita recusou: outra requisição consumiu a capacidade ou (numa
    // regeneração) já substituiu o mesmo `substituiId` entre nossa leitura e
    // o commit. Nada foi gravado (rollback do batch inteiro). Não dá pra
    // distinguir as duas causas só pelo resultado do INSERT — quando havia
    // um `substituiId`, essa é a causa mais provável e mais acionável pro
    // admin (a fila é "quem pediu para substituir A primeiro"), então é o
    // erro reportado nesse caso.
    return { ok: false, erro: substituiId !== null ? "PIX_PARA_SUBSTITUIR_INVALIDO" : "CAPACIDADE_INSUFICIENTE" };
  }

  // Só "dona" da reserva se ESTA transação genuinamente a criou (changes=1
  // no flip) — se outra geração concorrente já tinha feito isso primeiro
  // (changes=0), esta operação não pode compensar aquela reserva numa
  // falha do MP a seguir, porque não foi ela quem a adquiriu.
  const reservaCriadaPorEstaOperacao =
    Number(batchResults[reservaFlipIndex]?.meta?.changes || 0) === 1;

  const whatsappDigits = pedido.cliente_whatsapp.replace(/\D/g, "") || "cliente";
  const payerEmail = `${whatsappDigits}@checkout.rpdoces.com.br`;
  const expiresAtEstimado = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  let mpResponse: Response;
  try {
    mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: valorCentavos / 100,
        description: "Pedido R&P Doces",
        payment_method_id: "pix",
        date_of_expiration: expiresAtEstimado,
        external_reference: externalReference,
        payer: { email: payerEmail, first_name: pedido.cliente_nome.slice(0, MAX_TEXT_LENGTH) },
      }),
    });
  } catch (err) {
    // Transporte nunca resolveu — resultado AMBÍGUO, não sabemos se o MP
    // chegou a criar a cobrança. Ledger fica PENDENTE (não FALHOU) e a
    // reserva (se criada agora) NÃO é tocada: marcar qualquer um dos dois
    // aqui seria mentira. Reconciliação (webhook ou oportunista) resolve
    // depois, do mesmo jeito que o checkout do site já lida com isso.
    console.error("Erro de transporte ao chamar o Mercado Pago (Pix administrativo)", err);
    return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
  }

  if (!mpResponse.ok) {
    // Rejeição definitiva e conhecida (não ambígua).
    const errorBody = await mpResponse.text();
    console.error("Mercado Pago recusou Pix administrativo", mpResponse.status, errorBody);

    await db
      .prepare(
        `UPDATE pedido_pagamentos SET status = 'FALHOU', atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDENTE'`,
      )
      .bind(pagamentoId)
      .run();

    // Só desfaz a reserva se ESTA operação a criou — uma reserva ATIVA
    // preexistente do pedido (ou criada por outra geração concorrente)
    // nunca é liberada por esta falha.
    if (reservaCriadaPorEstaOperacao) {
      await liberarReservaPedido(db, params.pedidoId);
    }

    return { ok: false, erro: "MERCADO_PAGO_RECUSOU" };
  }

  const payment = (await mpResponse.json()) as {
    id: number;
    status: string;
    date_of_expiration: string | null;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    };
  };
  const txData = payment.point_of_interaction?.transaction_data;

  const reservaExpiraEmSincronizada = payment.date_of_expiration
    ? new Date(Date.parse(payment.date_of_expiration) + 60_000).toISOString()
    : null;

  const statementsPosSucesso = [
    db
      .prepare(
        `UPDATE pedido_pagamentos
         SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
             mp_ticket_url = ?, pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        String(payment.id),
        payment.status,
        txData?.qr_code ?? null,
        txData?.qr_code_base64 ?? null,
        txData?.ticket_url ?? null,
        payment.date_of_expiration,
        pagamentoId,
      ),
  ];
  // pedidos.mp_payment_id/mp_qr_code/etc NUNCA são gravados aqui de
  // propósito: esses campos são do modelo legado de 1-Pix-por-pedido do
  // checkout do site; com múltiplos Pix administrativos possíveis por
  // pedido, qual deles "seria o" QR do pedido deixaria de ter resposta
  // única. Toda informação de um Pix administrativo mora só em
  // `pedido_pagamentos`. Só `reserva_expira_em` (pedido-level de verdade)
  // é sincronizado, e só quando esta operação foi quem criou a reserva.
  if (reservaCriadaPorEstaOperacao && reservaExpiraEmSincronizada) {
    statementsPosSucesso.push(
      db
        .prepare(`UPDATE pedidos SET reserva_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(reservaExpiraEmSincronizada, params.pedidoId),
    );
  }
  await db.batch(statementsPosSucesso);

  return {
    ok: true,
    pagamentoId,
    valorCentavos,
    mpPaymentId: String(payment.id),
    mpStatus: payment.status,
    qrCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
    ticketUrl: txData?.ticket_url ?? null,
    expiresAt: payment.date_of_expiration,
  };
}
