import { json, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { recalculateComanda } from "../../../../lib/comandaLedger.js";
import { reconcileActiveReservationsForOrder } from "../../../../lib/stockReservation.js";
import { logEvent } from "../../../../lib/logger.js";

async function confirmedPaidCents(env, pedido) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(valor_centavos), 0) AS total_centavos
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND status = 'PAGO'`
  )
    .bind(pedido.id)
    .first();

  const ledgerPaid = Number(row?.total_centavos || 0);
  if (ledgerPaid > 0) return ledgerPaid;

  return String(pedido.status_pagamento || "").toUpperCase() === "PAGO"
    ? Number(pedido.valor_total_centavos || 0)
    : 0;
}

async function pendingStockItems(env, pedidoId) {
  const { results } = await env.DB.prepare(
    `SELECT produto_id, SUM(quantidade) AS quantidade
     FROM pedido_itens
     WHERE pedido_id = ?
       AND produto_id IS NOT NULL
       AND estoque_baixado_em IS NULL
     GROUP BY produto_id
     ORDER BY produto_id`
  )
    .bind(pedidoId)
    .all();

  return (results || []).map(item => ({
    produto_id: Number(item.produto_id),
    quantidade: Number(item.quantidade || 0)
  }));
}

async function reservePendingStock(env, pedidoId, items) {
  if (!items.length) return { ok: true, reservou: false };

  for (const item of items) {
    const produto = await env.DB.prepare(
      `SELECT id, ativo, estoque, estoque_reservado
       FROM produtos
       WHERE id = ?
       LIMIT 1`
    )
      .bind(item.produto_id)
      .first();

    if (!produto || !produto.ativo) {
      return { ok: false, erro: "PRODUTO_NAO_ENCONTRADO", produto_id: item.produto_id };
    }

    const disponivel = Number(produto.estoque || 0) - Number(produto.estoque_reservado || 0);
    if (disponivel < item.quantidade) {
      return { ok: false, erro: "ESTOQUE_INSUFICIENTE", produto_id: item.produto_id };
    }
  }

  const statements = items.map(item =>
    env.DB.prepare(
      `UPDATE produtos
       SET estoque_reservado = estoque_reservado + ?,
           disponivel = 1,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(item.quantidade, item.produto_id)
  );

  await env.DB.batch(statements);
  return { ok: true, reservou: true };
}

function reopenError(result) {
  if (result?.erro === "ESTOQUE_INSUFICIENTE") {
    return json({
      erro: "Não há estoque disponível suficiente para reabrir esta comanda.",
      codigo: result.erro,
      produto_id: result.produto_id
    }, 409);
  }

  if (result?.erro === "PRODUTO_NAO_ENCONTRADO") {
    return json({
      erro: "Um produto desta comanda não existe mais no estoque.",
      codigo: result.erro,
      produto_id: result.produto_id
    }, 409);
  }

  return json({ erro: "Não foi possível reconstruir a reserva desta comanda." }, 409);
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) {
    return json({ erro: "Pedido inválido." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_pagamento, status_comanda,
            reserva_status, estoque_baixado_em, valor_total_centavos
     FROM pedidos
     WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);

  if (String(pedido.status_comanda || "ABERTA").toUpperCase() !== "ENCERRADA") {
    return json({ ok: true, pedido_id: pedidoId, ja_aberta: true });
  }

  const pagoCentavos = await confirmedPaidCents(env, pedido);
  const temPagamento = pagoCentavos > 0;
  const itensPendentesEstoque = await pendingStockItems(env, pedidoId);
  const reservaAtual = String(pedido.reserva_status || "SEM_RESERVA").toUpperCase();
  let reservaReconstruida = false;

  if (!temPagamento && !itensPendentesEstoque.length) {
    return json({
      erro: "Esta comanda não possui pagamento confirmado nem itens pendentes para reconstruir a reserva.",
      codigo: "COMANDA_SEM_PAGAMENTO_CONFIRMADO"
    }, 409);
  }

  if (!temPagamento && itensPendentesEstoque.length) {
    if (reservaAtual === "ATIVA") {
      await env.DB.prepare(
        `UPDATE pedidos
         SET status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
             status_pagamento = 'PENDENTE',
             status_comanda = 'ABERTA',
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(pedidoId)
        .run();

      const reconciliacao = await reconcileActiveReservationsForOrder(env, pedidoId);
      if (!reconciliacao.ok) return reopenError(reconciliacao);
    } else {
      const reserva = await reservePendingStock(env, pedidoId, itensPendentesEstoque);
      if (!reserva.ok) return reopenError(reserva);
      reservaReconstruida = reserva.reservou;

      await env.DB.prepare(
        `UPDATE pedidos SET
           status_comanda = 'ABERTA',
           status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
           status_pagamento = 'PENDENTE',
           pago_em = NULL,
           reserva_status = 'ATIVA',
           reserva_expira_em = NULL,
           reserva_liberada_em = NULL,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status_comanda = 'ENCERRADA'`
      )
        .bind(pedidoId)
        .run();
    }
  } else {
    const result = await env.DB.prepare(
      `UPDATE pedidos SET
         status_comanda = 'ABERTA',
         status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
         status_pagamento = CASE
           WHEN ? > 0 THEN status_pagamento
           ELSE 'PENDENTE'
         END,
         pago_em = CASE WHEN ? > 0 THEN pago_em ELSE NULL END,
         atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status_comanda = 'ENCERRADA'`
    )
      .bind(pagoCentavos, pagoCentavos, pedidoId)
      .run();

    if (Number(result?.meta?.changes || 0) !== 1) {
      return json({ erro: "Não foi possível reabrir a comanda." }, 409);
    }
  }

  const financeiro = await recalculateComanda(env, pedidoId);
  if (!financeiro) {
    return json({ erro: "A comanda foi reaberta, mas o financeiro não pôde ser reconciliado." }, 409);
  }

  logEvent("info", temPagamento ? "comanda.reopened_paid" : "comanda.reopened", {
    pedido_id: pedidoId,
    paid_cents: financeiro.pago_centavos,
    user_id: auth.user.id,
    stock_preserved: temPagamento || !reservaReconstruida
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    status_comanda: "ABERTA",
    status_pedido: String(pedido.status_pedido || "").toUpperCase() === "CANCELADO" ? "NOVO" : pedido.status_pedido,
    status_pagamento: financeiro.status_financeiro,
    valor_pago_centavos: financeiro.pago_centavos,
    saldo_centavos: financeiro.saldo_centavos,
    credito_centavos: financeiro.credito_centavos,
    estoque_preservado: temPagamento || !reservaReconstruida,
    reserva_reconstruida: reservaReconstruida
  });
}