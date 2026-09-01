import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { attachOrderFinancials } from "../../../lib/orderLedger.js";
import { syncComandaPixCharge } from "../../../lib/comandaLedger.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../../lib/stock.js";
import { logEvent } from "../../../lib/logger.js";

const RECONCILE_BATCH_SIZE = 4;

async function reconcilePendingComandaPix(env) {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(
    `SELECT id, pedido_id, mp_order_id
     FROM pedido_pagamentos
     WHERE metodo = 'PIX_MP'
       AND origem = 'ADMIN'
       AND status = 'PENDENTE'
       AND mp_order_id IS NOT NULL
     ORDER BY atualizado_em ASC, id ASC
     LIMIT ?`
  )
    .bind(RECONCILE_BATCH_SIZE)
    .all();

  await Promise.allSettled((results || []).map(async charge => {
    try {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(charge.mp_order_id)}`);
      const payment = paymentFromOrder(order);
      const synced = await syncComandaPixCharge(env, {
        pedidoId: Number(charge.pedido_id),
        mpOrderId: String(charge.mp_order_id),
        status: mpOrderToLocalStatus(order),
        mpPaymentId: payment.paymentId,
        mpStatus: order?.status || null,
        mpStatusDetail: order?.status_detail || null,
        ticketUrl: payment.ticketUrl,
        qrCode: payment.qrCode,
        qrCodeBase64: payment.qrCodeBase64
      });
      if (synced.ok && synced.status_financeiro === "PAGO") {
        await baixarEstoquePedido(env, Number(charge.pedido_id));
      }
    } catch (error) {
      logEvent("warn", "payment.sync_failed", {
        pedido_id: Number(charge.pedido_id),
        mp_order_id: String(charge.mp_order_id),
        http_status: error?.status || undefined,
        reason: error?.status ? "MP_HTTP_ERROR" : "MP_RECONCILIATION_FAILED"
      });
    }
  }));
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  await reconcilePendingComandaPix(env);

  const { results } = await env.DB.prepare(
    `SELECT id, token_publico, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos,
            cliente_nome, cliente_email, cliente_whatsapp,
            tipo_entrega, observacao, metodo_pagamento,
            status_pagamento, status_pedido, status_comanda, origem_pedido,
            mp_order_id, mp_payment_id, mp_status, mp_status_detail,
            criado_em, atualizado_em, pago_em
     FROM pedidos
     WHERE arquivado = 0
     ORDER BY id DESC
     LIMIT 250`
  ).all();

  const pedidos = results || [];
  if (!pedidos.length) return json({ pedidos: [] });

  const ids = pedidos.map(pedido => Number(pedido.id));
  const placeholders = ids.map(() => "?").join(",");
  const { results: itemRows } = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos,
            estoque_baixado_em, criado_em,
            adicionado_por_usuario_id, adicionado_em
     FROM pedido_itens
     WHERE pedido_id IN (${placeholders})
     ORDER BY pedido_id DESC, id ASC`
  )
    .bind(...ids)
    .all();

  const itemsByOrder = new Map();
  for (const item of itemRows || []) {
    const pedidoId = Number(item.pedido_id);
    if (!itemsByOrder.has(pedidoId)) itemsByOrder.set(pedidoId, []);
    itemsByOrder.get(pedidoId).push(item);
  }
  for (const pedido of pedidos) pedido.itens = itemsByOrder.get(Number(pedido.id)) || [];

  await attachOrderFinancials(env, pedidos);

  const { results: chargeMetadata } = await env.DB.prepare(
    `SELECT id, mp_ticket_url, mp_qr_code, mp_qr_code_base64, pix_expira_em
     FROM pedido_pagamentos
     WHERE pedido_id IN (${placeholders})`
  )
    .bind(...ids)
    .all();
  const metadataByPayment = new Map((chargeMetadata || []).map(row => [Number(row.id), row]));

  for (const pedido of pedidos) {
    for (const pagamento of pedido.pagamentos || []) {
      const metadata = pagamento.id == null ? null : metadataByPayment.get(Number(pagamento.id));
      if (!metadata) continue;
      pagamento.mp_ticket_url = metadata.mp_ticket_url || null;
      pagamento.mp_qr_code = metadata.mp_qr_code || null;
      pagamento.mp_qr_code_base64 = metadata.mp_qr_code_base64 || null;
      pagamento.pix_expira_em = metadata.pix_expira_em || null;
    }
  }

  return json({ pedidos });
}
