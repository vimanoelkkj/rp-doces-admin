import { logEvent } from "./logger.js";

export async function releaseOpenComandaReservations(env, pedidoId) {
  const pedido = await env.DB.prepare(
    `SELECT id, reserva_status FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido || pedido.reserva_status !== "ATIVA") return { ok: true, liberado: false };

  const { results } = await env.DB.prepare(
    `SELECT produto_id, SUM(quantidade) AS quantidade
     FROM pedido_itens
     WHERE pedido_id = ? AND estoque_baixado_em IS NULL
     GROUP BY produto_id
     ORDER BY produto_id`
  )
    .bind(pedidoId)
    .all();

  const items = results || [];
  if (!items.length) {
    await env.DB.prepare(
      `UPDATE pedidos SET reserva_status = 'LIBERADA', reserva_liberada_em = CURRENT_TIMESTAMP,
       atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND reserva_status = 'ATIVA'`
    ).bind(pedidoId).run();
    return { ok: true, liberado: true };
  }

  for (const item of items) {
    const product = await env.DB.prepare(
      "SELECT estoque_reservado FROM produtos WHERE id = ? LIMIT 1"
    ).bind(item.produto_id).first();
    if (!product || Number(product.estoque_reservado || 0) < Number(item.quantidade || 0)) {
      logEvent("error", "stock.reservation_failed", {
        pedido_id: pedidoId,
        reason: "RESERVATION_RELEASE_FAILED"
      });
      return { ok: false, erro: "ESTOQUE_RESERVADO_INSUFICIENTE" };
    }
  }

  const statements = items.map(item =>
    env.DB.prepare(
      `UPDATE produtos SET
         estoque_reservado = estoque_reservado - ?,
         disponivel = CASE WHEN estoque - (estoque_reservado - ?) > 0 THEN 1 ELSE disponivel END,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND estoque_reservado >= ?`
    ).bind(item.quantidade, item.quantidade, item.produto_id, item.quantidade)
  );
  statements.push(
    env.DB.prepare(
      `UPDATE pedidos SET
         reserva_status = 'LIBERADA', reserva_liberada_em = CURRENT_TIMESTAMP,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND reserva_status = 'ATIVA'`
    ).bind(pedidoId)
  );

  try {
    const resultsBatch = await env.DB.batch(statements);
    const orderResult = resultsBatch[resultsBatch.length - 1];
    const released = Number(orderResult?.meta?.changes || 0) === 1;
    if (released) {
      logEvent("info", "stock.reservation_released", {
        pedido_id: pedidoId,
        reservation_status: "LIBERADA"
      });
    }
    return { ok: true, liberado: released };
  } catch {
    logEvent("error", "stock.reservation_failed", {
      pedido_id: pedidoId,
      reason: "RESERVATION_RELEASE_FAILED"
    });
    return { ok: false, erro: "ERRO_BATCH_LIBERACAO" };
  }
}
