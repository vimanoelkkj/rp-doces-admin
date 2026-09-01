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

  const available = Number(product.estoque || 0) - Number(product.estoque_reservado || 0);
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
