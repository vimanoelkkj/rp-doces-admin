import { json, bodyJson, sameOrigin } from "../../../../../../lib/http.js";
import { requireUser } from "../../../../../../lib/auth.js";
import {
  ensureLegacyPaymentMaterialized,
  recalculateComanda
} from "../../../../../../lib/comandaLedger.js";
import { baixarEstoquePedido } from "../../../../../../lib/stock.js";
import { logEvent } from "../../../../../../lib/logger.js";

function upper(value) {
  return String(value || "").toUpperCase();
}

async function paidAllocationsForItem(env, itemId) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.pagamento_id, a.valor_centavos
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND p.status = 'PAGO'
     ORDER BY a.id ASC`
  )
    .bind(itemId)
    .all();
  return results || [];
}

async function paidForItem(env, itemId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(a.valor_centavos), 0) AS total
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND p.status = 'PAGO'`
  )
    .bind(itemId)
    .first();
  return Number(row?.total || 0);
}

async function pendingAllocationForItem(env, itemId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND p.status = 'PENDENTE' AND a.valor_centavos > 0`
  )
    .bind(itemId)
    .first();
  return Number(row?.total || 0) > 0;
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const itemId = Number(params.itemId);
  const body = await bodyJson(request);
  const targetItemId = Number(body?.destino_item_id);

  if (
    !Number.isInteger(pedidoId) || pedidoId < 1 ||
    !Number.isInteger(itemId) || itemId < 1 ||
    !Number.isInteger(targetItemId) || targetItemId < 1 ||
    targetItemId === itemId
  ) {
    return json({ erro: "Itens da correção inválidos." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_comanda, reserva_status, estoque_baixado_em
     FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (upper(pedido.status_comanda || "ABERTA") !== "ABERTA") {
    return json({ erro: "Esta comanda já foi encerrada e não pode ser corrigida." }, 409);
  }
  if (upper(pedido.status_pedido) === "CANCELADO") {
    return json({ erro: "Pedido cancelado não pode ser corrigido." }, 409);
  }

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  const source = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_total_centavos, estoque_baixado_em
     FROM pedido_itens
     WHERE id = ? AND pedido_id = ?
     LIMIT 1`
  )
    .bind(itemId, pedidoId)
    .first();
  const target = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_total_centavos, estoque_baixado_em
     FROM pedido_itens
     WHERE id = ? AND pedido_id = ?
     LIMIT 1`
  )
    .bind(targetItemId, pedidoId)
    .first();

  if (!source) return json({ erro: "Produto pago não encontrado na comanda." }, 404);
  if (!target) return json({ erro: "Produto de destino não encontrado na comanda." }, 404);
  if (!Number(source.produto_id) || !Number(target.produto_id)) {
    return json({ erro: "Os produtos precisam existir no estoque para realizar a correção." }, 409);
  }

  if (await pendingAllocationForItem(env, itemId)) {
    return json({ erro: "O produto antigo ainda possui uma cobrança pendente. Cancele essa cobrança antes de corrigir o item." }, 409);
  }

  const sourceAllocations = await paidAllocationsForItem(env, itemId);
  const sourcePaid = sourceAllocations.reduce((sum, allocation) => sum + Number(allocation.valor_centavos || 0), 0);
  if (sourcePaid <= 0) {
    return json({ erro: "Este produto não possui pagamento confirmado para realocar." }, 409);
  }

  const targetPaid = await paidForItem(env, targetItemId);
  const targetOpen = Math.max(0, Number(target.valor_total_centavos || 0) - targetPaid);
  if (targetOpen <= 0) {
    return json({ erro: "O produto escolhido como destino já está totalmente pago." }, 409);
  }

  const transferTotal = Math.min(sourcePaid, targetOpen);
  let remainingTransfer = transferTotal;
  const statements = [];

  for (const allocation of sourceAllocations) {
    if (remainingTransfer <= 0) break;
    const amount = Math.min(Number(allocation.valor_centavos || 0), remainingTransfer);
    if (amount <= 0) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
         VALUES (?, ?, ?)
         ON CONFLICT(pagamento_id, pedido_item_id)
         DO UPDATE SET valor_centavos = valor_centavos + excluded.valor_centavos`
      ).bind(Number(allocation.pagamento_id), targetItemId, amount)
    );
    remainingTransfer -= amount;
  }

  const reservationActive = upper(pedido.reserva_status) === "ATIVA";
  const sourceWasDeducted = Boolean(source.estoque_baixado_em);
  const targetWasDeducted = Boolean(target.estoque_baixado_em);

  if (sourceWasDeducted) {
    statements.push(
      env.DB.prepare(
        `UPDATE produtos
         SET estoque = estoque + ?,
             disponivel = CASE
               WHEN ativo = 1 AND (estoque + ?) - estoque_reservado > 0 THEN 1
               ELSE disponivel
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(Number(source.quantidade), Number(source.quantidade), Number(source.produto_id))
    );
  } else if (reservationActive) {
    statements.push(
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado - ?,
             disponivel = CASE
               WHEN ativo = 1 AND estoque - (estoque_reservado - ?) > 0 THEN 1
               ELSE disponivel
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND estoque_reservado >= ?`
      ).bind(
        Number(source.quantidade),
        Number(source.quantidade),
        Number(source.produto_id),
        Number(source.quantidade)
      )
    );
  }

  if (!targetWasDeducted) {
    if (reservationActive) {
      statements.push(
        env.DB.prepare(
          `UPDATE produtos
           SET estoque = estoque - ?,
               estoque_reservado = estoque_reservado - ?,
               disponivel = CASE
                 WHEN ativo = 1 AND (estoque - ?) - (estoque_reservado - ?) > 0 THEN 1
                 ELSE 0
               END,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND estoque >= ? AND estoque_reservado >= ?`
        ).bind(
          Number(target.quantidade),
          Number(target.quantidade),
          Number(target.quantidade),
          Number(target.quantidade),
          Number(target.produto_id),
          Number(target.quantidade),
          Number(target.quantidade)
        )
      );
    } else {
      statements.push(
        env.DB.prepare(
          `UPDATE produtos
           SET estoque = estoque - ?,
               disponivel = CASE WHEN ativo = 1 AND estoque - ? - estoque_reservado > 0 THEN 1 ELSE 0 END,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND estoque >= ?`
        ).bind(
          Number(target.quantidade),
          Number(target.quantidade),
          Number(target.produto_id),
          Number(target.quantidade)
        )
      );
    }

    statements.push(
      env.DB.prepare(
        `UPDATE pedido_itens
         SET estoque_baixado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND pedido_id = ? AND estoque_baixado_em IS NULL`
      ).bind(targetItemId, pedidoId)
    );
  }

  statements.push(
    env.DB.prepare("DELETE FROM pedido_itens WHERE id = ? AND pedido_id = ?")
      .bind(itemId, pedidoId)
  );

  try {
    const results = await env.DB.batch(statements);
    const deleteResult = results?.[results.length - 1];
    if (Number(deleteResult?.meta?.changes || 0) !== 1) {
      return json({ erro: "A comanda mudou durante a correção. Atualize e tente novamente." }, 409);
    }
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "O estoque ou o financeiro mudou durante a correção. Atualize e tente novamente." }, 409);
    }
    throw error;
  }

  let state = await recalculateComanda(env, pedidoId);

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
  } else if (state?.status_financeiro === "PAGO") {
    const stock = await baixarEstoquePedido(env, pedidoId);
    if (!stock.ok) {
      logEvent("error", "comanda.item_reallocation_stock_failed", {
        pedido_id: pedidoId,
        item_id: itemId,
        destino_item_id: targetItemId
      });
      return json({
        ok: true,
        aviso: "O pagamento foi realocado, mas a baixa dos demais itens precisa ser reconciliada.",
        pedido_id: pedidoId,
        item_removido_id: itemId,
        destino_item_id: targetItemId,
        valor_realocado_centavos: transferTotal,
        credito_centavos: state?.credito_centavos || 0
      });
    }
    state = await recalculateComanda(env, pedidoId);
  }

  logEvent("info", "comanda.item_payment_reallocated", {
    pedido_id: pedidoId,
    item_id: itemId,
    produto_anterior_id: Number(source.produto_id),
    produto_anterior_nome: source.produto_nome || undefined,
    destino_item_id: targetItemId,
    produto_destino_id: Number(target.produto_id),
    produto_destino_nome: target.produto_nome || undefined,
    valor_realocado_centavos: transferTotal,
    valor_credito_centavos: Math.max(0, sourcePaid - transferTotal),
    estoque_antigo_reposto: sourceWasDeducted,
    estoque_destino_baixado: !targetWasDeducted,
    usuario_id: auth.user.id
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    item_removido_id: itemId,
    destino_item_id: targetItemId,
    valor_realocado_centavos: transferTotal,
    credito_gerado_centavos: Math.max(0, sourcePaid - transferTotal),
    saldo_destino_centavos: Math.max(0, targetOpen - transferTotal),
    estoque_antigo_reposto: sourceWasDeducted,
    reserva_antiga_liberada: !sourceWasDeducted && reservationActive,
    estoque_destino_baixado: !targetWasDeducted,
    status_financeiro: state?.status_financeiro || "PENDENTE",
    total_centavos: state?.total_centavos || 0,
    pago_centavos: state?.pago_centavos || 0,
    saldo_centavos: state?.saldo_centavos || 0,
    credito_centavos: state?.credito_centavos || 0
  });
}
