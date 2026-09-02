import { json } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { attachOrderFinancials } from "../../../../lib/orderLedger.js";
import { syncComandaPixCharge } from "../../../../lib/comandaLedger.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../../../lib/stock.js";
import { logEvent } from "../../../../lib/logger.js";

async function reconcilePendingPix(env, pedidoId) {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(
    `SELECT id, mp_order_id
     FROM pedido_pagamentos
     WHERE pedido_id = ?
       AND metodo = 'PIX_MP'
       AND origem = 'ADMIN'
       AND status = 'PENDENTE'
       AND mp_order_id IS NOT NULL
     ORDER BY atualizado_em ASC, id ASC`
  )
    .bind(pedidoId)
    .all();

  await Promise.allSettled((results || []).map(async charge => {
    try {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(charge.mp_order_id)}`);
      const payment = paymentFromOrder(order);
      const synced = await syncComandaPixCharge(env, {
        pedidoId,
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
        await baixarEstoquePedido(env, pedidoId);
      }
    } catch (error) {
      logEvent("warn", "payment.sync_failed", {
        pedido_id: pedidoId,
        mp_order_id: String(charge.mp_order_id),
        http_status: error?.status || undefined,
        reason: error?.status ? "MP_HTTP_ERROR" : "MP_RECONCILIATION_FAILED"
      });
    }
  }));
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return json({ erro: "Pedido inválido." }, 400);
  }

  await reconcilePendingPix(env, pedidoId);

  const pedido = await env.DB.prepare(
    `SELECT id, token_publico, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos,
            cliente_nome, cliente_email, cliente_whatsapp,
            tipo_entrega, observacao, metodo_pagamento,
            status_pagamento, status_pedido, status_comanda, origem_pedido,
            mp_order_id, mp_payment_id, mp_status, mp_status_detail,
            criado_em, atualizado_em, pago_em
     FROM pedidos
     WHERE id = ? AND arquivado = 0
     LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido) return json({ erro: "Comanda não encontrada." }, 404);

  const { results: itens } = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos,
            estoque_baixado_em, criado_em,
            adicionado_por_usuario_id, adicionado_em
     FROM pedido_itens
     WHERE pedido_id = ?
     ORDER BY id ASC`
  )
    .bind(pedidoId)
    .all();

  pedido.itens = itens || [];
  await attachOrderFinancials(env, [pedido]);

  const { results: chargeMetadata } = await env.DB.prepare(
    `SELECT id, mp_ticket_url, mp_qr_code, mp_qr_code_base64, pix_expira_em
     FROM pedido_pagamentos
     WHERE pedido_id = ?`
  )
    .bind(pedidoId)
    .all();

  const metadataByPayment = new Map((chargeMetadata || []).map(row => [Number(row.id), row]));
  for (const pagamento of pedido.pagamentos || []) {
    const metadata = pagamento.id == null ? null : metadataByPayment.get(Number(pagamento.id));
    if (!metadata) continue;
    pagamento.mp_ticket_url = metadata.mp_ticket_url || null;
    pagamento.mp_qr_code = metadata.mp_qr_code || null;
    pagamento.mp_qr_code_base64 = metadata.mp_qr_code_base64 || null;
    pagamento.pix_expira_em = metadata.pix_expira_em || null;
  }

  return json({ pedido });
}
