/// <reference types="@cloudflare/workers-types" />

// Import circular deliberado com pedidoReconcile.ts: aquele módulo importa
// `recalculatePedidoStatusPagamento` daqui, e este arquivo importa
// `reconcilePedidoAfterFinancialChange` de lá. Seguro porque ambos os usos
// só acontecem dentro de corpos de função, nunca durante a avaliação do
// módulo — é a ponte deliberada entre financeiro e físico (Passo 7),
// nunca o inverso (comandaLedger.ts nunca importa stock.ts diretamente).
import { reconcilePedidoAfterFinancialChange } from "./pedidoReconcile";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";
import {
  chargeableCapacitySql,
  CONFIRMED_REFUNDS_BY_ALLOCATION_CTE,
  EXCHANGE_COVERAGE_STATUSES,
} from "./financialCoverage";
import {
  buscarOperacao,
  chavePagamento,
  chaveReembolso,
  conflitoOperacao,
  fingerprint,
  fontePagamento,
  fonteReembolso,
  parseOperationKey,
  prepareClaimOperacao,
  type ConflitoOperacao,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "./operacoes";

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
  mpPaymentId: string | null = null,
): Promise<number | null> {
  const anyLedger = await db
    .prepare(`SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ id: number }>();
  if (!anyLedger) await ensureLegacyPaymentMaterialized(db, pedidoId);
  // Este resolver pertence ao polling do checkout. Nunca seleciona um Pix
  // ADMIN ou outro pagamento do pedido só por ter sido o primeiro inserido.
  const { results } = await db.prepare(
    `SELECT id FROM pedido_pagamentos WHERE pedido_id = ? AND origem = 'SITE' AND metodo = 'PIX_MP'
       AND (? IS NULL OR mp_payment_id = ? OR mp_payment_id IS NULL) LIMIT 2`,
  ).bind(pedidoId, mpPaymentId, mpPaymentId).all<{ id: number }>();
  if (results.length > 1) throw new Error("TENTATIVA_SITE_AMBIGUA");
  return results[0]?.id ?? null;
}

// Leitura pura: nunca escreve. Se já existe uma linha real, retorna ela.
// Caso contrário, monta uma projeção virtual a partir dos campos legados de
// `pedidos` — a mesma semântica de `legacyPayment()` de produção. Para
// PARCIAL (agregado, não representável como um único pagamento) retorna
// null: nem a leitura finge que existe um pagamento único ali.
//
// Um pedido pode ter mais de uma linha em pedido_pagamentos (ex.: o
// placeholder PENDENTE criado na abertura manual do pedido, cancelado só
// quando o pagamento real chega via registerAdminPayment) — "a mais antiga"
// nunca é a resposta certa para "qual pagamento mostrar", porque o
// placeholder cancelado sempre nasce primeiro (id menor) que o pagamento
// real. PAGO vence qualquer coisa; CANCELADO só aparece se não houver mais
// nada; empates dentro da mesma prioridade resolvem pelo mais recente.
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
       FROM pedido_pagamentos WHERE pedido_id = ?
       ORDER BY CASE status WHEN 'PAGO' THEN 0 WHEN 'CANCELADO' THEN 2 ELSE 1 END, id DESC
       LIMIT 1`,
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
): Promise<StatusFinanceiroAgregado | null> {
  // Calculado no instante da escrita, nunca sobre um snapshot carregado em JS.
  // null significa pedido ausente ou legado sem ledger; não materializa aqui.
  const row = await preparePedidoFinancialProjection(db, pedidoId)
    .first<{ status_pagamento: StatusFinanceiroAgregado }>();
  return row?.status_pagamento ?? null;
}

// Responde exatamente "existe dinheiro do cliente retido?" — a pergunta do
// guarda-corpo de cancelamento (Passo 2), agora em cima do LÍQUIDO. Um
// pedido pago e depois totalmente reembolsado tem líquido zero e pode ser
// cancelado sem exigir um segundo estorno que já aconteceu.
export async function hasNetConfirmedPayment(db: D1Database, pedidoId: number): Promise<boolean> {
  return (await getNetPaidCentavos(db, pedidoId)) > 0;
}

// Projeção financeira para exibição (admin): "quanto está confirmado, e por
// quais métodos" — não o ledger inteiro, só o que a UI precisa pra montar um
// texto como "Pago · Cartão + Dinheiro" ou "Parcial · R$ 30 / R$ 100".
//
// metodosConfirmados NUNCA é um `DISTINCT metodo WHERE status='PAGO'` puro:
// isso ignoraria reembolso. Um pagamento 100% estornado tem `status='PAGO'`
// pra sempre (Passo 5 nunca flipa o status original), então precisaríamos
// ver esse método como "confirmado" mesmo com pagoCentavos=0 — uma projeção
// mentirosa. Em vez disso, cada linha de pedido_pagamentos só conta pro
// resultado se sua contribuição LÍQUIDA própria (valor_centavos menos o que
// foi reembolsado especificamente DAQUELE pagamento, via pedido_reembolsos.
// pagamento_id) ainda for positiva — mesma lógica de getNetPaidCentavos,
// só que por linha em vez de agregada pro pedido inteiro.
export type FinanceiroPedido = {
  status: StatusFinanceiroAgregado;
  brutoPagoCentavos: number;
  reembolsadoCentavos: number;
  liquidoCentavos: number;
  saldoCentavos: number;
  /** Alias retrocompativel do liquido, mantido para leitores existentes. */
  pagoCentavos: number;
  totalCentavos: number;
  metodosConfirmados: LedgerMetodo[];
};

// Ordem fixa de exibição — nunca a ordem incidental de retorno do SQLite,
// que dependeria de id/inserção e produziria "Cartão + Dinheiro" numa carga
// e "Dinheiro + Cartão" na próxima pro mesmo pedido.
const ORDEM_METODOS_EXIBICAO: LedgerMetodo[] = [
  "PIX_MP",
  "PIX_EXTERNO",
  "CARTAO",
  "DINHEIRO",
  "A_COMBINAR",
];

function ordenarMetodos(metodos: Iterable<string>): LedgerMetodo[] {
  const presentes = new Set(metodos);
  return ORDEM_METODOS_EXIBICAO.filter((m) => presentes.has(m));
}

const METODOS_CONFIRMADOS_QUERY = `
  SELECT pp.pedido_id AS pedido_id, pp.metodo AS metodo
  FROM pedido_pagamentos pp
  WHERE pp.status = 'PAGO'
    AND pp.valor_centavos > COALESCE(
      (SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
       WHERE r.pagamento_id = pp.id AND r.status = 'REEMBOLSADO'), 0)
`;

export async function getFinanceiroPedido(db: D1Database, pedidoId: number): Promise<FinanceiroPedido> {
  const [pedido, brutoPagoCentavos, reembolsadoCentavos, metodos] = await Promise.all([
    db
      .prepare(`SELECT valor_total_centavos, status_pagamento FROM pedidos WHERE id = ?`)
      .bind(pedidoId)
      .first<{ valor_total_centavos: number; status_pagamento: string }>(),
    getPaidCentavos(db, pedidoId),
    getRefundedCentavos(db, pedidoId),
    db
      .prepare(`${METODOS_CONFIRMADOS_QUERY} AND pp.pedido_id = ?`)
      .bind(pedidoId)
      .all<{ metodo: string }>(),
  ]);
  const totalCentavos = Number(pedido?.valor_total_centavos || 0);
  const liquidoCentavos = Math.max(0, brutoPagoCentavos - reembolsadoCentavos);

  return {
    status: (pedido?.status_pagamento as StatusFinanceiroAgregado) ?? "PENDENTE",
    brutoPagoCentavos,
    reembolsadoCentavos,
    liquidoCentavos,
    saldoCentavos: Math.max(0, totalCentavos - liquidoCentavos),
    pagoCentavos: liquidoCentavos,
    totalCentavos,
    metodosConfirmados: ordenarMetodos(metodos.results.map((r) => r.metodo)),
  };
}

// Mesma projeção, em lote, pra telas de listagem — três queries no total
// pra página inteira (bruto pago, reembolsado, métodos com contribuição
// líquida), nunca uma consulta por linha.
export async function getFinanceirosPorPedidos(
  db: D1Database,
  pedidos: { id: number; valorTotalCentavos: number; statusPagamento: string }[],
): Promise<Map<number, FinanceiroPedido>> {
  const resultado = new Map<number, FinanceiroPedido>();
  if (pedidos.length === 0) return resultado;

  const ids = pedidos.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");

  const [brutoRows, reembolsoRows, metodoRows] = await Promise.all([
    db
      .prepare(
        `SELECT pedido_id, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pedido_pagamentos WHERE pedido_id IN (${placeholders}) AND status = 'PAGO'
         GROUP BY pedido_id`,
      )
      .bind(...ids)
      .all<{ pedido_id: number; total: number }>(),
    db
      .prepare(
        `SELECT pedido_id, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pedido_reembolsos WHERE pedido_id IN (${placeholders}) AND status = 'REEMBOLSADO'
         GROUP BY pedido_id`,
      )
      .bind(...ids)
      .all<{ pedido_id: number; total: number }>(),
    db
      .prepare(`${METODOS_CONFIRMADOS_QUERY} AND pp.pedido_id IN (${placeholders})`)
      .bind(...ids)
      .all<{ pedido_id: number; metodo: string }>(),
  ]);

  const brutoPorPedido = new Map(brutoRows.results.map((r) => [r.pedido_id, Number(r.total)]));
  const reembolsoPorPedido = new Map(reembolsoRows.results.map((r) => [r.pedido_id, Number(r.total)]));
  const metodosPorPedido = new Map<number, Set<string>>();
  for (const row of metodoRows.results) {
    const set = metodosPorPedido.get(row.pedido_id) ?? new Set<string>();
    set.add(row.metodo);
    metodosPorPedido.set(row.pedido_id, set);
  }

  for (const p of pedidos) {
    const bruto = brutoPorPedido.get(p.id) ?? 0;
    const reembolsado = reembolsoPorPedido.get(p.id) ?? 0;
    const liquido = Math.max(0, bruto - reembolsado);
    resultado.set(p.id, {
      status: p.statusPagamento as StatusFinanceiroAgregado,
      brutoPagoCentavos: bruto,
      reembolsadoCentavos: reembolsado,
      liquidoCentavos: liquido,
      saldoCentavos: Math.max(0, p.valorTotalCentavos - liquido),
      pagoCentavos: liquido,
      totalCentavos: p.valorTotalCentavos,
      metodosConfirmados: ordenarMetodos(metodosPorPedido.get(p.id) ?? []),
    });
  }

  return resultado;
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
  // Durante o cutover B5 o mesmo código ainda precisa ler a topologia
  // histórica, anterior à 0016. Depois da migration, somente ATIVO entra no
  // waterfall; TROCA_PENDENTE jamais recebe cobertura financeira.
  const temStatusItem = await db.prepare(
    `SELECT 1 FROM pragma_table_info('pedido_itens') WHERE name='status_item' LIMIT 1`,
  ).first();
  if (!temStatusItem) {
    const { results } = await db.prepare(
      `SELECT pi.id AS itemId,pi.valor_total_centavos AS valorTotalCentavos,
              COALESCE(SUM(CASE WHEN pp.status='PAGO' THEN a.valor_centavos ELSE 0 END),0) AS pagoPorOutrosCentavos
       FROM pedido_itens pi
       LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id=pi.id
       LEFT JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
       WHERE pi.pedido_id=? GROUP BY pi.id,pi.valor_total_centavos ORDER BY pi.id`,
    ).bind(pedidoId).all<ItemComSaldo>();
    return results;
  }
  const { results } = await db
    .prepare(
      `WITH RECURSIVE linhagem(item_atual_id,item_id) AS (
         SELECT pi.id,pi.id FROM pedido_itens pi
         WHERE pi.pedido_id=? AND pi.status_item='ATIVO'
         UNION
         SELECT l.item_atual_id,t.item_origem_id FROM linhagem l
         JOIN pedido_item_trocas t ON t.item_destino_id=l.item_id
         WHERE t.status IN (${EXCHANGE_COVERAGE_STATUSES})
       ), ${CONFIRMED_REFUNDS_BY_ALLOCATION_CTE}
       SELECT pi.id AS itemId, pi.valor_total_centavos AS valorTotalCentavos,
              COALESCE(SUM(CASE WHEN pp.status='PAGO'
                THEN MAX(0,a.valor_centavos-COALESCE(rf.valor_centavos,0)) ELSE 0 END),0)
                AS pagoPorOutrosCentavos
       FROM pedido_itens pi
       LEFT JOIN linhagem l ON l.item_atual_id=pi.id
       LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id=l.item_id
       LEFT JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
       LEFT JOIN refunds_confirmados rf ON rf.pagamento_alocacao_id=a.id
       WHERE pi.pedido_id=? AND pi.status_item='ATIVO'
       GROUP BY pi.id, pi.valor_total_centavos
       ORDER BY pi.id ASC`,
    )
    .bind(pedidoId, pedidoId)
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
  /** true quando a resposta recuperou uma operação já persistida (A1). */
  replay?: boolean;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "COMANDA_ENCERRADA"
    | "VALOR_ACIMA_DO_SALDO"
    | "SALDO_INSUFICIENTE_CONCORRENCIA"
    | "OPERATION_KEY_INVALIDA"
    | "OPERACAO_INCOMPLETA"
    | ConflitoOperacao;
}

// Somente após a confirmação da escrita financeira. Uma falha derivada não
// pode induzir o operador a registrar o mesmo fato novamente (A1 é separado).
async function reconcilePersistedAdminFact(
  db: D1Database,
  pedidoId: number,
  operacao: "PAGAMENTO" | "REEMBOLSO",
  fatoId: number,
): Promise<{ statusFinanceiro?: StatusFinanceiroAgregado; saldoCentavos?: number }> {
  try {
    const reconciliacao = await reconcilePedidoAfterFinancialChange(db, pedidoId);
    if (!reconciliacao.ok) throw new Error(reconciliacao.motivo);
    const saldo = await getComandaSaldo(db, pedidoId);
    return { statusFinanceiro: reconciliacao.statusFinanceiro, saldoCentavos: saldo.saldo };
  } catch (err) {
    console.error("Fato financeiro administrativo persistido; falha nos efeitos derivados", {
      pedidoId, operacao, fatoId,
    }, err);
    // Não inventa saldo/status nem tenta uma nova leitura que pode falhar.
    // A divergência persistida continua elegível para recuperação pelo B3.
    return {};
  }
}

// A1 — replay de uma operação LOCAL já persistida (pagamento manual /
// refund manual / criação ADMIN). Nunca cria um fato novo: valida a
// compatibilidade da key e devolve o MESMO id, reconciliando pelo B3
// (convergente e idempotente) para que o estado derivado continue correto
// mesmo que a resposta original tenha se perdido.
//
// Para operações locais o replay é reconstruído a partir das LINHAS
// persistidas, não de um snapshot JSON: as linhas são a fonte da verdade e
// nunca podem divergir de si mesmas.
async function replayOperacaoLocal(
  db: D1Database,
  operacao: OperacaoRow,
  esperado: IdentidadeEsperada,
  fato: "PAGAMENTO" | "REEMBOLSO",
): Promise<
  | {
      ok: true;
      id: number;
      statusFinanceiro?: StatusFinanceiroAgregado;
      saldoCentavos?: number;
    }
  | { ok: false; erro: ConflitoOperacao | "OPERACAO_INCOMPLETA" }
> {
  const conflito = conflitoOperacao(operacao, esperado);
  if (conflito) return { ok: false, erro: conflito };

  const id = Number(
    (fato === "PAGAMENTO" ? operacao.pagamento_id : operacao.reembolso_id) || 0,
  );
  const pedidoId = Number(operacao.pedido_id || 0);
  // Operação local só é registrada junto com o fato, no mesmo batch — um
  // claim sem fato não deveria existir. Se existir, é estado corrompido:
  // reporta em vez de recriar o fato financeiro por conta própria.
  if (!id || !pedidoId) return { ok: false, erro: "OPERACAO_INCOMPLETA" };

  const derivados = await reconcilePersistedAdminFact(db, pedidoId, fato, id);
  return { ok: true, id, ...derivados };
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
    /**
     * A1: identidade lógica criada pelo cliente ANTES do primeiro envio.
     * Obrigatória no endpoint HTTP; opcional aqui porque o helper também é
     * chamado por caminhos internos que não representam uma intenção
     * repetível do operador.
     */
    operationKey?: string | null;
  },
): Promise<RegisterAdminPaymentResult> {
  const observacao = (params.observacao ?? "").slice(0, 300);

  // A1 — identidade da intenção. O fingerprint cobre exatamente o conteúdo
  // que define "este recebimento", já normalizado do mesmo jeito que será
  // persistido: pedido, método, valor e observação.
  let operationKey: string | null = null;
  let identidade: IdentidadeEsperada | null = null;
  if (params.operationKey != null) {
    const parsed = parseOperationKey(params.operationKey);
    if (!parsed.ok) return { ok: false, erro: parsed.erro };
    operationKey = parsed.key;
    identidade = {
      tipo: "PAGAMENTO_ADMIN",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        metodo: params.metodo,
        valorCentavos: params.valorCentavos,
        observacao,
      }),
    };

    // Lookup ANTES dos guards dependentes do estado atual: se a resposta
    // HTTP anterior se perdeu e o pedido já mudou de estado (por exemplo
    // ficou PAGO), o retry precisa RECUPERAR o pagamento original em vez de
    // ser reinterpretado como uma nova tentativa contra o estado novo.
    const existente = await buscarOperacao(db, operationKey);
    if (existente) {
      const replay = await replayOperacaoLocal(db, existente, identidade, "PAGAMENTO");
      return replay.ok
        ? {
            ok: true,
            pagamentoId: replay.id,
            replay: true,
            statusFinanceiro: replay.statusFinanceiro,
            saldoCentavos: replay.saldoCentavos,
          }
        : { ok: false, erro: replay.erro };
    }
  }

  const pedido = await db
    .prepare(`SELECT status_comanda, status_pedido FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_comanda: string; status_pedido: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  // ENTREGUE encerra a comanda automaticamente por trigger, mas isso é um
  // estado operacional: o recebimento ainda pode acontecer depois da
  // entrega. A exceção é deliberadamente estreita; CANCELADO e qualquer
  // outro pedido com comanda encerrada continuam bloqueados.
  if (
    pedido.status_comanda !== "ABERTA" &&
    pedido.status_pedido !== "ENTREGUE"
  ) {
    return { ok: false, erro: "COMANDA_ENCERRADA" };
  }

  const itens = await getItensComSaldo(db, params.pedidoId);
  const waterfall = computeWaterfallAllocations(itens, params.valorCentavos);
  if (!waterfall.ok) return { ok: false, erro: waterfall.erro };

  // Placeholders financeiros PURAMENTE LOCAIS criados na abertura manual do
  // pedido (ex.: A_COMBINAR) — nunca um PIX_MP, mesmo PENDENTE e mesmo sem
  // mp_payment_id ainda gravado: `metodo='PIX_MP'` por si só já representa
  // uma cobrança que pode estar viva no Mercado Pago (Pix administrativo,
  // passo futuro), e um pagamento manual não tem autoridade pra fingir que
  // ela deixou de existir — só o Mercado Pago decide isso. Cancela TODOS os
  // placeholders locais elegíveis (nunca LIMIT 1): se por algum motivo mais
  // de um existir, um `LIMIT 1` deixaria os demais órfãos ao lado do
  // pagamento PAGO que estamos prestes a inserir — mesmo bug documentado em
  // produção. Nunca cancela PENDENTE de origem SITE (Pix do cliente ainda
  // pode confirmar sozinho).
  const placeholdersLocais = await db
    .prepare(
      `SELECT id FROM pedido_pagamentos
       WHERE pedido_id = ? AND status = 'PENDENTE' AND origem = 'ADMIN' AND metodo != 'PIX_MP'
       ORDER BY id ASC`,
    )
    .bind(params.pedidoId)
    .all<{ id: number }>();
  // Só um pode ir no `substitui_pagamento_id` (é uma FK simples) — é uma
  // trilha de auditoria best-effort, não a fonte de verdade do cancelamento
  // (que é a condição do UPDATE abaixo, aplicada a todos os elegíveis).
  const primeiroPlaceholderLocal = placeholdersLocais.results[0]?.id ?? null;

  // Chave técnica de correlação dentro do batch. A partir do A1 ela é
  // DERIVADA da operation key quando existe uma: o UNIQUE parcial de
  // `pedido_pagamentos.idempotency_key` passa a ser uma segunda proteção
  // atômica — o mesmo pagamento não pode nascer duas vezes para a mesma
  // intenção, nem sob concorrência, nem depois de um retry. Sem operation
  // key (caminho interno), continua sendo um UUID por chamada.
  const idempotencyKey = operationKey ? chavePagamento(operationKey) : crypto.randomUUID();

  const statements = [
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, observacao, idempotency_key, pago_em,
           substitui_pagamento_id
         )
         SELECT ?, ?, 'ADMIN', ?, 'PAGO', ?, ?, ?, CURRENT_TIMESTAMP, ?
         WHERE ? <= ${chargeableCapacitySql()}`,
      )
      .bind(
        params.pedidoId,
        params.metodo,
        params.valorCentavos,
        params.usuarioId,
        observacao,
        idempotencyKey,
        primeiroPlaceholderLocal,
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
    ...(placeholdersLocais.results.length > 0
      ? [
          db
            .prepare(
              `UPDATE pedido_pagamentos SET status = 'CANCELADO', cancelado_em = CURRENT_TIMESTAMP
               WHERE pedido_id = ? AND status = 'PENDENTE' AND origem = 'ADMIN' AND metodo != 'PIX_MP'
                 AND EXISTS (SELECT 1 FROM pedido_pagamentos WHERE idempotency_key = ?)`,
            )
            .bind(params.pedidoId, idempotencyKey),
        ]
      : []),
    // Claim A1 por último e CONDICIONADO ao fato: se o guard de saldo
    // recusou a escrita do pagamento, a fonte não devolve linha e nenhuma
    // operação é registrada — nunca sobra um claim apontando para um
    // pagamento que não existe. Continua atômico: claim e fato estão no
    // MESMO batch (uma transação), então ou os dois existem ou nenhum.
    ...(operationKey && identidade
      ? [
          prepareClaimOperacao(db, {
            key: operationKey,
            ...identidade,
            fase: "CONCLUIDA",
            fonte: fontePagamento(idempotencyKey),
          }),
        ]
      : []),
  ];

  // A1 — recuperação da operação vencedora numa disputa pela mesma key.
  // Duas requisições concorrentes com a mesma key colidem no UNIQUE de
  // `pedido_pagamentos.idempotency_key` (ou no de `operation_key`); o batch
  // do perdedor é revertido inteiro e ele relê a vencedora em vez de
  // devolver um erro que convidaria a criar um segundo fato financeiro.
  const recuperarVencedora = async (): Promise<RegisterAdminPaymentResult | null> => {
    if (!operationKey || !identidade) return null;
    const vencedora = await buscarOperacao(db, operationKey);
    if (!vencedora) return null;
    const replay = await replayOperacaoLocal(db, vencedora, identidade, "PAGAMENTO");
    return replay.ok
      ? {
          ok: true,
          pagamentoId: replay.id,
          replay: true,
          statusFinanceiro: replay.statusFinanceiro,
          saldoCentavos: replay.saldoCentavos,
        }
      : { ok: false, erro: replay.erro };
  };

  let batchResults;
  try {
    batchResults = await db.batch(statements);
  } catch {
    // Pode ser a condição de saldo (outra requisição consumiu o saldo entre
    // nossa leitura e o commit) ou a disputa da mesma operation key. Nada
    // foi gravado (rollback do batch inteiro) — não há nada para compensar.
    // A releitura por key distingue os dois casos de forma determinística.
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const pagamentoId = Number(batchResults[0]?.meta?.last_row_id || 0);
  if (!pagamentoId) {
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const derivados = await reconcilePersistedAdminFact(db, params.pedidoId, "PAGAMENTO", pagamentoId);
  return { ok: true, pagamentoId, ...derivados };
}

// Passo 5: reembolso manual (sem falar com o Mercado Pago). Nunca muta
// pedido_pagamentos — grava só em pedido_reembolsos. O pagamento original
// continua PAGO pra sempre, mesmo devolvido 100%: ver a nota no relatório
// do Passo 5 sobre por que flipar o status pra 'REEMBOLSADO' produziria
// uma armadilha matemática (bruto deixaria de contar o pagamento, mas o
// reembolso continuaria sendo subtraído, gerando contribuição negativa).

// B-2 — métodos cujo estorno pode ser REGISTRADO manualmente no ledger.
//
// `PIX_MP` entrou aqui, e isso NÃO significa que passamos a chamar a API de
// refund do Mercado Pago (continua fora de escopo, nenhuma chamada remota
// acontece neste caminho). Significa apenas que a operadora pode registrar
// no ledger um estorno que ela JÁ executou por fora do sistema — no painel
// do Mercado Pago ou por outro meio.
//
// Sem isso o sistema tinha um beco sem saída com dinheiro real: cliente paga
// Pix, desiste, a operadora devolve o valor, e o ledger continuava afirmando
// que o dinheiro estava retido. O guard de cancelamento exige líquido zero
// ("Faça o estorno antes de cancelar"), então o pedido ficava PAGO para
// sempre, impossível de cancelar, e só recuperável com SQL direto no banco.
//
// `origem='MANUAL'` (gravado abaixo) continua correto e é deliberado: descreve
// QUEM criou este fato — o operador, não a nossa integração. `'MERCADO_PAGO'`
// fica reservado para quando/se existir sincronização automática de refund,
// que não é isto.
//
// `OUTRO` segue fora: existe no schema por paridade com produção, mas este
// endpoint não cria pagamentos com esse método, então também não os estorna.
const METODOS_MANUAIS_REEMBOLSAVEIS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
  "PIX_MP",
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
  /** true quando a resposta recuperou uma operação já persistida (A1). */
  replay?: boolean;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "STATUS_PEDIDO_NAO_REEMBOLSAVEL"
    | "REFUND_REQUER_FLUXO_COMANDA"
    | "PAGAMENTO_NAO_ENCONTRADO"
    | "METODO_NAO_REEMBOLSAVEL_MANUALMENTE"
    | "REFUND_PIX_MP_REMOTO_EM_ANDAMENTO"
    | "VALOR_INVALIDO"
    | "SALDO_REEMBOLSAVEL_INSUFICIENTE"
    | "OPERATION_KEY_INVALIDA"
    | "OPERACAO_INCOMPLETA"
    | ConflitoOperacao;
}

