// Baixa o estoque uma única vez por pedido. D1 executa batch de forma atômica:
// ou as duas alterações são confirmadas, ou nenhuma é.
export async function baixarEstoquePedido(env, pedidoId) {
  const pedido = await env.DB.prepare(`
    SELECT id, produto_id, quantidade, status_pagamento, estoque_baixado_em
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();

  if (!pedido || pedido.status_pagamento !== "PAGO" || pedido.estoque_baixado_em) {
    return { ok: true, baixado: false };
  }

  const produto = await env.DB.prepare(
    "SELECT id, estoque FROM produtos WHERE id = ? LIMIT 1"
  ).bind(pedido.produto_id).first();

  if (!produto) return { ok: false, erro: "PRODUTO_NAO_ENCONTRADO" };
  if (Number(produto.estoque) < Number(pedido.quantidade)) {
    console.error(`Estoque insuficiente para pedido #${pedido.id}: disponível=${produto.estoque}, necessário=${pedido.quantidade}`);
    return { ok: false, erro: "ESTOQUE_INSUFICIENTE" };
  }

  const [produtoResult, pedidoResult] = await env.DB.batch([
    env.DB.prepare(`
      UPDATE produtos
      SET estoque = estoque - ?,
          disponivel = CASE WHEN estoque - ? <= 0 THEN 0 ELSE disponivel END,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND estoque >= ?
        AND EXISTS (SELECT 1 FROM pedidos WHERE id = ? AND estoque_baixado_em IS NULL AND status_pagamento = 'PAGO')
    `).bind(pedido.quantidade, pedido.quantidade, pedido.produto_id, pedido.quantidade, pedido.id),
    env.DB.prepare(`
      UPDATE pedidos
      SET estoque_baixado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND estoque_baixado_em IS NULL AND changes() = 1
    `).bind(pedido.id)
  ]);

  const baixado = Number(produtoResult?.meta?.changes || 0) === 1 && Number(pedidoResult?.meta?.changes || 0) === 1;
  return { ok: true, baixado };
}
