/// <reference types="@cloudflare/workers-types" />

import {
  getComandaSaldo,
  getItensComSaldo,
  computeWaterfallAllocations,
  type LedgerMetodo,
} from "../comandaLedger";
import { liberarReservaPedido, preparePedidoPhysicalProjection } from "../stock";
import { postPagamentoMp } from "../mpPost";
import { chargeableCapacitySql, financialChargeSlotKey, liveAdminPixPredicate } from "../financialCoverage";
import {
  buscarOperacao,
  chaveMp,
  chavePagamento,
  fingerprint,
  fontePagamento,
  parseOperationKey,
  prepareClaimOperacao,
  prepareRegistrarFase,
  registrarFase,
  FINGERPRINT_VERSAO,
  type IdentidadeEsperada,
} from "../operacoes";
import { temEstornoAnulacaoAtivo } from "../pedidoAnulacao";
import { replayPixAdmin } from "./replay";
import { regenerateAdminPix } from "./adminRegenerate";
import type {
  GerarPixAdminParams,
  GerarPixAdminSucesso,
  GerarPixAdminResult,
} from "./types";
import { getCapacidadeCobravel } from "./queries";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface PedidoParaPix {
  id: number;
  valor_total_centavos: number;
  status_comanda: string;
  status_pedido: string;
  reserva_status: string;
  cliente_nome: string;
  cliente_whatsapp: string;
}

interface PedidoItemParaReserva {
  id: number;
  produto_id: number | null;
  quantidade: number;
  status_item: string;
  estoque_estado: string;
}

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
const CAPACIDADE_COBRAVEL_SQL = chargeableCapacitySql("?");

