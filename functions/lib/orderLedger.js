import { logEvent } from "./logger.js";

const PAID_STATUS = "PAGO";

export function ledgerPaymentMethod(value) {
  switch (String(value || "").toUpperCase()) {
    case "PIX":
    case "PIX_MP":
      return "PIX_MP";
    case "PIX_EXTERNO":
      return "PIX_EXTERNO";
    case "CARTAO":
      return "CARTAO";
    case "DINHEIRO":
      return "DINHEIRO";
    default:
      return "A_COMBINAR";
  }
}

export function ledgerPaymentStatus(value) {
  switch (String(value || "").toUpperCase()) {
    case "PENDENTE":
      return "PENDENTE";
    case "PAGO":
      return "PAGO";
    case "CANCELADO":
      return "CANCELADO";
    case "EXPIRADO":
      return "EXPIRADO";
    case "REEMBOLSADO":
      return "REEMBOLSADO";
    default:
      return "FALHOU";
  }
}

export function financialStatus(totalCents, paidCents) {
  const total = Math.max(0, Number(totalCents || 0));
  const paid = Math.max(0, Number(paidCents || 0));
  if (paid <= 0) return "PENDENTE";
  if (paid < total) return "PARCIAL";
  return "PAGO";
}

export async function syncOrderPaymentLedger(env, {
  pedido,
  status,
  mpOrderId = null,
  mpPaymentId = null,
  mpStatus = null,
  mpStatusDetail = null,
  ticketUrl = null,
  qrCode = null,
  qrCodeBase64 = null
}) {
  if (!pedido?.id || !Number(pedido.valor_total_centavos)) return { ok: false, skipped: true };

  const resolvedStatus = ledgerPaymentStatus(status);
  const resolvedMpOrderId = mpOrderId ? String(mpOrderId) : null;
  const method = ledgerPaymentMethod(pedido.metodo_pagamento);
  const origin = pedido.origem_pedido === "SITE" ? "SITE" : "ADMIN";

  try {
    let existing = null;
    if (resolvedMpOrderId) {
      existing = await env.DB.prepare(
        "SELECT id FROM pedido_pagamentos WHERE mp_order_id = ? LIMIT 1"
      )
        .bind(resolvedMpOrderId)
        .first();
    }
    if (!existing && pedido.idempotency_key) {
      existing = await env.DB.prepare(
        "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? AND idempotency_key = ? LIMIT 1"
      )
        .bind(pedido.id, pedido.idempotency_key)
        .first();
    }

    let paymentId = Number(existing?.id || 0);
    if (paymentId) {
      await env.DB.prepare(
        `UPDATE pedido_pagamentos SET
           metodo = ?, origem = ?, valor_centavos = ?, status = ?,
           mp_order_id = COALESCE(?, mp_order_id),
           mp_payment_id = COALESCE(?, mp_payment_id),
           mp_status = ?, mp_status_detail = ?,
           mp_ticket_url = COALESCE(?, mp_ticket_url),
           mp_qr_code = COALESCE(?, mp_qr_code),
           mp_qr_code_base64 = COALESCE(?, mp_qr_code_base64),
           atualizado_em = CURRENT_TIMESTAMP,
           pago_em = CASE WHEN ? = 'PAGO' AND pago_em IS NULL THEN CURRENT_TIMESTAMP ELSE pago_em END,
           cancelado_em = CASE WHEN ? = 'CANCELADO' AND cancelado_em IS NULL THEN CURRENT_TIMESTAMP ELSE cancelado_em END
         WHERE id = ?`
      )
        .bind(
          method,
          origin,
          Number(pedido.valor_total_centavos),
          resolvedStatus,
          resolvedMpOrderId,
          mpPaymentId,
          mpStatus,
          mpStatusDetail,
          ticketUrl,
          qrCode,
          qrCodeBase64,
          resolvedStatus,
          resolvedStatus,
          paymentId
        )
        .run();
    } else {
      const inserted = await env.DB.prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           mp_order_id, mp_payment_id, mp_status, mp_status_detail,
           mp_ticket_url, mp_qr_code, mp_qr_code_base64, idempotency_key,
           pago_em, cancelado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN ? = 'CANCELADO' THEN CURRENT_TIMESTAMP ELSE NULL END)`
      )
        .bind(
          pedido.id,
          method,
          origin,
          Number(pedido.valor_total_centavos),
          resolvedStatus,
          resolvedMpOrderId,
          mpPaymentId,
          mpStatus,
          mpStatusDetail,
          ticketUrl,
          qrCode,
          qrCodeBase64,
          pedido.idempotency_key || null,
          resolvedStatus,
          resolvedStatus
        )
        .run();
      paymentId = Number(inserted?.meta?.last_row_id || 0);
    }

    if (paymentId) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
         SELECT ?, id, valor_total_centavos
         FROM pedido_itens
         WHERE pedido_id = ? AND valor_total_centavos > 0`
      )
        .bind(paymentId, pedido.id)
        .run();
    }

    return { ok: true, paymentId };
  } catch (error) {
    logEvent("error", "ledger.sync_failed", {
      pedido_id: pedido.id,
      mp_order_id: resolvedMpOrderId || undefined,
      reason: String(error?.message || "LEDGER_SYNC_FAILED").slice(0, 180)
    });
    return { ok: false, erro: "LEDGER_SYNC_FAILED" };
  }
}

