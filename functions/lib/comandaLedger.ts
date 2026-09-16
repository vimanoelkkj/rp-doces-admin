/// <reference types="@cloudflare/workers-types" />

// Passo 4b: materialização lazy de pagamentos legados em `pedido_pagamentos`
// + leitura (real ou virtual) sem nunca escrever no caminho de leitura.
//
// Porta fiel de `ensureLegacyPaymentMaterialized`/`legacyPayment` de
// produção (functions/lib/comandaLedger.js e orderLedger.js), com duas
// diferenças deliberadas documentadas no relatório do 4b:
//   1) `pedidos.status_pagamento = 'PARCIAL'` é recusado explicitamente
//      (produção nunca precisou lidar com isso, pois só passou a existir
//      depois que removemos o CHECK no 4a).
//   2) nosso `pedidos` não tem as colunas `metodo_pagamento` nem
//      `mp_order_id`/`mp_status_detail` (checkout ainda é Pix-only via
//      Payments API) — `metodo` é inferido pela presença de `mp_payment_id`
//      em vez de lido de uma coluna que não existe.

export type LedgerStatus =
  | "PENDENTE"
  | "PAGO"
  | "CANCELADO"
  | "EXPIRADO"
  | "REEMBOLSADO"
  | "FALHOU";

export type LedgerMetodo = "PIX_MP" | "PIX_EXTERNO" | "CARTAO" | "DINHEIRO" | "A_COMBINAR";

export type LegacyStatusResult =
  | { ok: true; status: LedgerStatus }
  | { ok: false; motivo: "STATUS_AMBIGUO" };

// PARCIAL é uma projeção agregada (soma de vários pagamentos), não um
// estado válido de uma única tentativa — nunca pode virar uma linha de
// pedido_pagamentos sozinha.
export function ledgerPaymentStatus(statusPagamento: string | null): LegacyStatusResult {
  switch (String(statusPagamento || "").toUpperCase()) {
    case "PENDENTE":
      return { ok: true, status: "PENDENTE" };
    case "PAGO":
      return { ok: true, status: "PAGO" };
    case "CANCELADO":
      return { ok: true, status: "CANCELADO" };
    case "EXPIRADO":
      return { ok: true, status: "EXPIRADO" };
    case "REEMBOLSADO":
      return { ok: true, status: "REEMBOLSADO" };
    case "FALHOU":
      return { ok: true, status: "FALHOU" };
    case "PARCIAL":
      return { ok: false, motivo: "STATUS_AMBIGUO" };
    default:
      return { ok: true, status: "FALHOU" };
  }
}

function ledgerPaymentMethod(pedido: PedidoLegadoRow): LedgerMetodo {
  // Nosso checkout ainda é Pix-only via Payments API: todo pedido SITE com
  // dado de Mercado Pago é PIX_MP. Sem coluna metodo_pagamento pra ler,
  // A_COMBINAR é o fallback seguro pro que sobrar (ex.: um pedido futuro
  // criado manualmente, quando esse fluxo existir).
  return pedido.mp_payment_id ? "PIX_MP" : "A_COMBINAR";
}

interface PedidoLegadoRow {
  id: number;
  valor_total_centavos: number;
  status_pagamento: string;
  origem_pedido: string;
  mp_payment_id: string | null;
  mp_status: string | null;
  mp_qr_code: string | null;
  mp_qr_code_base64: string | null;
  mp_ticket_url: string | null;
  pix_expira_em: string | null;
  idempotency_key: string | null;
  criado_em: string | null;
  atualizado_em: string | null;
  pago_em: string | null;
}

interface PagamentoLedgerBase {
  pedido_id: number;
  metodo: LedgerMetodo;
  origem: "SITE" | "ADMIN";
  valor_centavos: number;
  status: LedgerStatus;
  mp_order_id: string | null;
  mp_payment_id: string | null;
  mp_status: string | null;
  mp_status_detail: string | null;
  mp_ticket_url: string | null;
  mp_qr_code: string | null;
  mp_qr_code_base64: string | null;
  pix_expira_em: string | null;
  criado_em: string | null;
  atualizado_em: string | null;
  pago_em: string | null;
  cancelado_em: string | null;
}

