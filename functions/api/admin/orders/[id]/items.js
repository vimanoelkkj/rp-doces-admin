import { json, bodyJson, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import {
  ensureLegacyPaymentMaterialized,
  recalculateComanda
} from "../../../../lib/comandaLedger.js";
import { logEvent } from "../../../../lib/logger.js";

function promotionPrice(product, now = Date.now()) {
  const inicioOk = !product.promocao_inicio || Date.parse(product.promocao_inicio) <= now;
  const fimOk = !product.promocao_fim || Date.parse(product.promocao_fim) > now;
  const promo =
    Boolean(product.promocao_ativa) &&
    Number(product.preco_promocional_centavos) > 0 &&
    inicioOk &&
    fimOk;
  return promo ? Number(product.preco_promocional_centavos) : Number(product.preco_centavos);
}

function productAvailability(product) {
  return Number(product?.estoque || 0) - Number(product?.estoque_reservado || 0);
}

function stockMutationStatements(env, item, nextProduct, nextQuantity, reservationStatus) {
  const currentProductId = Number(item.produto_id || 0);
  const nextProductId = Number(nextProduct.id);
  const currentQuantity = Number(item.quantidade || 0);
  const sameProduct = currentProductId === nextProductId;
  const physicallyConsumed = Boolean(item.estoque_baixado_em);
  const reservationActive = String(reservationStatus || "").toUpperCase() === "ATIVA" && !physicallyConsumed;

  if (!physicallyConsumed && !reservationActive) return [];

  if (reservationActive) {
    if (sameProduct) {
      const delta = nextQuantity - currentQuantity;
      if (!delta) return [];
      return [
        env.DB.prepare(
          `UPDATE produtos
           SET estoque_reservado = estoque_reservado + ?,
               disponivel = CASE
                 WHEN ativo = 1 AND estoque - (estoque_reservado + ?) > 0 THEN 1
                 ELSE 0
               END,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(delta, delta, nextProductId)
      ];
    }

    return [
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado - ?,
             disponivel = CASE
               WHEN ativo = 1 AND estoque - (estoque_reservado - ?) > 0 THEN 1
               ELSE 0
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(currentQuantity, currentQuantity, currentProductId),
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado + ?,
             disponivel = CASE
               WHEN ativo = 1 AND estoque - (estoque_reservado + ?) > 0 THEN 1
               ELSE 0
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(nextQuantity, nextQuantity, nextProductId)
    ];
  }

  if (sameProduct) {
    const stockDelta = currentQuantity - nextQuantity;
    if (!stockDelta) return [];
    return [
      env.DB.prepare(
        `UPDATE produtos
         SET estoque = estoque + ?,
             disponivel = CASE
               WHEN ativo = 1 AND (estoque + ?) - estoque_reservado > 0 THEN 1
               ELSE 0
             END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(stockDelta, stockDelta, nextProductId)
    ];
  }

  return [
    env.DB.prepare(
      `UPDATE produtos
       SET estoque = estoque + ?,
           disponivel = CASE
             WHEN ativo = 1 AND (estoque + ?) - estoque_reservado > 0 THEN 1
             ELSE 0
           END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(currentQuantity, currentQuantity, currentProductId),
    env.DB.prepare(
      `UPDATE produtos
       SET estoque = estoque - ?,
           disponivel = CASE
             WHEN ativo = 1 AND (estoque - ?) - estoque_reservado > 0 THEN 1
             ELSE 0
           END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(nextQuantity, nextQuantity, nextProductId)
  ];
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const body = await bodyJson(request);
  const produtoId = Number(body?.produto_id);
  const quantidade = Number(body?.quantidade);

  if (
    !Number.isInteger(pedidoId) || pedidoId < 1 ||
    !Number.isInteger(produtoId) || produtoId < 1 ||
    !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50
  ) {
    return json({ erro: "Dados do item inválidos." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, quantidade, status_pedido, status_comanda
     FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (String(pedido.status_comanda || "ABERTA").toUpperCase() !== "ABERTA") {
    return json({ erro: "Esta comanda já foi encerrada." }, 409);
  }
  if (String(pedido.status_pedido || "").toUpperCase() === "CANCELADO") {
    return json({ erro: "Pedido cancelado não pode receber novos itens." }, 409);
  }
  if (Number(pedido.quantidade || 0) + quantidade > 50) {
    return json({ erro: "A comanda não pode ultrapassar 50 unidades." }, 400);
  }

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  const product = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, disponivel, ativo, estoque, estoque_reservado,
            promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
     FROM produtos WHERE id = ? LIMIT 1`
  )
    .bind(produtoId)
    .first();
  if (!product || !product.ativo) return json({ erro: "Produto não encontrado ou arquivado." }, 404);
  if (!product.disponivel) return json({ erro: `${product.nome} está indisponível.` }, 409);

  const available = productAvailability(product);
  if (available < quantidade) {
    return json({ erro: `${product.nome}: estoque disponível insuficiente.` }, 409);
  }

  const unit = promotionPrice(product);
  const subtotal = unit * quantidade;
  if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(subtotal)) {
    return json({ erro: "Valor do item inválido." }, 400);
  }

  try {
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO pedido_itens (
           pedido_id, produto_id, produto_nome, quantidade,
           valor_unitario_centavos, valor_total_centavos,
           adicionado_por_usuario_id, adicionado_em
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(
        pedidoId,
        produtoId,
        product.nome,
        quantidade,
        unit,
        subtotal,
        auth.user.id
      ),
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado + ?,
             disponivel = CASE WHEN estoque - (estoque_reservado + ?) <= 0 THEN 0 ELSE disponivel END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND estoque - estoque_reservado >= ?`
      ).bind(quantidade, quantidade, produtoId, quantidade),
      env.DB.prepare(
        `UPDATE pedidos
         SET quantidade = quantidade + ?,
             valor_total_centavos = valor_total_centavos + ?,
             status_pagamento = CASE WHEN status_pagamento = 'PAGO' THEN 'PARCIAL' ELSE status_pagamento END,
             estoque_baixado_em = NULL,
             reserva_status = 'ATIVA',
             reserva_expira_em = NULL,
             reserva_liberada_em = NULL,
             status_comanda = 'ABERTA',
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status_comanda = 'ABERTA'`
      ).bind(quantidade, subtotal, pedidoId)
    ]);

    const productChanges = Number(result?.[1]?.meta?.changes || 0);
    const orderChanges = Number(result?.[2]?.meta?.changes || 0);
    if (productChanges !== 1 || orderChanges !== 1) {
      return json({ erro: "O estoque ou a comanda mudou. Atualize e tente novamente." }, 409);
    }
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "O estoque mudou durante a inclusão do item." }, 409);
    }
    throw error;
  }

  const state = await recalculateComanda(env, pedidoId);
  logEvent("info", "comanda.item_added", {
    pedido_id: pedidoId,
    produto_id: produtoId,
    quantidade,
    total_centavos: subtotal
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    item: {
      produto_id: produtoId,
      produto_nome: product.nome,
      quantidade,
      valor_unitario_centavos: unit,
      valor_total_centavos: subtotal
    },
    status_financeiro: state?.status_financeiro || "PENDENTE",
    saldo_centavos: state?.saldo_centavos || 0
  }, 201);
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const body = await bodyJson(request);
  const itemId = Number(body?.item_id);
  const produtoId = Number(body?.produto_id);
  const quantidade = Number(body?.quantidade);

  if (
    !Number.isInteger(pedidoId) || pedidoId < 1 ||
    !Number.isInteger(itemId) || itemId < 1 ||
    !Number.isInteger(produtoId) || produtoId < 1 ||
    !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50
  ) {
    return json({ erro: "Dados do item inválidos." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_comanda, reserva_status
     FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (String(pedido.status_comanda || "ABERTA").toUpperCase() !== "ABERTA") {
    return json({ erro: "Esta comanda já foi encerrada e não pode ser editada." }, 409);
  }
  if (String(pedido.status_pedido || "").toUpperCase() === "CANCELADO") {
    return json({ erro: "Pedido cancelado não pode ser editado." }, 409);
  }

  const item = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos, estoque_baixado_em
     FROM pedido_itens
     WHERE id = ? AND pedido_id = ?
     LIMIT 1`
  )
    .bind(itemId, pedidoId)
    .first();
  if (!item) return json({ erro: "Item do pedido não encontrado." }, 404);

  const quantityRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN id = ? THEN 0 ELSE quantidade END), 0) AS outras_unidades
     FROM pedido_itens
     WHERE pedido_id = ?`
  )
    .bind(itemId, pedidoId)
    .first();
  if (Number(quantityRow?.outras_unidades || 0) + quantidade > 50) {
    return json({ erro: "A comanda não pode ultrapassar 50 unidades." }, 400);
  }

  const product = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, disponivel, ativo, estoque, estoque_reservado,
            promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
     FROM produtos WHERE id = ? LIMIT 1`
  )
    .bind(produtoId)
    .first();
  if (!product || !product.ativo) return json({ erro: "Produto não encontrado ou arquivado." }, 404);

  const sameProduct = Number(item.produto_id || 0) === produtoId;
  const physicallyConsumed = Boolean(item.estoque_baixado_em);
  const reservationActive = String(pedido.reserva_status || "").toUpperCase() === "ATIVA" && !physicallyConsumed;
  const currentQuantity = Number(item.quantidade || 0);
  const availabilityCredit = sameProduct && (physicallyConsumed || reservationActive) ? currentQuantity : 0;
  const available = productAvailability(product) + availabilityCredit;

  if (available < quantidade) {
    return json({ erro: `${product.nome}: estoque disponível insuficiente para a troca.` }, 409);
  }

  const unit = sameProduct
    ? Number(item.valor_unitario_centavos || 0)
    : promotionPrice(product);
  const subtotal = unit * quantidade;
  if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(subtotal)) {
    return json({ erro: "Valor do item inválido." }, 400);
  }

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  const paidRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(a.valor_centavos), 0) AS pago_centavos
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND pp.status = 'PAGO'`
  )
    .bind(itemId)
    .first();
  if (Number(paidRow?.pago_centavos || 0) > 0) {
    return json({
      erro: "Este item possui pagamento confirmado. Use a troca de item pago para ajustar saldo ou devolução."
    }, 409);
  }

  const statements = stockMutationStatements(env, item, product, quantidade, pedido.reserva_status);
  statements.push(
    env.DB.prepare(
      `UPDATE pedido_itens
       SET produto_id = ?, produto_nome = ?, quantidade = ?,
           valor_unitario_centavos = ?, valor_total_centavos = ?
       WHERE id = ? AND pedido_id = ?`
    ).bind(produtoId, product.nome, quantidade, unit, subtotal, itemId, pedidoId)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "O estoque mudou durante a edição. Atualize e tente novamente." }, 409);
    }
    throw error;
  }

  const state = await recalculateComanda(env, pedidoId);
  logEvent("info", "comanda.item_updated", {
    pedido_id: pedidoId,
    item_id: itemId,
    produto_anterior_id: item.produto_id || null,
    produto_id: produtoId,
    quantidade_anterior: currentQuantity,
    quantidade,
    total_anterior_centavos: Number(item.valor_total_centavos || 0),
    total_centavos: subtotal,
    usuario_id: auth.user.id
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    item: {
      id: itemId,
      produto_id: produtoId,
      produto_nome: product.nome,
      quantidade,
      valor_unitario_centavos: unit,
      valor_total_centavos: subtotal
    },
    status_financeiro: state?.status_financeiro || "PENDENTE",
    saldo_centavos: state?.saldo_centavos || 0,
    credito_centavos: state?.credito_centavos || 0
  });
}
