import { json, bodyJson, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { mpRequest } from "../../../../lib/mercadoPago.js";
import { syncOrderPayment } from "../../../../lib/paymentSync.js";
import { liberarReservaPedido } from "../../../../lib/stock.js";
import { logEvent } from "../../../../lib/logger.js";

const ADMIN_PAYMENT_METHODS = new Set(["PIX_EXTERNO", "CARTAO", "DINHEIRO", "A_COMBINAR"]);

function promotionPrice(product, now = Date.now()) {
  const inicioOk = !product.promocao_inicio || Date.parse(product.promocao_inicio) <= now;
  const fimOk = !product.promocao_fim || Date.parse(product.promocao_fim) > now;
  const promo = Boolean(product.promocao_ativa) && Number(product.preco_promocional_centavos) > 0 && inicioOk && fimOk;
  return promo ? Number(product.preco_promocional_centavos) : Number(product.preco_centavos);
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 20) return null;
  const aggregated = new Map();
  for (const raw of rawItems) {
    const produtoId = Number(raw?.produto_id);
    const quantidade = Number(raw?.quantidade);
    if (!Number.isInteger(produtoId) || produtoId < 1) return null;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) return null;
    aggregated.set(produtoId, (aggregated.get(produtoId) || 0) + quantidade);
  }
  const items = [...aggregated.entries()].map(([produto_id, quantidade]) => ({ produto_id, quantidade }));
  return items.some(item => item.quantidade > 50) ? null : items;
}

async function cancelPendingMercadoPagoOrder(env, pedido) {
  const currentOrder = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
  const current = await syncOrderPayment(env, { pedidoId: pedido.id, order: currentOrder, mpOrderId: pedido.mp_order_id });
  if (current.status_pagamento === "PAGO") return { ok: false, status: 409, erro: "O pagamento foi confirmado e este pedido não pode mais ser editado." };
  if (current.status_pagamento === "CANCELADO") return { ok: true };
  if (current.status_pagamento !== "PENDENTE") return { ok: false, status: 409, erro: "Este pagamento já foi encerrado e o pedido não pode mais ser editado." };

  const canceledOrder = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}/cancel`, {
    method: "POST",
    idempotencyKey: crypto.randomUUID()
  });
  const canceled = await syncOrderPayment(env, { pedidoId: pedido.id, order: canceledOrder, mpOrderId: pedido.mp_order_id });
  if (canceled.status_pagamento !== "CANCELADO") return { ok: false, status: 409, erro: "O Mercado Pago não confirmou o cancelamento do Pix atual." };
  return { ok: true };
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ erro: "Pedido inválido." }, 400);

  const body = await bodyJson(request);
  const requested = normalizeItems(body?.itens);
  const method = String(body?.metodo_pagamento || "").toUpperCase();
  if (!requested || !ADMIN_PAYMENT_METHODS.has(method)) return json({ erro: "Dados da edição inválidos." }, 400);

  const pedido = await env.DB.prepare(
    `SELECT id, status_pagamento, status_pedido, reserva_status, mp_order_id FROM pedidos WHERE id = ? LIMIT 1`
  ).bind(id).first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (pedido.status_pagamento !== "PENDENTE") return json({ erro: "Somente pedidos com pagamento pendente podem ter itens e valor alterados." }, 409);

  try {
    if (pedido.mp_order_id) {
      const canceled = await cancelPendingMercadoPagoOrder(env, pedido);
      if (!canceled.ok) return json({ erro: canceled.erro }, canceled.status);
    } else if (pedido.reserva_status === "ATIVA") {
      const released = await liberarReservaPedido(env, id, { novoStatus: "PENDENTE" });
      if (!released.ok) return json({ erro: "Não foi possível liberar a reserva atual do pedido." }, 409);
    }
  } catch (error) {
    logEvent("warn", "admin_order.edit_payment_cancel_failed", { pedido_id: id, http_status: error?.status || undefined });
    return json({ erro: "Não foi possível cancelar o pagamento atual antes da edição." }, 502);
  }

  const placeholders = requested.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, disponivel, ativo, estoque, estoque_reservado,
            promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
     FROM produtos WHERE id IN (${placeholders})`
  ).bind(...requested.map(item => item.produto_id)).all();

  const productMap = new Map((results || []).map(product => [Number(product.id), product]));
  const now = Date.now();
  const items = [];
  for (const requestedItem of requested) {
    const product = productMap.get(requestedItem.produto_id);
    if (!product || !product.ativo) return json({ erro: "Um produto não foi encontrado ou está arquivado." }, 404);
    if (!product.disponivel) return json({ erro: `${product.nome} está indisponível.` }, 409);
    const available = Number(product.estoque) - Number(product.estoque_reservado || 0);
    if (available < requestedItem.quantidade) return json({ erro: `${product.nome}: estoque disponível insuficiente.` }, 409);
    const unit = promotionPrice(product, now);
    const subtotal = unit * requestedItem.quantidade;
    if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(subtotal)) return json({ erro: "Valor do pedido inválido." }, 400);
    items.push({ produto_id: Number(product.id), produto_nome: product.nome, quantidade: requestedItem.quantidade, valor_unitario_centavos: unit, valor_total_centavos: subtotal });
  }

  const total = items.reduce((sum, item) => sum + item.valor_total_centavos, 0);
  const quantidadeTotal = items.reduce((sum, item) => sum + item.quantidade, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return json({ erro: "Valor do pedido inválido." }, 400);

  const productSummary = items.length === 1 ? items[0].produto_nome : `Pedido com ${items.length} itens`;
  const statements = [env.DB.prepare("DELETE FROM pedido_itens WHERE pedido_id = ?").bind(id)];
  for (const item of items) {
    statements.push(
      env.DB.prepare(`INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, item.produto_id, item.produto_nome, item.quantidade, item.valor_unitario_centavos, item.valor_total_centavos),
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado + ?,
             disponivel = CASE WHEN estoque - (estoque_reservado + ?) <= 0 THEN 0 ELSE disponivel END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(item.quantidade, item.quantidade, item.produto_id)
    );
  }

  statements.push(
    env.DB.prepare(
      `UPDATE pedidos
       SET produto_id = ?, produto_nome = ?, quantidade = ?, valor_unitario_centavos = ?, valor_total_centavos = ?,
           metodo_pagamento = ?, status_pagamento = 'PENDENTE',
           status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
           pago_em = NULL, estoque_baixado_em = NULL,
           reserva_status = 'ATIVA', reserva_expira_em = NULL, reserva_liberada_em = NULL,
           mp_order_id = NULL, mp_payment_id = NULL, mp_status = NULL, mp_status_detail = NULL,
           mp_ticket_url = NULL, mp_qr_code = NULL, mp_qr_code_base64 = NULL,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(items.length === 1 ? items[0].produto_id : null, productSummary, quantidadeTotal, items.length === 1 ? items[0].valor_unitario_centavos : 0, total, method, id)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) return json({ erro: "O estoque mudou durante a edição. Atualize e tente novamente." }, 409);
    throw error;
  }

  logEvent("info", "admin_order.edited", { pedido_id: id, itens: items.length, quantidade: quantidadeTotal, total_centavos: total, payment_method: method });
  return json({ ok: true, id, valor_total_centavos: total, metodo_pagamento: method });
}
