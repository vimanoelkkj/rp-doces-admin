import { json, sameOrigin } from "../../../../../lib/http.js";
import { requireUser } from "../../../../../lib/auth.js";
import {
  ensureLegacyPaymentMaterialized,
  recalculateComanda
} from "../../../../../lib/comandaLedger.js";
import { logEvent } from "../../../../../lib/logger.js";

function upper(value) {
  return String(value || "").toUpperCase();
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const itemId = Number(params.itemId);
  if (!Number.isInteger(pedidoId) || pedidoId < 1 || !Number.isInteger(itemId) || itemId < 1) {
    return json({ erro: "Item inválido." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_comanda, reserva_status
     FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (upper(pedido.status_comanda || "ABERTA") !== "ABERTA") {
    return json({ erro: "Esta comanda já foi encerrada e não pode ser editada." }, 409);
  }
  if (upper(pedido.status_pedido) === "CANCELADO") {
    return json({ erro: "Pedido cancelado não pode ser editado." }, 409);
  }

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  const item = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_total_centavos, estoque_baixado_em
     FROM pedido_itens
     WHERE id = ? AND pedido_id = ?
     LIMIT 1`
  )
    .bind(itemId, pedidoId)
    .first();
  if (!item) return json({ erro: "Item da comanda não encontrado." }, 404);

  const itemCount = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM pedido_itens WHERE pedido_id = ?"
  )
    .bind(pedidoId)
    .first();
  if (Number(itemCount?.total || 0) <= 1) {
    return json({ erro: "O último item não pode ser excluído. Cancele o pedido ou a comanda." }, 409);
  }

  const paid = await env.DB.prepare(
    `SELECT COALESCE(SUM(a.valor_centavos), 0) AS total
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND p.status = 'PAGO'`
  )
    .bind(itemId)
    .first();
  if (Number(paid?.total || 0) > 0) {
    return json({
      erro: "Este item já possui pagamento registrado. Estorne ou reembolse antes de excluí-lo."
    }, 409);
  }

  if (item.estoque_baixado_em) {
    return json({
      erro: "Este item já teve baixa de estoque. Faça a correção financeira/estoque antes de excluí-lo."
    }, 409);
  }

  const reservationActive = upper(pedido.reserva_status) === "ATIVA";
  const statements = [];

  if (reservationActive) {
    if (!Number(item.produto_id)) {
      return json({ erro: "O item não possui produto válido para liberar a reserva." }, 409);
    }

    statements.push(
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado - ?,
             disponivel = CASE
               WHEN ativo = 1 AND estoque - (estoque_reservado - ?) > 0 THEN 1
               ELSE 0
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?
           AND estoque_reservado >= ?
           AND EXISTS (
             SELECT 1
             FROM pedido_itens i
             WHERE i.id = ? AND i.pedido_id = ? AND i.estoque_baixado_em IS NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM pedido_pagamento_alocacoes a
                 JOIN pedido_pagamentos p ON p.id = a.pagamento_id
                 WHERE a.pedido_item_id = i.id AND p.status = 'PAGO' AND a.valor_centavos > 0
               )
               AND (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = ?) > 1
           )`
      ).bind(
        Number(item.quantidade),
        Number(item.quantidade),
        Number(item.produto_id),
        Number(item.quantidade),
        itemId,
        pedidoId,
        pedidoId
      )
    );
  }

  statements.push(
    env.DB.prepare(
      `DELETE FROM pedido_itens
       WHERE id = ? AND pedido_id = ? AND estoque_baixado_em IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM pedido_pagamento_alocacoes a
           JOIN pedido_pagamentos p ON p.id = a.pagamento_id
           WHERE a.pedido_item_id = pedido_itens.id AND p.status = 'PAGO' AND a.valor_centavos > 0
         )
         AND (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = ?) > 1
         ${reservationActive
           ? "AND EXISTS (SELECT 1 FROM produtos p WHERE p.id = pedido_itens.produto_id AND p.estoque_reservado >= pedido_itens.quantidade)"
           : ""}`
    ).bind(itemId, pedidoId, pedidoId)
  );

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "O estoque ou o financeiro mudou. Atualize e tente novamente." }, 409);
    }
    throw error;
  }

  const deleteResult = results?.[results.length - 1];
  const deleted = Number(deleteResult?.meta?.changes || 0) === 1;
  const stockReleased = !reservationActive || Number(results?.[0]?.meta?.changes || 0) === 1;
  if (!deleted || !stockReleased) {
    return json({ erro: "O item mudou enquanto era excluído. Atualize a comanda e tente novamente." }, 409);
  }

  const state = await recalculateComanda(env, pedidoId);

  const pendingStock = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM pedido_itens
     WHERE pedido_id = ? AND estoque_baixado_em IS NULL`
  )
    .bind(pedidoId)
    .first();

  if (Number(pendingStock?.total || 0) === 0) {
    await env.DB.prepare(
      `UPDATE pedidos
       SET estoque_baixado_em = COALESCE(estoque_baixado_em, CURRENT_TIMESTAMP),
           reserva_status = CASE WHEN reserva_status = 'ATIVA' THEN 'CONVERTIDA' ELSE reserva_status END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(pedidoId)
      .run();
  }

  logEvent("info", "comanda.item_deleted", {
    pedido_id: pedidoId,
    item_id: itemId,
    produto_id: item.produto_id || null,
    produto_nome: item.produto_nome || undefined,
    quantidade: Number(item.quantidade || 0),
    total_centavos: Number(item.valor_total_centavos || 0),
    usuario_id: auth.user.id
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    item_id: itemId,
    status_financeiro: state?.status_financeiro || "PENDENTE",
    total_centavos: state?.total_centavos || 0,
    pago_centavos: state?.pago_centavos || 0,
    saldo_centavos: state?.saldo_centavos || 0,
    credito_centavos: state?.credito_centavos || 0
  });
}
