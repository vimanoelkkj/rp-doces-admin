import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { attachOrderFinancials } from "../../../lib/orderLedger.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

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
  return json({ pedidos });
}
