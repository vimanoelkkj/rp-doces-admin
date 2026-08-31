import { mpOrderToLocalStatus, paymentFromOrder } from "./mercadoPago.js";
import { baixarEstoquePedido, liberarReservaPedido } from "./stock.js";
import { notifyPaidOrder } from "./push.js";
import { logEvent } from "./logger.js";

/**
 * Sincroniza o estado financeiro e metadados de um pedido a partir de um objeto Order do Mercado Pago.
 *
 * @param {object} env - Cloudflare environment (env.DB, etc.)
 * @param {object} params
 * @param {number} params.pedidoId - ID primário do pedido local
 * @param {object} params.order - Objeto Order retornado pelo Mercado Pago
 * @param {string|null} [params.mpOrderId] - ID de fallback da Order caso order.id esteja ausente
 * @param {object} [options]
 * @param {(promise: Promise<unknown>) => void} [options.waitUntil] - Agenda trabalho secundário após a resposta
 * @returns {Promise<{
 *   ok: boolean,
 *   pedidoId: number,
 *   status_pagamento: string,
 *   mp_status: string|null,
 *   mp_status_detail: string|null,
 *   pago_em: string|null,
 *   order: object
 * }>}
 */
export async function syncOrderPayment(env, { pedidoId, order, mpOrderId = null }, options = {}) {
  if (!pedidoId) throw new Error("pedidoId é obrigatório para sincronização.");
  if (!order) throw new Error("order do Mercado Pago é obrigatória para sincronização.");

  const pedidoAnterior = await env.DB.prepare(
    `
    SELECT status_pagamento FROM pedidos WHERE id = ? LIMIT 1
  `
  )
    .bind(pedidoId)
    .first();
  const statusAnterior = pedidoAnterior?.status_pagamento || null;

  const localStatus = mpOrderToLocalStatus(order);
  const payment = paymentFromOrder(order);
  const resolvedMpOrderId = order?.id ? String(order.id) : mpOrderId ? String(mpOrderId) : null;

  await env.DB.prepare(
    `
    UPDATE pedidos SET
      mp_order_id = COALESCE(?, mp_order_id),
      status_pagamento = CASE
        WHEN status_pagamento = 'REEMBOLSADO' THEN status_pagamento
        WHEN status_pagamento = 'PAGO' AND ? NOT IN ('PAGO', 'REEMBOLSADO') THEN status_pagamento
        ELSE ?
      END,
      mp_status = ?,
      mp_status_detail = ?,
      mp_payment_id = COALESCE(?, mp_payment_id),
      atualizado_em = CURRENT_TIMESTAMP,
      pago_em = CASE
        WHEN ? = 'PAGO' AND pago_em IS NULL THEN CURRENT_TIMESTAMP
        ELSE pago_em
      END
    WHERE id = ?
  `
  )
    .bind(
      resolvedMpOrderId,
      localStatus,
      localStatus,
      order?.status || null,
      order?.status_detail || null,
      payment.paymentId,
      localStatus,
      pedidoId
    )
    .run();

  const consolidado = await env.DB.prepare(
    `
    SELECT status_pagamento, mp_status, mp_status_detail, pago_em
    FROM pedidos WHERE id = ? LIMIT 1
  `
  )
    .bind(pedidoId)
    .first();

  const statusFinal = consolidado?.status_pagamento || localStatus;

  // Log de transição financeira efetiva (evita logs duplicados em webhooks repetidos)
  if (statusAnterior !== "PAGO" && statusFinal === "PAGO") {
    logEvent("info", "payment.paid", {
      pedido_id: pedidoId,
      mp_order_id: resolvedMpOrderId,
      status: "PAGO",
      mp_status: consolidado?.mp_status ?? order?.status ?? null
    });
  } else if (
    statusAnterior !== statusFinal &&
    ["REEMBOLSADO", "EXPIRADO", "CANCELADO", "FALHOU"].includes(statusFinal)
  ) {
    logEvent("info", "payment.status_updated", {
      pedido_id: pedidoId,
      mp_order_id: resolvedMpOrderId,
      status: statusFinal,
      mp_status: consolidado?.mp_status ?? order?.status ?? null
    });
  }

  // Estoque e reserva são parte crítica da consistência do pedido e continuam aguardados.
  // Push é efeito secundário: quando o runtime fornece waitUntil, ele pode terminar
  // depois da resposta sem atrasar webhook/polling. Sem waitUntil, mantemos o fallback
  // aguardado para preservar compatibilidade com testes e outros chamadores.
  if (localStatus === "PAGO") {
    const estoque = await baixarEstoquePedido(env, pedidoId);
    if (!estoque.ok) {
      logEvent("error", "stock.conversion_failed", {
        pedido_id: pedidoId,
        reason: "STOCK_CONVERSION_FAILED"
      });
    }

    const pushTask = notifyPaidOrder(env, pedidoId).catch(() => {
      logEvent("warn", "push.failed", {
        pedido_id: pedidoId,
        reason: "PUSH_FAILED"
      });
    });

    if (typeof options.waitUntil === "function") {
      options.waitUntil(pushTask);
    } else {
      await pushTask;
    }
  } else if (["EXPIRADO", "CANCELADO", "FALHOU"].includes(localStatus)) {
    await liberarReservaPedido(env, pedidoId, { novoStatus: localStatus });
  }

  return {
    ok: true,
    pedidoId,
    status_pagamento: statusFinal,
    mp_status: consolidado?.mp_status ?? order?.status ?? null,
    mp_status_detail: consolidado?.mp_status_detail ?? order?.status_detail ?? null,
    pago_em: consolidado?.pago_em ?? null,
    order
  };
}