export async function registerManualRefund(
  db: D1Database,
  params: {
    pedidoId: number;
    pagamentoId: number;
    valorCentavos: number;
    usuarioId: number;
    motivo?: string;
    /** A1: ver nota em `registerAdminPayment`. */
    operationKey?: string | null;
  },
): Promise<RegisterRefundResult> {
  const motivo = (params.motivo ?? "").slice(0, 300);

  // A1 — identidade da intenção de devolver dinheiro. Uma mudança posterior
  // do saldo reembolsável não pode transformar o retry desta mesma intenção
  // numa nova devolução.
  let operationKey: string | null = null;
  let identidade: IdentidadeEsperada | null = null;
  if (params.operationKey != null) {
    const parsed = parseOperationKey(params.operationKey);
    if (!parsed.ok) return { ok: false, erro: parsed.erro };
    operationKey = parsed.key;
    identidade = {
      tipo: "REFUND_ADMIN",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        pagamentoId: params.pagamentoId,
        valorCentavos: params.valorCentavos,
        motivo,
      }),
    };

    // Lookup antes dos guards de estado (status do pedido, método,
    // saldo reembolsável).
    const existente = await buscarOperacao(db, operationKey);
    if (existente) {
      const replay = await replayOperacaoLocal(db, existente, identidade, "REEMBOLSO");
      return replay.ok
        ? {
            ok: true,
            reembolsoId: replay.id,
            replay: true,
            statusFinanceiro: replay.statusFinanceiro,
            saldoCentavos: replay.saldoCentavos,
          }
        : { ok: false, erro: replay.erro };
    }
  }

  const pedido = await db
    .prepare(`SELECT status_pedido, origem_pedido, status_comanda FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_pedido: string; origem_pedido: string; status_comanda: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  // A1 (auditoria Comanda Viva) — o refund manual genérico não sabe a qual
  // item atribuir o estorno: ele nunca grava em `pedido_reembolso_alocacoes`
  // nem em `pedido_item_troca_reembolso_alocacoes`. Numa comanda MANUAL
  // ainda ABERTA isso trava permanentemente `COBERTURA_INDETERMINADA` em
  // qualquer cancelamento/troca futuro do pedido, sem caminho de reparo.
  // Pedidos do site ou comandas já ENCERRADAS mantêm o comportamento
  // anterior (não participam do fluxo por item).
  if (pedido.origem_pedido === "MANUAL" && pedido.status_comanda === "ABERTA") {
    return { ok: false, erro: "REFUND_REQUER_FLUXO_COMANDA" };
  }
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
    // Sobra `OUTRO`: existe no schema por paridade com produção, mas este
    // endpoint não aceita criar pagamentos com esse método, então também
    // não os estorna. `PIX_MP` passou a ser registrável no B-2 — ver a nota
    // em METODOS_MANUAIS_REEMBOLSAVEIS.
    return { ok: false, erro: "METODO_NAO_REEMBOLSAVEL_MANUALMENTE" };
  }
  if (pagamento.metodo === "PIX_MP") {
    const intencaoAtiva = await db.prepare(`SELECT 1 FROM pedido_reembolso_pix_mp_intencoes
      WHERE pagamento_id=? AND status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO') LIMIT 1`)
      .bind(params.pagamentoId).first();
    if (intencaoAtiva) return { ok: false, erro: "REFUND_PIX_MP_REMOTO_EM_ANDAMENTO" };
  }
  // O estorno só pode ser registrado sobre um pagamento efetivamente
  // confirmado (`status = 'PAGO'`, validado acima) — e o registro NUNCA muta
  // o pagamento original, que permanece um fato histórico íntegro. Nenhuma
  // chamada remota ao Mercado Pago acontece aqui, inclusive para PIX_MP.

  if (!Number.isSafeInteger(params.valorCentavos) || params.valorCentavos <= 0) {
    return { ok: false, erro: "VALOR_INVALIDO" };
  }

  // Derivada da operation key quando existe: o UNIQUE de
  // `pedido_reembolsos.idempotency_key` garante at-most-once do refund em si.
  const idempotencyKey = operationKey ? chaveReembolso(operationKey) : crypto.randomUUID();

  const insercao = db
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
    );

  const recuperarVencedora = async (): Promise<RegisterRefundResult | null> => {
    if (!operationKey || !identidade) return null;
    const vencedora = await buscarOperacao(db, operationKey);
    if (!vencedora) return null;
    const replay = await replayOperacaoLocal(db, vencedora, identidade, "REEMBOLSO");
    return replay.ok
      ? {
          ok: true,
          reembolsoId: replay.id,
          replay: true,
          statusFinanceiro: replay.statusFinanceiro,
          saldoCentavos: replay.saldoCentavos,
        }
      : { ok: false, erro: replay.erro };
  };

  // Com operation key, o refund e o claim vivem no MESMO batch (atômico).
  // Sem key, o caminho continua sendo exatamente o `.run()` de uma única
  // instrução que já existia — nenhuma mudança de comportamento nos
  // chamadores internos.
  let result;
  try {
    result = operationKey && identidade
      ? (
          await db.batch([
            insercao,
            prepareClaimOperacao(db, {
              key: operationKey,
              ...identidade,
              fase: "CONCLUIDA",
              fonte: fonteReembolso(idempotencyKey),
            }),
          ])
        )[0]
      : await insercao.run();
  } catch (err) {
    // Disputa da mesma key (UNIQUE de `idempotency_key` do refund ou de
    // `operation_key`): o batch do perdedor foi revertido inteiro e ele
    // recupera a vencedora. Qualquer outra falha continua propagando, como
    // antes — não é papel deste helper mascarar erro inesperado.
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    throw err;
  }

  if (Number(result?.meta?.changes || 0) === 0) {
    // Saldo reembolsável recalculado no momento da escrita não cobriu o
    // valor pedido — outra requisição pode ter consumido o saldo entre
    // nossa leitura e o commit. Determinístico, sem DELETE de compensação
    // (mesmo padrão do 4d). O claim também não foi inserido: sua fonte
    // depende da existência do refund.
    return { ok: false, erro: "SALDO_REEMBOLSAVEL_INSUFICIENTE" };
  }

  const reembolsoId = Number(result.meta.last_row_id);
  const derivados = await reconcilePersistedAdminFact(db, params.pedidoId, "REEMBOLSO", reembolsoId);
  return { ok: true, reembolsoId, ...derivados };
}
