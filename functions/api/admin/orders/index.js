import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../../lib/mercadoPago.js";
import { notifyPaidOrder } from "../../../lib/push.js";

const RECONCILE_AFTER_SECONDS = 15;
const RECONCILE_BATCH_SIZE = 4;

async function reconcilePendingOrders(env) {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(`
    SELECT id, mp_order_id
    FROM pedidos
    WHERE status_pagamento = 'PENDENTE'
      AND mp_order_id IS NOT NULL
      AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    ORDER BY atualizado_em ASC, id ASC
    LIMIT ?
  `).bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE).all();

  const pending = results || [];
  if (!pending.length) return;

  await Promise.allSettled(pending.map(async (pedido) => {
    try {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
      const localStatus = mpOrderToLocalStatus(order);
      const payment = paymentFromOrder(order);

      await env.DB.prepare(`
        UPDATE pedidos SET
          status_pagamento = ?,
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
        localStatus,
        order?.status || null,
        order?.status_detail || null,
        payment.paymentId,
        localStatus,
        pedido.id
      ).run();
      if (localStatus === 'PAGO') await notifyPaidOrder(env, pedido.id);
    } catch (err) {
      // A reconciliação é uma rede de segurança. Falha ao consultar o MP não
      // deve derrubar a tela administrativa nem gerar uma tempestade de retries.
      console.error("Reconciliação Mercado Pago:", pedido.id, err?.status, err?.data || err?.message);
      await env.DB.prepare(
        "UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(pedido.id).run();
    }
  }));
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  // O webhook continua sendo a via principal. Esta reconciliação cobre casos
  // em que o evento final do Mercado Pago não chega (especialmente sandbox),
  // sem depender da aba do cliente permanecer aberta.
  await reconcilePendingOrders(env);

  const { results } = await env.DB.prepare(`
    SELECT id, token_publico, produto_id, produto_nome, quantidade,
      valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
      cliente_whatsapp, tipo_entrega, observacao, metodo_pagamento, status_pagamento, status_pedido,
      mp_order_id, mp_payment_id, mp_status, mp_status_detail,
      criado_em, atualizado_em, pago_em
    FROM pedidos ORDER BY id DESC LIMIT 250
  `).all();
  return json({ pedidos: results || [] });
}
