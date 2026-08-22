async function itemSemEstoque(env, pedidoId) {
  return env.DB.prepare(`
    SELECT MIN(i.id) AS id, i.produto_id, MIN(i.produto_nome) AS produto_nome,
           SUM(i.quantidade) AS quantidade, COALESCE(p.estoque, 0) AS estoque
    FROM pedido_itens i
    LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.pedido_id = ? AND i.estoque_baixado_em IS NULL
    GROUP BY i.produto_id, p.estoque
    HAVING i.produto_id IS NULL OR p.id IS NULL OR p.estoque < SUM(i.quantidade)
    ORDER BY MIN(i.id) LIMIT 1
  `).bind(pedidoId).first();
}

// O batch D1 é uma transação: a guarda inicial falha se qualquer produto não
// comportar a soma dos itens pendentes e, nesse caso, nenhuma baixa é aplicada.
export async function baixarEstoquePedido(env, pedidoId) {
  const pedido = await env.DB.prepare(`
    SELECT id, status_pagamento, estoque_baixado_em
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();
  if (!pedido || pedido.status_pagamento !== "PAGO" || pedido.estoque_baixado_em) {
    return { ok: true, baixado: false };
  }

  const { results } = await env.DB.prepare(`
    SELECT id, produto_id, produto_nome, quantidade
    FROM pedido_itens
    WHERE pedido_id = ? AND estoque_baixado_em IS NULL
    ORDER BY id
  `).bind(pedidoId).all();
  const itens = results || [];
  if (!itens.length) return { ok: false, baixado: false, erro: "ITENS_NAO_ENCONTRADOS" };
  const insuficienteInicial = await itemSemEstoque(env, pedidoId);
  if (insuficienteInicial) {
    const erro = insuficienteInicial.produto_id ? "ESTOQUE_INSUFICIENTE" : "PRODUTO_NAO_ENCONTRADO";
    return { ok: false, baixado: false, erro, item_id: insuficienteInicial.id };
  }

  const statements = [
    // quantidade=0 viola deliberadamente o CHECK da tabela somente quando a
    // tentativa completa não puder ser atendida. A falha reverte todo o batch.
    env.DB.prepare(`
      INSERT INTO pedido_itens (
        pedido_id, produto_id, produto_nome, quantidade,
        valor_unitario_centavos, valor_total_centavos
      )
      SELECT ?, NULL, '__stock_atomicity_guard__', 0, 0, 0
      WHERE EXISTS (
        SELECT 1
        FROM (
          SELECT produto_id, SUM(quantidade) AS quantidade
          FROM pedido_itens
          WHERE pedido_id = ? AND estoque_baixado_em IS NULL
          GROUP BY produto_id
        ) pendente
        LEFT JOIN produtos p ON p.id = pendente.produto_id
        WHERE pendente.produto_id IS NULL OR p.id IS NULL OR p.estoque < pendente.quantidade
      )
    `).bind(pedidoId, pedidoId)
  ];
  for (const item of itens) {
    statements.push(
      env.DB.prepare(`
        UPDATE produtos
        SET estoque = estoque - ?,
            disponivel = CASE WHEN estoque - ? <= 0 THEN 0 ELSE disponivel END,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND estoque >= ?
          AND EXISTS (
            SELECT 1 FROM pedido_itens i
            JOIN pedidos p ON p.id = i.pedido_id
            WHERE i.id = ? AND i.estoque_baixado_em IS NULL AND p.status_pagamento = 'PAGO'
          )
      `).bind(item.quantidade, item.quantidade, item.produto_id, item.quantidade, item.id),
      env.DB.prepare(`
        UPDATE pedido_itens SET estoque_baixado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND estoque_baixado_em IS NULL AND changes() = 1
      `).bind(item.id)
    );
  }
  statements.push(env.DB.prepare(`
    UPDATE pedidos SET estoque_baixado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ? AND estoque_baixado_em IS NULL AND status_pagamento = 'PAGO'
      AND NOT EXISTS (
        SELECT 1 FROM pedido_itens WHERE pedido_id = ? AND estoque_baixado_em IS NULL
      )
  `).bind(pedidoId, pedidoId));

  try {
    const results = await env.DB.batch(statements);
    const pedidoResult = results[results.length - 1];
    return { ok: true, baixado: Number(pedidoResult?.meta?.changes || 0) === 1 };
  } catch (err) {
    const insuficiente = await itemSemEstoque(env, pedidoId);
    if (!insuficiente) throw err;
    const erro = insuficiente.produto_id ? "ESTOQUE_INSUFICIENTE" : "PRODUTO_NAO_ENCONTRADO";
    console.error(`Estoque não baixado no pedido #${pedidoId}: item=${insuficiente.produto_nome}, disponível=${insuficiente.estoque}, necessário=${insuficiente.quantidade}`);
    return { ok: false, baixado: false, erro, item_id: insuficiente.id };
  }
}