// Discriminado por `legado`: com legado=false o compilador sabe que `id`
// é number (linha real); com legado=true sabe que `id` é null (nunca foi
// persistida). Impede confundir um pagamento virtual com um real.
export type PagamentoLedger =
  | (PagamentoLedgerBase & { legado: true; id: null })
  | (PagamentoLedgerBase & { legado: false; id: number });

export interface MaterializeResult {
  ok: boolean;
  materialized: boolean;
  paymentId: number | null;
  erro?: "STATUS_AMBIGUO";
}

export async function ensureLegacyPaymentMaterialized(
  db: D1Database,
  pedidoId: number,
): Promise<MaterializeResult> {
  const existing = await db
    .prepare(`SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ id: number }>();
  if (existing) {
    return { ok: true, materialized: false, paymentId: Number(existing.id) };
  }

  const pedido = await db
    .prepare(
      `SELECT id, valor_total_centavos, status_pagamento, origem_pedido,
              mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64,
              mp_ticket_url, pix_expira_em, idempotency_key,
              criado_em, atualizado_em, pago_em
       FROM pedidos WHERE id = ? LIMIT 1`,
    )
    .bind(pedidoId)
    .first<PedidoLegadoRow>();

  if (!pedido || Number(pedido.valor_total_centavos || 0) <= 0) {
    return { ok: true, materialized: false, paymentId: null };
  }

  const statusResult = ledgerPaymentStatus(pedido.status_pagamento);
  if (!statusResult.ok) {
    return { ok: false, materialized: false, paymentId: null, erro: statusResult.motivo };
  }
  const status = statusResult.status;

  const idempotencyKey = pedido.idempotency_key || `legacy:${pedidoId}`;

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO pedido_pagamentos (
         pedido_id, metodo, origem, valor_centavos, status,
         mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url,
         pix_expira_em, idempotency_key, criado_em, atualizado_em, pago_em, cancelado_em
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`,
    )
    .bind(
      pedidoId,
      ledgerPaymentMethod(pedido),
      pedido.origem_pedido === "SITE" ? "SITE" : "ADMIN",
      Number(pedido.valor_total_centavos),
      status,
      pedido.mp_payment_id,
      pedido.mp_status,
      pedido.mp_qr_code,
      pedido.mp_qr_code_base64,
      pedido.mp_ticket_url,
      pedido.pix_expira_em,
      idempotencyKey,
      pedido.criado_em,
      pedido.atualizado_em,
      status === "PAGO" ? pedido.pago_em || pedido.atualizado_em || null : null,
      status === "CANCELADO" ? pedido.atualizado_em || null : null,
    )
    .run();

  let paymentId = Number(inserted?.meta?.last_row_id || 0);
  if (!paymentId) {
    const found = await db
      .prepare(`SELECT id FROM pedido_pagamentos WHERE pedido_id = ? ORDER BY id LIMIT 1`)
      .bind(pedidoId)
      .first<{ id: number }>();
    paymentId = Number(found?.id || 0);
  }

  if (paymentId) {
    await allocateFullValueAcrossItems(db, paymentId, pedidoId);
  }

  return { ok: true, materialized: Boolean(paymentId), paymentId: paymentId || null };
}

// Aloca 100% do valor de cada item positivo ao pagamento informado — mesma
// primitiva usada pela materialização lazy (4b) e pela criação do pagamento
// no checkout (4c-1). Estrutural: não afirma "isso foi pago", só "este
// pagamento é responsável por estes itens" (ver relatório do 4b).
export async function allocateFullValueAcrossItems(
  db: D1Database,
  pagamentoId: number,
  pedidoId: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
       SELECT ?, id, valor_total_centavos
       FROM pedido_itens
       WHERE pedido_id = ? AND valor_total_centavos > 0`,
    )
    .bind(pagamentoId, pedidoId)
    .run();
}

// Verificação explícita antes de decidir: se já existe uma linha real no
// ledger, usa ela; só materializa o legado se genuinamente não existir
// nenhuma. Nunca "chama ensure() e torce" (guardrail do 4c-1).
export async function resolveLedgerPaymentId(
  db: D1Database,
  pedidoId: number,
): Promise<number | null> {
  const existing = await db
    .prepare(`SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ id: number }>();
  if (existing) return Number(existing.id);

  const materializado = await ensureLegacyPaymentMaterialized(db, pedidoId);
  return materializado.ok ? materializado.paymentId : null;
}