export async function attachOrderFinancials(env, orders) {
  if (!Array.isArray(orders) || !orders.length) return orders || [];

  const ids = orders.map(order => Number(order.id)).filter(Number.isInteger);
  if (!ids.length) return orders;
  const placeholders = ids.map(() => "?").join(",");

  const { results: payments } = await env.DB.prepare(
    `SELECT id, pedido_id, metodo, origem, valor_centavos, status,
            mp_order_id, mp_payment_id, mp_status, mp_status_detail,
            substitui_pagamento_id, registrado_por_usuario_id, observacao,
            criado_em, atualizado_em, pago_em, cancelado_em
     FROM pedido_pagamentos
     WHERE pedido_id IN (${placeholders})
     ORDER BY pedido_id DESC, criado_em ASC, id ASC`
  )
    .bind(...ids)
    .all();

  const { results: allocations } = await env.DB.prepare(
    `SELECT a.pagamento_id, a.pedido_item_id, a.valor_centavos, p.pedido_id, p.status
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE p.pedido_id IN (${placeholders})
     ORDER BY a.id ASC`
  )
    .bind(...ids)
    .all();

  const paymentsByOrder = new Map();
  for (const payment of payments || []) {
    const pedidoId = Number(payment.pedido_id);
    if (!paymentsByOrder.has(pedidoId)) paymentsByOrder.set(pedidoId, []);
    paymentsByOrder.get(pedidoId).push(payment);
  }

  const paidByItem = new Map();
  for (const allocation of allocations || []) {
    if (allocation.status !== PAID_STATUS) continue;
    const itemId = Number(allocation.pedido_item_id);
    paidByItem.set(itemId, (paidByItem.get(itemId) || 0) + Number(allocation.valor_centavos || 0));
  }

  for (const order of orders) {
    const orderPayments = paymentsByOrder.get(Number(order.id)) || [];
    const paid = orderPayments
      .filter(payment => payment.status === PAID_STATUS)
      .reduce((sum, payment) => sum + Number(payment.valor_centavos || 0), 0);
    const total = Number(order.valor_total_centavos || 0);

    order.pagamentos = orderPayments;
    order.valor_pago_centavos = paid;
    order.saldo_centavos = Math.max(0, total - paid);
    order.credito_centavos = Math.max(0, paid - total);
    order.status_financeiro = financialStatus(total, paid);

    for (const item of order.itens || []) {
      const itemTotal = Number(item.valor_total_centavos || 0);
      const itemPaid = Math.min(itemTotal, paidByItem.get(Number(item.id)) || 0);
      item.valor_pago_centavos = itemPaid;
      item.saldo_centavos = Math.max(0, itemTotal - itemPaid);
      item.status_financeiro = financialStatus(itemTotal, itemPaid);
    }
  }

  return orders;
}
