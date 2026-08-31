import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest } from "../../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../../lib/stock.js";
import { syncOrderPayment } from "../../../lib/paymentSync.js";
import { logEvent } from "../../../lib/logger.js";

const RECONCILE_AFTER_SECONDS = 15;
const RECONCILE_BATCH_SIZE = 4;
const MANUAL_PAYMENT_METHODS = new Set(["PIX_EXTERNO", "CARTAO", "DINHEIRO", "A_COMBINAR"]);
const MANUAL_PAYMENT_STATUSES = new Set(["PENDENTE", "PAGO"]);

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

function normalizeManualItems(rawItems) {
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
  if (items.some(item => item.quantidade > 50)) return null;
  return items;
}

async function reconcilePaidOrdersWithoutStock(env) {
  const { results } = await env.DB.prepare(
    `
    SELECT id
    FROM pedidos
    WHERE status_pagamento = 'PAGO'
      AND estoque_baixado_em IS NULL
      AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    ORDER BY atualizado_em ASC, id ASC
    LIMIT ?
  `
  )
    .bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE)
    .all();

  await Promise.allSettled(
    (results || []).map(async ({ id }) => {
      try {
        const estoque = await baixarEstoquePedido(env, id);
        if (estoque.ok && estoque.baixado) {
          logEvent("info", "reconciliation.recovered", { pedido_id: id, status: "PAGO" });
        } else if (!estoque.ok) {
          logEvent("error", "stock.conversion_failed", {
            pedido_id: id,
            reason: "STOCK_CONVERSION_FAILED"
          });
          await env.DB.prepare(
            `
          UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ? AND estoque_baixado_em IS NULL
        `
          )
            .bind(id)
            .run();
        }
      } catch (err) {
        logEvent("error", "stock.conversion_failed", {
          pedido_id: id,
          reason: "STOCK_CONVERSION_FAILED"
        });
        await env.DB.prepare(
          `
        UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND estoque_baixado_em IS NULL
      `
        )
          .bind(id)
          .run();
      }
    })
  );
}

