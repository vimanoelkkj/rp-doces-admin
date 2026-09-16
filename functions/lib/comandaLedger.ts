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
