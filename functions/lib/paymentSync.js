import { mpOrderToLocalStatus, paymentFromOrder } from "./mercadoPago.js";
import { baixarEstoquePedido } from "./stock.js";
import { notifyPaidOrder } from "./push.js";

/**
 * Sincroniza o estado financeiro e metadados de um pedido a partir de um objeto Order do Mercado Pago.
 *
 * @param {object} env - Cloudflare environment (env.DB, etc.)
 * @param {object} params
 * @param {number} params.pedidoId - ID primário do pedido local
 * @param {object} params.order - Objeto Order retornado pelo Mercado Pago
 * @param {string|null} [params.mpOrderId] - ID de fallback da Order caso order.id esteja ausente
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
export async function syncOrderPayment(env, { pedidoId, order, mpOrderId = null }) {
  if (!pedidoId) throw new Error("pedidoId é obrigatório para sincronização.");
  if (!order) throw new Error("order do Mercado Pago é obrigatória para sincronização.");

  const localStatus = mpOrderToLocalStatus(order);
  const payment = paymentFromOrder(order);
  const resolvedMpOrderId = order?.id ? String(order.id) : (mpOrderId ? String(mpOrderId) : null);

  await env.DB.prepare(`
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
  `).bind(
    resolvedMpOrderId,
    localStatus,
    localStatus,
    order?.status || null,
    order?.status_detail || null,
    payment.paymentId,
    localStatus,
    pedidoId
  ).run();

  const consolidado = await env.DB.prepare(`
    SELECT status_pagamento, mp_status, mp_status_detail, pago_em
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();

  const statusFinal = consolidado?.status_pagamento || localStatus;

  // Efeitos colaterais pós-pagamento só são disparados quando a Order atual representar PAGO
  if (localStatus === "PAGO") {
    const estoque = await baixarEstoquePedido(env, pedidoId);
    if (!estoque.ok) console.error("Falha na baixa de estoque:", estoque.erro, "pedido", pedidoId);
    await notifyPaidOrder(env, pedidoId);
  }

  return {
    ok: true,
    pedidoId,
    status_pagamento: statusFinal,
    mp_status: consolidado?.mp_status ?? order?.status ?? null,
    mp_status_detail: consolidado?.mp_status_detail ?? order?.status_detail ?? null,
    pago_em: consolidado?.pago_em ?? null,
    order,
  };
}