export async function createAdminPixCharge(
  env: Env,
  params: GerarPixAdminParams,
): Promise<GerarPixAdminResult> {
  const db = env.DB;

  // A1 — identidade da intenção, antes de qualquer guard de estado.
  // Regeneração é uma operação PRÓPRIA (tipo distinto): uma nova
  // regeneração iniciada explicitamente pelo usuário recebe uma key nova; o
  // retry da mesma regeneração recupera o MESMO sucessor, mesmo que ele
  // já tenha expirado depois.
  let operationKey: string | null = null;
  let identidade: IdentidadeEsperada | null = null;
  if (params.operationKey != null) {
    const parsed = parseOperationKey(params.operationKey);
    if (!parsed.ok) return { ok: false, erro: parsed.erro };
    operationKey = parsed.key;
    identidade = {
      tipo: params.substituiId == null ? "PIX_ADMIN" : "PIX_ADMIN_REGENERACAO",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      // `valorCentavos` ausente = "modo automático" (capacidade cheia). O
      // valor resolvido é congelado no pagamento persistido, então o retry
      // NÃO recalcula uma cobrança diferente porque a capacidade mudou.
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        valorCentavos: params.valorCentavos ?? null,
        substituiId: params.substituiId ?? null,
      }),
    };

    const existente = await buscarOperacao(db, operationKey);
    if (existente) return await replayPixAdmin(db, existente, identidade);
  } else if (params.substituiId != null) {
    operationKey = crypto.randomUUID();
    identidade = {
      tipo: "PIX_ADMIN_REGENERACAO",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        valorCentavos: params.valorCentavos ?? null,
        substituiId: params.substituiId ?? null,
      }),
    };
  }

  const pedido = await db
    .prepare(
      `SELECT id, valor_total_centavos, status_comanda, status_pedido, reserva_status, cliente_nome, cliente_whatsapp
       FROM pedidos WHERE id = ?`,
    )
    .bind(params.pedidoId)
    .first<PedidoParaPix>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  const liquidacaoAposEntrega = pedido.status_pedido === "ENTREGUE";
  if (
    pedido.status_pedido === "CANCELADO" ||
    (pedido.status_comanda !== "ABERTA" && !liquidacaoAposEntrega)
  ) {
    return { ok: false, erro: "COMANDA_ENCERRADA" };
  }
  if (await temEstornoAnulacaoAtivo(db, params.pedidoId)) {
    return { ok: false, erro: "ESTORNO_ANULACAO_ATIVO" };
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
           AND ${liveAdminPixPredicate("a")}`,
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

  // Itens BAIXADOS pertencem ao histórico físico e nunca voltam para a
  // reserva. Em uma comanda viva, o pedido pode legitimamente misturar
  // BAIXADO (compra anterior) e RESERVADO (item recém-adicionado).
  const { results: itensReserva } = await db
    .prepare(`SELECT id, produto_id, quantidade, status_item, estoque_estado
              FROM pedido_itens WHERE pedido_id = ?`)
    .bind(params.pedidoId)
    .all<PedidoItemParaReserva>();
  const itensControlados = (itensReserva || []).filter(
    (i) => i.produto_id !== null && i.status_item === "ATIVO",
  );
  // Preparamos o CAS também para itens que a leitura viu RESERVADOS. Se uma
  // expiração liberar a reserva entre esta leitura e o batch, a mesma
  // transação da cobrança consegue readquiri-la. Se nada mudou, os UPDATEs
  // ficam em changes=0 e a reserva preexistente permanece intocada.
  // ENTREGUE fecha a comanda pelo trigger operacional. A liquidação do
  // saldo pode gerar um Pix, mas nunca reabre ou readquire reserva: a
  // reconciliação financeira continua sendo a única responsável pela
  // baixa física quando o provedor confirmar o pagamento.
  const itensParaReserva = liquidacaoAposEntrega
    ? []
    : itensControlados.filter((i) => i.estoque_estado !== "BAIXADO");

  // A1: derivada da operation key quando existe — o UNIQUE parcial de
  // `pedido_pagamentos.idempotency_key` garante at-most-once da tentativa.
  // Quando duas cobrancas deste mesmo valor nao cabem juntas, ambas disputam
  // um slot derivado da mesma revisao do ledger. O UNIQUE existente torna a
  // decisao atomica mesmo se as duas lerem a capacidade anterior ao mesmo tempo.
  // Valores que cabem de forma aditiva preservam tentativas independentes.
  const disputaCapacidade = valorCentavos * 2 > capacidadePrevia;
  const idempotencyKey = disputaCapacidade
    ? await financialChargeSlotKey(db, params.pedidoId, "pix")
    : operationKey ? chavePagamento(operationKey) : crypto.randomUUID();
  const externalReference = idempotencyKey; // trava 2: identidade inequívoca por tentativa, nunca token_publico
  // Key MP estável por operação lógica: timeout, 5xx ou resposta local
  // perdida NUNCA geram uma key nova (era a causa de um segundo POST lógico
  // com outra identidade).
  const mpIdempotencyKey = operationKey ? chaveMp(operationKey) : idempotencyKey;

  const whatsappDigits = pedido.cliente_whatsapp.replace(/\D/g, "") || "cliente";
  const payerEmail = `${whatsappDigits}@checkout.rpdoces.com.br`;
  const expiresAtEstimado = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  // Conteúdo original do POST, persistido junto com o claim (antes do
  // envio): preserva valor resolvido, expiração, referência externa e dados
  // do pagador necessários para que a MESMA operação possa ser reconhecida
  // com segurança depois de um resultado ambíguo.
  const mpRequest = {
    transaction_amount: valorCentavos / 100,
    description: "Pedido R&P Doces",
    payment_method_id: "pix",
    date_of_expiration: expiresAtEstimado,
    external_reference: externalReference,
    payer: { email: payerEmail, first_name: pedido.cliente_nome.slice(0, MAX_TEXT_LENGTH) },
  };

  // Ordem importa: os incrementos de estoque_reservado (se houver) e o
  // flip de reserva_status precisam rodar ANTES do INSERT do pagamento,
  // guardados pela condição de reserva adquirível reavaliada no
  // início desta transação — nunca o estado pós-flip da própria transação.
  // Isso é o que torna o re-reserve seguro contra duas gerações
  // concorrentes no mesmo pedido órfão: a segunda a commitar já vê
  // `reserva_status='ATIVA'` (gravado pela primeira) e vira no-op, nunca
  // um segundo incremento de estoque_reservado.
  const reservaStatements = itensParaReserva.flatMap((item) => [
    db.prepare(`
      UPDATE produtos
      SET estoque_reservado = estoque_reservado + ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM pedido_itens pi JOIN pedidos p ON p.id = pi.pedido_id
          WHERE pi.id = ? AND pi.pedido_id = ? AND pi.produto_id = produtos.id
            AND pi.status_item = 'ATIVO'
            AND pi.estoque_estado IN ('SEM_RESERVA', 'LIBERADO', 'REPOSTO')
            AND p.status_comanda = 'ABERTA'
            AND p.reserva_status IN ('SEM_RESERVA', 'LIBERADA', 'ATIVA')
            AND p.estoque_baixado_em IS NULL
            AND pi.estoque_baixado_em IS NULL
        )
    `).bind(item.quantidade, item.produto_id, item.id, params.pedidoId),
    db.prepare(`
      UPDATE pedido_itens
      SET estoque_estado = 'RESERVADO',
          estoque_reservado_em = CURRENT_TIMESTAMP,
          estoque_liberado_em = NULL,
          estoque_reposto_em = NULL
      WHERE id = ? AND pedido_id = ? AND produto_id = ? AND quantidade = ?
        AND status_item = 'ATIVO'
        AND estoque_estado IN ('SEM_RESERVA', 'LIBERADO', 'REPOSTO')
        AND estoque_baixado_em IS NULL
        AND EXISTS (SELECT 1 FROM pedidos p
                    WHERE p.id = pedido_itens.pedido_id
                      AND p.status_comanda = 'ABERTA'
                      AND p.reserva_status IN ('SEM_RESERVA', 'LIBERADA', 'ATIVA')
                      AND p.estoque_baixado_em IS NULL)
    `).bind(item.id, params.pedidoId, item.produto_id, item.quantidade),
  ]);

  // R3 — Fluxo robusto de REGENERAÇÃO administrativa com cancelamento remoto do predecessor A
  if (substituiId !== null) {
    if (!operationKey || !identidade) {
      return { ok: false, erro: "OPERATION_KEY_INVALIDA" };
    }

    // 1. Claim A1 antes de qualquer chamada remota ao Mercado Pago.
    // O índice único parcial uq_pedido_operacoes_regeneracao_ativa serializa
    // duas operações ativas sobre o mesmo pagamento predecessor A.
    try {
      await db
        .prepare(
          `INSERT INTO pedido_operacoes (
             operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
             fase, mp_idempotency_key, mp_request, pedido_id, pagamento_id
           )
           VALUES (?, ?, ?, ?, ?, ?, 'LOCAL_CRIADA', ?, ?, ?, ?)`,
        )
        .bind(
          operationKey,
          identidade.tipo,
          identidade.escopo,
          identidade.atorUsuarioId,
          FINGERPRINT_VERSAO,
          identidade.fingerprint,
          mpIdempotencyKey,
          JSON.stringify(mpRequest),
          params.pedidoId,
          substituiId,
        )
        .run();
    } catch {
      const existente = await buscarOperacao(db, operationKey);
      if (existente) return await replayPixAdmin(db, existente, identidade);
      return { ok: false, erro: "OPERACAO_EM_PROCESSAMENTO" };
    }

    return await regenerateAdminPix({
      env,
      pedidoId: params.pedidoId,
      usuarioId: params.usuarioId,
      substituiId,
      operationKey,
      valorCentavos,
      idempotencyKey,
      mpIdempotencyKey,
      mpRequest,
      reservaStatements,
      waterfall,
    });
  }

  const statements = [
    ...reservaStatements,
    preparePedidoPhysicalProjection(db, params.pedidoId),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, idempotency_key, substitui_pagamento_id
         )
         SELECT ?, ?, 'ADMIN', ?, 'PENDENTE', ?, ?, ?
         WHERE ? <= ${CAPACIDADE_COBRAVEL_SQL}
           AND EXISTS (
             SELECT 1 FROM pedidos
             WHERE id = ?
               AND status_pedido <> 'CANCELADO'
               AND (status_comanda = 'ABERTA' OR status_pedido = 'ENTREGUE')
               AND (
                 status_pedido = 'ENTREGUE'
                 OR NOT EXISTS (
                   SELECT 1 FROM pedido_itens pi
                   WHERE pi.pedido_id = pedidos.id
                     AND pi.status_item = 'ATIVO' AND pi.produto_id IS NOT NULL
                     AND pi.estoque_estado NOT IN ('RESERVADO', 'BAIXADO')
                 )
               )
           )
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
    // Claim A1 por último e condicionado à tentativa recém-criada: se o CAS
    // de capacidade/substituição recusou, nada é registrado. Mesmo batch,
    // mesma transação: claim, reserva, pagamento e alocações são atômicos.
    ...(operationKey && identidade
      ? [
          prepareClaimOperacao(db, {
            key: operationKey,
            ...identidade,
            fase: "LOCAL_CRIADA",
            mpIdempotencyKey,
            mpRequest: JSON.stringify(mpRequest),
            fonte: fontePagamento(idempotencyKey),
          }),
        ]
      : []),
  ];

  let batchResults;
  try {
    batchResults = await db.batch(statements);
  } catch (err) {
    // Disputa da mesma key: o batch do perdedor foi revertido inteiro
    // (nenhuma reserva, nenhuma tentativa, nenhum POST) e ele recupera a
    // operação vencedora em vez de criar um segundo Pix.
    if (operationKey && identidade) {
      const vencedora = await buscarOperacao(db, operationKey);
      if (vencedora) return await replayPixAdmin(db, vencedora, identidade);
    }
    if (disputaCapacidade) {
      const slotVencedor = await db.prepare(`SELECT 1 FROM pedido_pagamentos
        WHERE idempotency_key=? LIMIT 1`).bind(idempotencyKey).first();
      if (slotVencedor) return { ok: false, erro: "CAPACIDADE_INSUFICIENTE" };
    }
    if (String((err as Error)?.message || "").includes("CHECK")) {
      return { ok: false, erro: "ESTOQUE_INSUFICIENTE" };
    }
    throw err;
  }

  const reservaProjectionIndex = reservaStatements.length;
  const pagamentoStmtIndex = reservaProjectionIndex + 1;
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
    itensParaReserva.length > 0
    && reservaStatements.every(
      (_, index) => Number(batchResults[index]?.meta?.changes || 0) === 1,
    );

  const envio = await postPagamentoMp(env.MP_ACCESS_TOKEN, mpIdempotencyKey, mpRequest);

  if (envio.resultado === "AMBIGUO") {
    // Resultado AMBÍGUO (transporte, timeout, 5xx/408/429, corpo ilegível):
    // não sabemos se o MP chegou a criar a cobrança. Ledger fica PENDENTE
    // (não FALHOU) e a reserva NÃO é tocada — marcar qualquer um dos dois
    // aqui seria mentira. Antes do A1, um 5xx caía no mesmo caminho da
    // recusa comprovada. Reconciliação (webhook ou oportunista) resolve
    // depois; um retry com a MESMA key recupera esta operação.
    console.error("Resultado ambíguo ao criar Pix administrativo", {
      pedidoId: params.pedidoId,
      motivo: envio.motivo,
      httpStatus: envio.httpStatus,
    });
    if (operationKey) {
      await registrarFase(db, operationKey, {
        fase: "ENVIO_INCONCLUSIVO",
        erro: `AMBIGUO:${envio.motivo}`,
      });
    }
    return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    // Rejeição COMPROVADAMENTE definitiva.
    console.error("Mercado Pago recusou Pix administrativo", envio.httpStatus, envio.mensagem);

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

    if (operationKey) {
      await registrarFase(db, operationKey, {
        fase: "RECUSADA",
        erro: `RECUSA_DEFINITIVA:${envio.httpStatus}`,
      });
    }

    return { ok: false, erro: "MERCADO_PAGO_RECUSOU" };
  }

  const payment = envio.payment;
  const txData = payment.point_of_interaction?.transaction_data;

  const reservaExpiraEmSincronizada = payment.date_of_expiration
    ? new Date(Date.parse(payment.date_of_expiration) + 60_000).toISOString()
    : null;

  const sucesso: GerarPixAdminSucesso = {
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

  // Identidade remota e resultado gravados no MESMO batch da persistência
  // local: ou `pedido_pagamentos.mp_payment_id`/QR e a fase
  // `REMOTO_CONHECIDO` nascem juntos, ou nada nasce. Antes, a fase era
  // gravada em write separado e um crash entre os dois deixava a operação
  // `REMOTO_CONHECIDO` com `pedido_pagamentos.mp_payment_id` NULL — estado
  // que nenhum sweep recuperava (a busca read-only exige
  // `mp_payment_id IS NULL` e exclui `REMOTO_CONHECIDO`).
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
    ...(operationKey
      ? [
          prepareRegistrarFase(db, operationKey, {
            fase: "REMOTO_CONHECIDO",
            mpPaymentId: String(payment.id),
            resultado: JSON.stringify(sucesso),
          }),
        ]
      : []),
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

  if (operationKey) {
    await registrarFase(db, operationKey, { fase: "CONCLUIDA" });
  }

  return sucesso;
}