// Leitura pura: nunca escreve. Se já existe uma linha real, retorna ela.
// Caso contrário, monta uma projeção virtual a partir dos campos legados de
// `pedidos` — a mesma semântica de `legacyPayment()` de produção. Para
// PARCIAL (agregado, não representável como um único pagamento) retorna
// null: nem a leitura finge que existe um pagamento único ali.
export async function getVirtualOrRealPayment(
  db: D1Database,
  pedidoId: number,
): Promise<PagamentoLedger | null> {
  const real = await db
    .prepare(
      `SELECT id, pedido_id, metodo, origem, valor_centavos, status,
              mp_order_id, mp_payment_id, mp_status, mp_status_detail,
              mp_ticket_url, mp_qr_code, mp_qr_code_base64, pix_expira_em,
              criado_em, atualizado_em, pago_em, cancelado_em
       FROM pedido_pagamentos WHERE pedido_id = ? ORDER BY id ASC LIMIT 1`,
    )
    .bind(pedidoId)
    .first<PagamentoLedgerBase & { id: number }>();

  if (real) {
    return { ...real, id: Number(real.id), legado: false };
  }

  const pedido = await db
    .prepare(
      `SELECT id, valor_total_centavos, status_pagamento, origem_pedido,
              mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64,
              mp_ticket_url, pix_expira_em, idempotency_key,
              criado_em, atualizado_em, pago_em
       FROM pedidos WHERE id = ? LIMIT 1`,
    )
    .bind(pedidoId)
    .first<PedidoLegadoRow>();

  if (!pedido || Number(pedido.valor_total_centavos || 0) <= 0) return null;

  const statusResult = ledgerPaymentStatus(pedido.status_pagamento);
  if (!statusResult.ok) return null;

  return {
    legado: true,
    id: null,
    pedido_id: pedido.id,
    metodo: ledgerPaymentMethod(pedido),
    origem: pedido.origem_pedido === "SITE" ? "SITE" : "ADMIN",
    valor_centavos: Number(pedido.valor_total_centavos),
    status: statusResult.status,
    mp_order_id: null,
    mp_payment_id: pedido.mp_payment_id,
    mp_status: pedido.mp_status,
    mp_status_detail: null,
    mp_ticket_url: pedido.mp_ticket_url,
    mp_qr_code: pedido.mp_qr_code,
    mp_qr_code_base64: pedido.mp_qr_code_base64,
    pix_expira_em: pedido.pix_expira_em,
    criado_em: pedido.criado_em,
    atualizado_em: pedido.atualizado_em,
    pago_em: statusResult.status === "PAGO" ? pedido.pago_em : null,
    cancelado_em:
      statusResult.status === "CANCELADO" ? pedido.atualizado_em : null,
  };
}

// Passo 4c-2: pedidos.status_pagamento converge para uma projeção agregada
// (PENDENTE/PARCIAL/PAGO) derivada do ledger, em vez de espelhar o status
// bruto da tentativa mais recente. `pedido_pagamentos.status` continua
// sendo a fonte da verdade sobre cada tentativa individual (PAGO, CANCELADO,
// EXPIRADO, REEMBOLSADO, FALHOU) — nenhuma dessas informações é perdida,
// só deixa de morar na coluna agregada.

export type StatusFinanceiroAgregado = "PENDENTE" | "PARCIAL" | "PAGO";

