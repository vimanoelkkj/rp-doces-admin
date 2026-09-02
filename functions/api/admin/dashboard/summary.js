import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { attachOrderFinancials } from "../../../lib/orderLedger.js";

const SALES_WINDOW_DAYS = 30;
const MAX_DASHBOARD_ORDERS = 80;

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    `WITH candidatos AS (
       SELECT id, 0 AS prioridade
       FROM pedidos
       WHERE arquivado = 0
       ORDER BY id DESC
       LIMIT 6
     ),
     operacionais AS (
       SELECT id, 1 AS prioridade
       FROM pedidos
       WHERE arquivado = 0
         AND UPPER(COALESCE(status_pedido, '')) <> 'CANCELADO'
         AND (
           UPPER(COALESCE(status_pedido, 'NOVO')) NOT IN ('ENTREGUE')
           OR UPPER(COALESCE(status_pagamento, 'PENDENTE')) <> 'PAGO'
         )
     ),
     vendas_recentes AS (
       SELECT id, 2 AS prioridade
       FROM pedidos
       WHERE arquivado = 0
         AND UPPER(COALESCE(status_pedido, '')) <> 'CANCELADO'
         AND UPPER(COALESCE(status_pagamento, '')) = 'PAGO'
         AND COALESCE(pago_em, atualizado_em, criado_em) >= datetime('now', '-' || ? || ' days')
     ),
     ids AS (
       SELECT id, MIN(prioridade) AS prioridade
       FROM (
         SELECT * FROM candidatos
         UNION ALL SELECT * FROM operacionais
         UNION ALL SELECT * FROM vendas_recentes
       )
       GROUP BY id
       ORDER BY prioridade ASC, id DESC
       LIMIT ?
     )
     SELECT p.id, p.token_publico, p.produto_id, p.produto_nome, p.quantidade,
            p.valor_unitario_centavos, p.valor_total_centavos,
            p.cliente_nome, p.cliente_email, p.cliente_whatsapp,
            p.tipo_entrega, p.observacao, p.metodo_pagamento,
            p.status_pagamento, p.status_pedido, p.status_comanda, p.origem_pedido,
            p.mp_order_id, p.mp_payment_id, p.mp_status, p.mp_status_detail,
            p.criado_em, p.atualizado_em, p.pago_em
     FROM ids
     JOIN pedidos p ON p.id = ids.id
     ORDER BY p.id DESC`
  )
    .bind(SALES_WINDOW_DAYS, MAX_DASHBOARD_ORDERS)
    .all();

  const pedidos = results || [];
  if (!pedidos.length) {
    const { results: produtos } = await env.DB.prepare(
      `SELECT id, nome, categoria_id, categoria_nome, estoque, estoque_reservado, ativo, disponivel
       FROM produtos
       WHERE ativo = 1
       ORDER BY nome COLLATE NOCASE`
    ).all();
    return json({ pedidos: [], produtos: produtos || [] });
  }

  const ids = pedidos.map(pedido => Number(pedido.id));
  const placeholders = ids.map(() => "?").join(",");

  const [itemsResult, productsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
              valor_unitario_centavos, valor_total_centavos,
              estoque_baixado_em, criado_em,
              adicionado_por_usuario_id, adicionado_em
       FROM pedido_itens
       WHERE pedido_id IN (${placeholders})
       ORDER BY pedido_id DESC, id ASC`
    )
      .bind(...ids)
      .all(),
    env.DB.prepare(
      `SELECT id, nome, categoria_id, categoria_nome, estoque, estoque_reservado, ativo, disponivel
       FROM produtos
       WHERE ativo = 1
       ORDER BY nome COLLATE NOCASE`
    ).all()
  ]);

  const itemsByOrder = new Map();
  for (const item of itemsResult.results || []) {
    const pedidoId = Number(item.pedido_id);
    if (!itemsByOrder.has(pedidoId)) itemsByOrder.set(pedidoId, []);
    itemsByOrder.get(pedidoId).push(item);
  }
  for (const pedido of pedidos) pedido.itens = itemsByOrder.get(Number(pedido.id)) || [];

  await attachOrderFinancials(env, pedidos);

  return json({
    pedidos,
    produtos: productsResult.results || []
  });
}
