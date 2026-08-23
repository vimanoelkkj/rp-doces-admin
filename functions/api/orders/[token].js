import { json } from "../../lib/http.js";
import { mpRequest, mpOrderToLocalStatus } from "../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../lib/stock.js";
import { notifyPaidOrder } from "../../lib/push.js";

export async function onRequestGet({ params, env }) {
  const token = String(params.token || "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ erro: "Pedido inválido." }, 400);

  let pedido = await env.DB.prepare(`
    SELECT id, token_publico, produto_nome, quantidade, valor_total_centavos,
           status_pagamento, mp_order_id, mp_status, mp_status_detail, pago_em
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
      const statusLocal = mpOrderToLocalStatus(order);
      await env.DB.prepare(`
        UPDATE pedidos SET
          status_pagamento = CASE
            WHEN status_pagamento = 'REEMBOLSADO' THEN status_pagamento
            WHEN status_pagamento = 'PAGO' AND ? NOT IN ('PAGO', 'REEMBOLSADO') THEN status_pagamento
            ELSE ?
          END,
          mp_status = ?,
          mp_status_detail = ?,
          atualizado_em = CURRENT_TIMESTAMP,
          pago_em = CASE WHEN ? = 'PAGO' AND pago_em IS NULL THEN CURRENT_TIMESTAMP ELSE pago_em END
        WHERE id = ?
      `).bind(
        statusLocal,
        statusLocal,
        order.status || null,
        order.status_detail || null,
        statusLocal,
        pedido.id
      ).run();

      const atualizado = await env.DB.prepare(`
        SELECT status_pagamento, mp_status, mp_status_detail, pago_em
        FROM pedidos WHERE id = ? LIMIT 1
      `).bind(pedido.id).first();
      if (atualizado) {
        pedido.status_pagamento = atualizado.status_pagamento;
        pedido.mp_status = atualizado.mp_status;
        pedido.mp_status_detail = atualizado.mp_status_detail;
        pedido.pago_em = atualizado.pago_em;
      }

      if (pedido.status_pagamento === "PAGO") {
        const estoque = await baixarEstoquePedido(env, pedido.id);
        if (!estoque.ok) console.error("Falha na baixa de estoque:", estoque.erro, "pedido", pedido.id);
        await notifyPaidOrder(env, pedido.id);
      }
    } catch (err) {
      console.error("Mercado Pago get order:", err?.status, err?.message);
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
    }
  });
}