// Sempre um agregado (SUM ... WHERE status='PAGO'), nunca "pega uma linha".
// Não existe getLatestPayment() genérico neste código — cada pergunta de
// domínio usa seu próprio filtro (ver relatório do 4c-2).
export async function getPaidCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(valor_centavos), 0) AS total
       FROM pedido_pagamentos WHERE pedido_id = ? AND status = 'PAGO'`,
    )
    .bind(pedidoId)
    .first<{ total: number }>();
  return Number(row?.total || 0);
}

export function computeFinancialStatus(
  totalCentavos: number,
  pagoCentavos: number,
): StatusFinanceiroAgregado {
  if (pagoCentavos <= 0) return "PENDENTE";
  if (pagoCentavos < totalCentavos) return "PARCIAL";
  return "PAGO";
}

// Passo 5: dinheiro devolvido. Nunca muta pedido_pagamentos — o reembolso
// vive inteiramente em pedido_reembolsos, como um evento independente.
export async function getRefundedCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(valor_centavos), 0) AS total
       FROM pedido_reembolsos WHERE pedido_id = ? AND status = 'REEMBOLSADO'`,
    )
    .bind(pedidoId)
    .first<{ total: number }>();
  return Number(row?.total || 0);
}

// Líquido = bruto recebido - devolvido confirmado. É isso que responde
// "quanto do dinheiro do cliente ainda está retido", não o bruto sozinho —
// um pagamento de R$100 com R$100 de reembolso contribui zero, nunca um
// número negativo (por isso nunca flipamos o status do pagamento original:
// ver nota em registerManualRefund).
export async function getNetPaidCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const bruto = await getPaidCentavos(db, pedidoId);
  const reembolsado = await getRefundedCentavos(db, pedidoId);
  return Math.max(0, bruto - reembolsado);
}

