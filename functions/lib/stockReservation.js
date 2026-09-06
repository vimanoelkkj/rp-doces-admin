import { logEvent } from "./logger.js";

/**
 * Reconstrói o contador agregado produtos.estoque_reservado a partir da fonte
 * de verdade: itens ainda não baixados pertencentes a pedidos com reserva ATIVA.
 *
 * Isso recupera comandas antigas ou fluxos interrompidos em que o pedido ficou
 * marcado como ATIVA, mas o contador agregado do produto perdeu a reserva.
 * A reconciliação é feita para todos os produtos pendentes do pedido e só
 * grava depois de validar que o estoque físico comporta todas as reservas.
 */
export async function reconcileActiveReservationsForOrder(env, pedidoId) {
  const pedido = await env.DB.prepare(
    `SELECT id, reserva_status
     FROM pedidos
     WHERE id = ?
     LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido || String(pedido.reserva_status || "").toUpperCase() !== "ATIVA") {
    return { ok: true, reconciliado: false };
  }

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT produto_id
     FROM pedido_itens
     WHERE pedido_id = ?
       AND estoque_baixado_em IS NULL
       AND produto_id IS NOT NULL
     ORDER BY produto_id`
  )
    .bind(pedidoId)
    .all();

  const productIds = (results || [])
    .map(row => Number(row.produto_id))
    .filter(id => Number.isInteger(id) && id > 0);

  if (!productIds.length) return { ok: true, reconciliado: false };

  const states = [];
  for (const productId of productIds) {
    const state = await env.DB.prepare(
      `SELECT p.id, p.estoque,
              COALESCE((
                SELECT SUM(i.quantidade)
                FROM pedido_itens i
                JOIN pedidos o ON o.id = i.pedido_id
                WHERE i.produto_id = p.id
                  AND i.estoque_baixado_em IS NULL
                  AND o.reserva_status = 'ATIVA'
                  AND UPPER(COALESCE(o.status_pedido, 'NOVO')) <> 'CANCELADO'
              ), 0) AS reserva_esperada
       FROM produtos p
       WHERE p.id = ?
       LIMIT 1`
    )
      .bind(productId)
      .first();

    if (!state) {
      return { ok: false, erro: "PRODUTO_NAO_ENCONTRADO", produto_id: productId };
    }

    const estoque = Number(state.estoque || 0);
    const reservaEsperada = Number(state.reserva_esperada || 0);
    if (!Number.isSafeInteger(reservaEsperada) || reservaEsperada < 0 || estoque < reservaEsperada) {
      logEvent("warn", "stock.reservation_reconcile_failed", {
        pedido_id: pedidoId,
        product_id: productId,
        reason: "STOCK_INSUFFICIENT_FOR_ACTIVE_RESERVATIONS"
      });
      return {
        ok: false,
        erro: "ESTOQUE_INSUFICIENTE",
        produto_id: productId,
        estoque,
        reserva_esperada: reservaEsperada
      };
    }

    states.push({ productId, reservaEsperada });
  }

  const updates = states.map(({ productId, reservaEsperada }) =>
    env.DB.prepare(
      `UPDATE produtos
       SET estoque_reservado = ?,
           disponivel = CASE
             WHEN ativo = 1 AND estoque - ? > 0 THEN 1
             ELSE 0
           END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(reservaEsperada, reservaEsperada, productId)
  );

  if (updates.length) await env.DB.batch(updates);

  logEvent("info", "stock.reservation_reconciled", {
    pedido_id: pedidoId,
    quantity: states.length
  });

  return { ok: true, reconciliado: true, produtos: states.length };
}