async function reconcilePendingOrders(env) {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(
    `
    SELECT id, mp_order_id
    FROM pedidos
    WHERE status_pagamento = 'PENDENTE'
      AND mp_order_id IS NOT NULL
      AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    ORDER BY atualizado_em ASC, id ASC
    LIMIT ?
  `
  )
    .bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE)
    .all();

  const pending = results || [];
  if (!pending.length) return;

  await Promise.allSettled(
    pending.map(async pedido => {
      try {
        const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
        await syncOrderPayment(env, { pedidoId: pedido.id, order, mpOrderId: pedido.mp_order_id });
      } catch (err) {
        logEvent("warn", "payment.sync_failed", {
          pedido_id: pedido.id,
          mp_order_id: pedido.mp_order_id,
          http_status: err?.status || undefined,
          reason: err?.status ? "MP_HTTP_ERROR" : "MP_RECONCILIATION_FAILED"
        });
        await env.DB.prepare("UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(pedido.id)
          .run();
      }
    })
  );
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  await reconcilePendingOrders(env);
  await reconcilePaidOrdersWithoutStock(env);

  const { results } = await env.DB.prepare(
    `
    SELECT id, token_publico, produto_id, produto_nome, quantidade,
      valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
      cliente_whatsapp, tipo_entrega, observacao, metodo_pagamento, status_pagamento, status_pedido,
      origem_pedido, mp_order_id, mp_payment_id, mp_status, mp_status_detail,
      criado_em, atualizado_em, pago_em, estoque_baixado_em, reserva_status
    FROM pedidos ORDER BY id DESC LIMIT 250
  `
  ).all();
  const pedidos = results || [];
  if (!pedidos.length) return json({ pedidos: [] });

  const { results: itemRows } = await env.DB.prepare(
    `
    SELECT pedido_id, produto_id, produto_nome, quantidade,
           valor_unitario_centavos, valor_total_centavos, estoque_baixado_em
    FROM pedido_itens
    WHERE pedido_id IN (SELECT id FROM pedidos ORDER BY id DESC LIMIT 250)
    ORDER BY pedido_id DESC, id
  `
  ).all();
  const porPedido = new Map();
  for (const item of itemRows || []) {
    if (!porPedido.has(Number(item.pedido_id))) porPedido.set(Number(item.pedido_id), []);
    porPedido.get(Number(item.pedido_id)).push(item);
  }
  for (const pedido of pedidos) pedido.itens = porPedido.get(Number(pedido.id)) || [];
  return json({ pedidos });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const body = await bodyJson(request);
  const requested = normalizeManualItems(body?.itens);
  const method = String(body?.metodo_pagamento || "").toUpperCase();
  const paymentStatus = String(body?.status_pagamento || "PENDENTE").toUpperCase();
  const clienteNome = String(body?.cliente_nome || "").trim().slice(0, 120);
  const clienteWhatsapp = String(body?.cliente_whatsapp || "").trim().slice(0, 40);
  const observacao = String(body?.observacao || "").trim().slice(0, 500);

  if (!requested || !MANUAL_PAYMENT_METHODS.has(method) || !MANUAL_PAYMENT_STATUSES.has(paymentStatus)) {
    return json({ erro: "Dados do pedido manual inválidos." }, 400);
  }

  const placeholders = requested.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `
    SELECT id, nome, preco_centavos, disponivel, ativo, estoque, estoque_reservado,
           promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
    FROM produtos WHERE id IN (${placeholders})
  `
  )
    .bind(...requested.map(item => item.produto_id))
    .all();

  const productMap = new Map((results || []).map(product => [Number(product.id), product]));
  const now = Date.now();
  const items = [];

  for (const requestedItem of requested) {
    const product = productMap.get(requestedItem.produto_id);
    if (!product || !product.ativo) return json({ erro: "Um produto não foi encontrado." }, 404);
    if (!product.disponivel) return json({ erro: `${product.nome} está indisponível.` }, 409);

    const available = Number(product.estoque) - Number(product.estoque_reservado || 0);
    if (available < requestedItem.quantidade) {
      return json({ erro: `${product.nome}: estoque disponível insuficiente.` }, 409);
    }

    const unit = promotionPrice(product, now);
    const subtotal = unit * requestedItem.quantidade;
    if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(subtotal)) {
      return json({ erro: "Valor do pedido inválido." }, 400);
    }

    items.push({
      produto_id: Number(product.id),
      produto: product.nome,
      quantidade: requestedItem.quantidade,
      valor_unitario_centavos: unit,
      valor_total_centavos: subtotal
    });
  }

  const total = items.reduce((sum, item) => sum + item.valor_total_centavos, 0);
  const quantidadeTotal = items.reduce((sum, item) => sum + item.quantidade, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return json({ erro: "Valor do pedido inválido." }, 400);

  const tokenPublico = crypto.randomUUID();
  const idempotencyKey = `manual:${crypto.randomUUID()}`;
  const productSummary = items.length === 1 ? items[0].produto : `Pedido com ${items.length} itens`;
  const statements = [
    env.DB.prepare(
      `
      INSERT INTO pedidos (token_publico, produto_id, produto_nome, quantidade,
        valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
        cliente_whatsapp, tipo_entrega, observacao, metodo_pagamento, status_pagamento,
        status_pedido, idempotency_key, reserva_status, reserva_expira_em, origem_pedido, pago_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'RETIRADA', ?, ?, ?, 'NOVO', ?, 'ATIVA', NULL, 'MANUAL',
        CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END)
    `
    ).bind(
      tokenPublico,
      items.length === 1 ? items[0].produto_id : null,
      productSummary,
      quantidadeTotal,
      items.length === 1 ? items[0].valor_unitario_centavos : 0,
      total,
      clienteNome,
      clienteWhatsapp,
      observacao,
      method,
      paymentStatus,
      idempotencyKey,
      paymentStatus
    )
  ];

  for (const item of items) {
    statements.push(
      env.DB.prepare(
        `
        INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade,
          valor_unitario_centavos, valor_total_centavos)
        SELECT id, ?, ?, ?, ?, ? FROM pedidos WHERE token_publico = ?
      `
      ).bind(
        item.produto_id,
        item.produto,
        item.quantidade,
        item.valor_unitario_centavos,
        item.valor_total_centavos,
        tokenPublico
      ),
      env.DB.prepare(
        `
        UPDATE produtos
        SET estoque_reservado = estoque_reservado + ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).bind(item.quantidade, item.produto_id)
    );
  }

  let pedidoId;
  try {
    const inserted = await env.DB.batch(statements);
    pedidoId = Number(inserted[0]?.meta?.last_row_id || 0);
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "Um ou mais produtos não possuem estoque suficiente." }, 409);
    }
    throw error;
  }

  if (!pedidoId) return json({ erro: "Não foi possível registrar o pedido." }, 500);

  if (paymentStatus === "PAGO") {
    const stock = await baixarEstoquePedido(env, pedidoId);
    if (!stock.ok) {
      logEvent("error", "manual_order.stock_conversion_failed", { pedido_id: pedidoId });
      return json({ erro: "Pedido criado, mas a baixa de estoque precisa ser reconciliada.", id: pedidoId }, 500);
    }
  }

  logEvent("info", "manual_order.created", {
    pedido_id: pedidoId,
    payment_method: method,
    payment_status: paymentStatus
  });

  return json({ ok: true, id: pedidoId }, 201);
}