// Única função que escreve pedidos.status_pagamento a partir do 4c-2.
// A partir do Passo 5, usa o LÍQUIDO (bruto - reembolsado), não o bruto —
// senão um pedido totalmente reembolsado continuaria marcado PAGO.
export async function recalculatePedidoStatusPagamento(
  db: D1Database,
  pedidoId: number,
): Promise<StatusFinanceiroAgregado> {
  const pedido = await db
    .prepare(`SELECT valor_total_centavos FROM pedidos WHERE id = ?`)
    .bind(pedidoId)
    .first<{ valor_total_centavos: number }>();
  const pagoLiquido = await getNetPaidCentavos(db, pedidoId);
  const agregado = computeFinancialStatus(Number(pedido?.valor_total_centavos || 0), pagoLiquido);

  await db
    .prepare(`UPDATE pedidos SET status_pagamento = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(agregado, pedidoId)
    .run();

  return agregado;
}

// Responde exatamente "existe dinheiro do cliente retido?" — a pergunta do
// guarda-corpo de cancelamento (Passo 2), agora em cima do LÍQUIDO. Um
// pedido pago e depois totalmente reembolsado tem líquido zero e pode ser
// cancelado sem exigir um segundo estorno que já aconteceu.
export async function hasNetConfirmedPayment(db: D1Database, pedidoId: number): Promise<boolean> {
  return (await getNetPaidCentavos(db, pedidoId)) > 0;
}

// Passo 4d: pagamentos administrativos (DINHEIRO/CARTAO/PIX_EXTERNO) e
// alocação em cascata (waterfall) — semântica DIFERENTE de
// allocateFullValueAcrossItems. Aquela diz "esta cobrança cobre
// estruturalmente todos os itens" (usada por materialização legada e pelo
// Pix do checkout, que nasce cobrindo o pedido inteiro mesmo PENDENTE).
// Esta diz "estes X centavos efetivamente PAGOS precisam ser distribuídos
// pelo saldo ainda aberto dos itens" — nunca aloca mais do que o valor do
// pagamento, nunca mais do que o saldo aberto de cada item.

export type MetodoManual = "DINHEIRO" | "CARTAO" | "PIX_EXTERNO";

export interface ItemComSaldo {
  itemId: number;
  valorTotalCentavos: number;
  pagoPorOutrosCentavos: number;
}

// Só considera dinheiro de pagamentos com status='PAGO' — a alocação
// estrutural de um Pix SITE ainda PENDENTE nunca conta como saldo
// consumido (é exatamente o que separa este helper de
// allocateFullValueAcrossItems).
export async function getItensComSaldo(db: D1Database, pedidoId: number): Promise<ItemComSaldo[]> {
  const { results } = await db
    .prepare(
      `SELECT pi.id AS itemId, pi.valor_total_centavos AS valorTotalCentavos,
              COALESCE(SUM(CASE WHEN pp.status = 'PAGO' THEN a.valor_centavos ELSE 0 END), 0) AS pagoPorOutrosCentavos
       FROM pedido_itens pi
       LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id = pi.id
       LEFT JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
       WHERE pi.pedido_id = ?
       GROUP BY pi.id, pi.valor_total_centavos
       ORDER BY pi.id ASC`,
    )
    .bind(pedidoId)
    .all<ItemComSaldo>();
  return results;
}

// Pura e determinística, sem D1: do item mais antigo (id ASC) pro mais
// novo, preenche o saldo aberto de cada um até o valor do pagamento
// acabar. Se não couber inteiro, falha sem propor nenhuma alocação parcial
// inválida.
export function computeWaterfallAllocations(
  itens: ItemComSaldo[],
  valorCentavos: number,
):
  | { ok: true; alocacoes: { itemId: number; valorCentavos: number }[] }
  | { ok: false; erro: "VALOR_ACIMA_DO_SALDO" } {
  let restante = valorCentavos;
  const alocacoes: { itemId: number; valorCentavos: number }[] = [];

  for (const item of itens) {
    if (restante <= 0) break;
    const aberto = item.valorTotalCentavos - item.pagoPorOutrosCentavos;
    if (aberto <= 0) continue;
    const parcela = Math.min(aberto, restante);
    alocacoes.push({ itemId: item.itemId, valorCentavos: parcela });
    restante -= parcela;
  }

  if (restante > 0) return { ok: false, erro: "VALOR_ACIMA_DO_SALDO" };
  return { ok: true, alocacoes };
}

// Saldo em aberto = total - LÍQUIDO (não bruto) — desde o Passo 5. Um
// pedido pago e parcialmente reembolsado tem saldo aberto de novo (o
// reembolso reabre o direito de cobrar aquele valor), mesmo que
// registerAdminPayment ainda recuse aceitar um novo pagamento nesse caso
// (ver comentário lá) — o número do saldo em si precisa estar certo
// independente disso, senão a UI mostraria "faltam R$30" e "saldo=0" ao
// mesmo tempo.
export async function getComandaSaldo(
  db: D1Database,
  pedidoId: number,
): Promise<{ total: number; pago: number; saldo: number }> {
  const pedido = await db
    .prepare(`SELECT valor_total_centavos FROM pedidos WHERE id = ?`)
    .bind(pedidoId)
    .first<{ valor_total_centavos: number }>();
  const pago = await getNetPaidCentavos(db, pedidoId);
  const total = Number(pedido?.valor_total_centavos || 0);
  return { total, pago, saldo: Math.max(0, total - pago) };
}

export interface RegisterAdminPaymentResult {
  ok: boolean;
  pagamentoId?: number;
  statusFinanceiro?: StatusFinanceiroAgregado;
  saldoCentavos?: number;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "COMANDA_ENCERRADA"
    | "VALOR_ACIMA_DO_SALDO"
    | "SALDO_INSUFICIENTE_CONCORRENCIA"
    | "PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO";
}

// Lê o saldo, calcula a cascata em memória, e só então grava — pagamento +
// alocações no MESMO batch(), atômico. A condição de saldo do INSERT do
// pagamento é reavaliada NO MOMENTO DA ESCRITA (subquery, não o valor lido
// em JS antes): se duas requisições concorrentes disputarem o mesmo saldo,
// a que commitar primeiro vence; quando a segunda executar a mesma
// condição, o saldo já está reduzido de verdade e ela falha de forma
// determinística (zero linhas no INSERT do pagamento -> subquery das
// alocações resolve pagamento_id=NULL -> constraint NOT NULL derruba o
// batch inteiro -> nenhum DELETE de compensação necessário).
//
// Dívida residual conhecida e aceita: isso fecha com certeza o
// overpayment agregado do pedido (SUM(pagamentos PAGO) <= valor_total),
// mas não torna a distribuição por item serializável — duas requisições
// concorrentes ainda podem calcular a cascata sobre a mesma fotografia
// antiga dos itens antes de uma delas commitar.
export async function registerAdminPayment(
  db: D1Database,
  params: {
    pedidoId: number;
    metodo: MetodoManual;
    valorCentavos: number;
    usuarioId: number;
    observacao?: string;
  },
): Promise<RegisterAdminPaymentResult> {
  const pedido = await db
    .prepare(`SELECT status_comanda FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_comanda: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  if (pedido.status_comanda !== "ABERTA") return { ok: false, erro: "COMANDA_ENCERRADA" };

  // Passo 5, limitação explícita e temporária: se este pedido já tem algum
  // reembolso confirmado, o waterfall (getItensComSaldo) ainda não sabe
  // reabrir a alocação do item que foi parcialmente devolvido — as
  // alocações do pagamento original continuam intactas, "cobrindo" os
  // itens mesmo que o dinheiro tenha voltado em parte. Aceitar um novo
  // pagamento aqui distribuiria dinheiro de verdade sobre uma leitura de
  // saldo por item que já sabemos estar desatualizada. Preferível recusar
  // explicitamente a criar uma alocação sutilmente errada — ver relatório
  // do Passo 5 (reembolso ↔ alocações fica pra investigação futura).
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

  const itens = await getItensComSaldo(db, params.pedidoId);
  const waterfall = computeWaterfallAllocations(itens, params.valorCentavos);
  if (!waterfall.ok) return { ok: false, erro: waterfall.erro };

  // Chave técnica de correlação dentro do batch — identifica unicamente
  // esta operação financeira, mas NÃO significa retry idempotente do
  // cliente ainda (gerada pelo servidor a cada chamada).
  const idempotencyKey = crypto.randomUUID();
  const observacao = (params.observacao ?? "").slice(0, 300);

  // A condição abaixo continua em cima do BRUTO (soma de pedido_pagamentos
  // PAGO), não do líquido — e isso é seguro porque, se este pedido já
  // tivesse algum reembolso, já teríamos recusado acima. Sem reembolso,
  // bruto e líquido são idênticos por definição.
  const statements = [
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, observacao, idempotency_key, pago_em
         )
         SELECT ?, ?, 'ADMIN', ?, 'PAGO', ?, ?, ?, CURRENT_TIMESTAMP
         WHERE ? <= (
           SELECT p.valor_total_centavos - COALESCE(
             (SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id = p.id AND status = 'PAGO'), 0)
           FROM pedidos p WHERE p.id = ?
         )`,
      )
      .bind(
        params.pedidoId,
        params.metodo,
        params.valorCentavos,
        params.usuarioId,
        observacao,
        idempotencyKey,
        params.valorCentavos,
        params.pedidoId,
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
  } catch {
    // A condição de saldo falhou na escrita: outra requisição consumiu o
    // saldo entre nossa leitura e o commit. Nada foi gravado (rollback do
    // batch inteiro) — não há nada para compensar manualmente.
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const pagamentoId = Number(batchResults[0]?.meta?.last_row_id || 0);
  if (!pagamentoId) {
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const statusFinanceiro = await recalculatePedidoStatusPagamento(db, params.pedidoId);
  const saldo = await getComandaSaldo(db, params.pedidoId);

  return { ok: true, pagamentoId, statusFinanceiro, saldoCentavos: saldo.saldo };
}

// Passo 5: reembolso manual (sem falar com o Mercado Pago). Nunca muta
// pedido_pagamentos — grava só em pedido_reembolsos. O pagamento original
// continua PAGO pra sempre, mesmo devolvido 100%: ver a nota no relatório
// do Passo 5 sobre por que flipar o status pra 'REEMBOLSADO' produziria
// uma armadilha matemática (bruto deixaria de contar o pagamento, mas o
// reembolso continuaria sendo subtraído, gerando contribuição negativa).

const METODOS_MANUAIS_REEMBOLSAVEIS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
]);

const STATUS_PEDIDO_REEMBOLSAVEIS: ReadonlySet<string> = new Set([
  "NOVO",
  "PREPARANDO",
  "PRONTO",
]);

export interface RegisterRefundResult {
  ok: boolean;
  reembolsoId?: number;
  statusFinanceiro?: StatusFinanceiroAgregado;
  saldoCentavos?: number;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "STATUS_PEDIDO_NAO_REEMBOLSAVEL"
    | "PAGAMENTO_NAO_ENCONTRADO"
    | "METODO_NAO_REEMBOLSAVEL_MANUALMENTE"
    | "VALOR_INVALIDO"
    | "SALDO_REEMBOLSAVEL_INSUFICIENTE";
}

export async function registerManualRefund(
  db: D1Database,
  params: {
    pedidoId: number;
    pagamentoId: number;
    valorCentavos: number;
    usuarioId: number;
    motivo?: string;
  },
): Promise<RegisterRefundResult> {
  const pedido = await db
    .prepare(`SELECT status_pedido FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_pedido: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  if (!STATUS_PEDIDO_REEMBOLSAVEIS.has(pedido.status_pedido)) {
    return { ok: false, erro: "STATUS_PEDIDO_NAO_REEMBOLSAVEL" };
  }

  const pagamento = await db
    .prepare(
      `SELECT id, metodo, valor_centavos, status
       FROM pedido_pagamentos WHERE id = ? AND pedido_id = ? LIMIT 1`,
    )
    .bind(params.pagamentoId, params.pedidoId)
    .first<{ id: number; metodo: string; valor_centavos: number; status: string }>();
  if (!pagamento || pagamento.status !== "PAGO") {
    return { ok: false, erro: "PAGAMENTO_NAO_ENCONTRADO" };
  }
  if (!METODOS_MANUAIS_REEMBOLSAVEIS.has(pagamento.metodo)) {
    // Cobre PIX_MP (exige reembolso via API do Mercado Pago, fora deste
    // passo) e OUTRO (existe no schema por paridade com produção, mas
    // este endpoint não aceita criar pagamentos com esse método, então
    // também não reembolsa).
    return { ok: false, erro: "METODO_NAO_REEMBOLSAVEL_MANUALMENTE" };
  }

  if (!Number.isSafeInteger(params.valorCentavos) || params.valorCentavos <= 0) {
    return { ok: false, erro: "VALOR_INVALIDO" };
  }

  const idempotencyKey = crypto.randomUUID();
  const motivo = (params.motivo ?? "").slice(0, 300);

  const result = await db
    .prepare(
      `INSERT INTO pedido_reembolsos (
         pedido_id, pagamento_id, origem, metodo, valor_centavos, status,
         idempotency_key, registrado_por_usuario_id, motivo, devolveu_estoque, concluido_em
       )
       SELECT ?, ?, 'MANUAL', ?, ?, 'REEMBOLSADO', ?, ?, ?, 0, CURRENT_TIMESTAMP
       WHERE ? <= (
         SELECT pp.valor_centavos - COALESCE(
           (SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pagamento_id = pp.id AND status = 'REEMBOLSADO'), 0)
         FROM pedido_pagamentos pp WHERE pp.id = ?
       )`,
    )
    .bind(
      params.pedidoId,
      params.pagamentoId,
      pagamento.metodo,
      params.valorCentavos,
      idempotencyKey,
      params.usuarioId,
      motivo,
      params.valorCentavos,
      params.pagamentoId,
    )
    .run();

  if (Number(result?.meta?.changes || 0) === 0) {
    // Saldo reembolsável recalculado no momento da escrita não cobriu o
    // valor pedido — outra requisição pode ter consumido o saldo entre
    // nossa leitura e o commit. Determinístico, sem DELETE de compensação
    // (mesmo padrão do 4d).
    return { ok: false, erro: "SALDO_REEMBOLSAVEL_INSUFICIENTE" };
  }

  const reembolsoId = Number(result.meta.last_row_id);
  const statusFinanceiro = await recalculatePedidoStatusPagamento(db, params.pedidoId);
  const saldo = await getComandaSaldo(db, params.pedidoId);

  return { ok: true, reembolsoId, statusFinanceiro, saldoCentavos: saldo.saldo };
}
