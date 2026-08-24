import { json } from "../../lib/http.js";
import { mpRequest } from "../../lib/mercadoPago.js";
import { syncOrderPayment } from "../../lib/paymentSync.js";
import { logEvent } from "../../lib/logger.js";

export async function onRequestGet({ params, env }) {
  const token = String(params.token || "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ erro: "Pedido inválido." }, 400);

  let pedido = await env.DB.prepare(`
    SELECT id, token_publico, produto_nome, quantidade, valor_total_centavos,
           status_pagamento, mp_order_id, mp_status, mp_status_detail, pago_em,
           pix_expira_em
    FROM pedidos WHERE token_publico = ? LIMIT 1
  `).bind(token).first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);

  const { results: itens } = await env.DB.prepare(`
    SELECT produto_id, produto_nome AS produto, quantidade,
           valor_unitario_centavos, valor_total_centavos
    FROM pedido_itens WHERE pedido_id = ? ORDER BY id
  `).bind(pedido.id).all();

  // Enquanto estiver pendente, confirma o estado diretamente no Mercado Pago.
  // Assim o fluxo continua confiável mesmo se um webhook atrasar.
  if (pedido.mp_order_id && pedido.status_pagamento === "PENDENTE" && env.MP_ACCESS_TOKEN) {
    try {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
      const synced = await syncOrderPayment(env, { pedidoId: pedido.id, order, mpOrderId: pedido.mp_order_id });
      pedido.status_pagamento = synced.status_pagamento;
      pedido.mp_status = synced.mp_status;
      pedido.mp_status_detail = synced.mp_status_detail;
      pedido.pago_em = synced.pago_em;
    } catch (err) {
      logEvent("warn", "payment.sync_failed", {
        pedido_id: pedido.id,
        mp_order_id: pedido.mp_order_id,
        http_status: err?.status || undefined,
        reason: err?.status ? "MP_HTTP_ERROR" : "MP_TIMEOUT"
      });
    }
  }

  return json({
    pedido: {
      token: pedido.token_publico,
      produto: pedido.produto_nome,
      quantidade: pedido.quantidade,
      quantidade_total: pedido.quantidade,
      itens: itens || [],
      valor_total_centavos: pedido.valor_total_centavos,
      status: pedido.status_pagamento,
      mp_status: pedido.mp_status,
      mp_status_detail: pedido.mp_status_detail,
      pago_em: pedido.pago_em,
      pix_expira_em: pedido.pix_expira_em || null
    }
  });
}
