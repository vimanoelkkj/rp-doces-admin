import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../lib/stock.js";
import { notifyPaidOrder } from "../../lib/push.js";
import { checkCheckoutRateLimit } from "../../lib/checkoutRateLimit.js";

const MAX_ITENS_DISTINTOS = 20;
const MAX_UNIDADES = 50;

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}
function validWhatsapp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
function normalizeWhatsapp(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}
function money(centavos) { return (centavos / 100).toFixed(2); }

function normalizeItems(data) {
  // Contrato antigo aceito temporariamente para permitir deploy gradual.
  const source = Array.isArray(data?.itens)
    ? data.itens
    : [{ produto_id: data?.produto_id, quantidade: data?.quantidade }];
  if (!source.length || source.length > MAX_ITENS_DISTINTOS) return null;
  const consolidated = new Map();
  for (const raw of source) {
    const produtoId = Number(raw?.produto_id);
    const quantidade = Math.trunc(Number(raw?.quantidade));
    if (!Number.isInteger(produtoId) || produtoId <= 0) return null;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_UNIDADES) return null;
    consolidated.set(produtoId, (consolidated.get(produtoId) || 0) + quantidade);
  }
  const itens = [...consolidated].map(([produto_id, quantidade]) => ({ produto_id, quantidade }));
  const unidades = itens.reduce((sum, item) => sum + item.quantidade, 0);
  if (!itens.length || itens.length > MAX_ITENS_DISTINTOS || unidades > MAX_UNIDADES) return null;
  return itens;
}

function promotionPrice(produto, agora) {
  const vigente = Boolean(produto.promocao_ativa) && Number(produto.preco_promocional_centavos) > 0 &&
    (!produto.promocao_inicio || Date.parse(produto.promocao_inicio) <= agora) &&
    (!produto.promocao_fim || Date.parse(produto.promocao_fim) > agora);
  return vigente ? Number(produto.preco_promocional_centavos) : Number(produto.preco_centavos);
}

function isValidClientId(value) {
  if (!value || typeof value !== "string") return false;
  const s = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^[A-Za-z0-9_-]{16,64}$/.test(s);
}

async function assertPayloadCompatibility(env, pedido, { email, whatsapp, observacao, total, itensNovos }) {
  if (
    pedido.cliente_email !== email ||
    String(pedido.cliente_whatsapp || "") !== whatsapp ||
    String(pedido.observacao || "").trim() !== observacao ||
    Number(pedido.valor_total_centavos) !== Number(total)
  ) {
    const err = new Error("Identificador de requisição já utilizado para um pedido diferente.");
    err.status = 409;
    throw err;
  }
  const { results } = await env.DB.prepare(`
    SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ? ORDER BY produto_id
  `).bind(pedido.id).all();

  const salvos = (results || []).map(i => ({ produto_id: Number(i.produto_id), quantidade: Number(i.quantidade) }))
    .sort((a, b) => a.produto_id - b.produto_id);
  const novos = itensNovos.map(i => ({ produto_id: Number(i.produto_id), quantidade: Number(i.quantidade) }))
    .sort((a, b) => a.produto_id - b.produto_id);

  if (salvos.length !== novos.length) {
    const err = new Error("Identificador de requisição já utilizado para um pedido diferente.");
    err.status = 409;
    throw err;
  }
  for (let i = 0; i < salvos.length; i++) {
    if (salvos[i].produto_id !== novos[i].produto_id || salvos[i].quantidade !== novos[i].quantidade) {
      const err = new Error("Identificador de requisição já utilizado para um pedido diferente.");
      err.status = 409;
      throw err;
    }
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  if (!env.MP_ACCESS_TOKEN) return json({ erro: "Pagamento Pix ainda não configurado." }, 503);
  const data = await bodyJson(request, 16384);
  if (!data) return json({ erro: "Dados inválidos." }, 400);

  const rawClientId = data?.client_request_id ?? data?.idempotency_key ?? null;
  if (rawClientId !== null && !isValidClientId(rawClientId)) {
    return json({ erro: "client_request_id inválido." }, 400);
  }
  const idempotencyKey = rawClientId ? String(rawClientId).trim() : crypto.randomUUID();

  const solicitados = normalizeItems(data);
  const nome = String(data.nome || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  const observacao = String(data.observacao || "").trim().slice(0, 500);
  const whatsapp = normalizeWhatsapp(data.whatsapp);
  if (!solicitados) return json({ erro: "Carrinho inválido. Revise os produtos e quantidades." }, 400);
  if (nome.length < 2 || nome.length > 100) return json({ erro: "Informe seu nome." }, 400);
  if (!validEmail(email)) return json({ erro: "Informe um e-mail válido." }, 400);
  if (!validWhatsapp(whatsapp)) return json({ erro: "Informe um WhatsApp válido com DDD." }, 400);

  const placeholders = solicitados.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`
    SELECT id, nome, preco_centavos, disponivel, ativo, estoque,
           promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
    FROM produtos WHERE id IN (${placeholders})
  `).bind(...solicitados.map(item => item.produto_id)).all();
  const produtos = new Map((results || []).map(produto => [Number(produto.id), produto]));
  const agora = Date.now();
  const itens = [];
  for (const solicitado of solicitados) {
    const produto = produtos.get(solicitado.produto_id);
    if (!produto || !produto.ativo) return json({ erro: "Um produto do carrinho não foi encontrado." }, 404);
    if (!produto.disponivel) return json({ erro: `${produto.nome} está indisponível no momento.` }, 409);
    if (Number(produto.estoque) < solicitado.quantidade) {
      const detalhe = produto.estoque > 0 ? `Restam apenas ${produto.estoque} unidade(s).` : "O produto está esgotado.";
      return json({ erro: `${produto.nome}: ${detalhe}` }, 409);
    }
    const unitario = promotionPrice(produto, agora);
    const subtotal = unitario * solicitado.quantidade;
    if (!Number.isSafeInteger(unitario) || unitario <= 0 || !Number.isSafeInteger(subtotal)) {
      return json({ erro: "Valor do pedido inválido." }, 400);
    }
    itens.push({ produto_id: Number(produto.id), produto: produto.nome, quantidade: solicitado.quantidade,
      valor_unitario_centavos: unitario, valor_total_centavos: subtotal });
  }

  const total = itens.reduce((sum, item) => sum + item.valor_total_centavos, 0);
  const quantidadeTotal = itens.reduce((sum, item) => sum + item.quantidade, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return json({ erro: "Valor do pedido inválido." }, 400);

  // 1. Verifica se já existe um pedido para esta idempotencyKey
  let pedidoExistente = await env.DB.prepare(`
    SELECT id, token_publico, produto_nome, quantidade, valor_total_centavos, cliente_email,
           cliente_whatsapp, observacao, status_pagamento, mp_order_id, mp_payment_id, mp_status,
           mp_status_detail, mp_ticket_url, mp_qr_code, mp_qr_code_base64, idempotency_key
    FROM pedidos WHERE idempotency_key = ? LIMIT 1
  `).bind(idempotencyKey).first();

  if (pedidoExistente) {
    try {
      await assertPayloadCompatibility(env, pedidoExistente, { email, whatsapp, observacao, total, itensNovos: itens });
    } catch (err) {
      if (err.status === 409) return json({ erro: err.message }, 409);
      throw err;
    }

    // Estado A: Pedido existente com Pix completo -> Replay imediato
    if (pedidoExistente.mp_qr_code) {
      const { results: itensSalvos } = await env.DB.prepare(`
        SELECT produto_id, produto_nome AS produto, quantidade,
               valor_unitario_centavos, valor_total_centavos
        FROM pedido_itens WHERE pedido_id = ? ORDER BY id
      `).bind(pedidoExistente.id).all();

      return json({
        pedido: {
          token: pedidoExistente.token_publico,
          referencia: `RP-${pedidoExistente.id}`,
          produto: pedidoExistente.produto_nome,
          quantidade: pedidoExistente.quantidade,
          quantidade_total: pedidoExistente.quantidade,
          itens: itensSalvos || [],
          valor_total_centavos: pedidoExistente.valor_total_centavos,
          status: pedidoExistente.status_pagamento
        },
        pix: {
          qr_code: pedidoExistente.mp_qr_code,
          qr_code_base64: pedidoExistente.mp_qr_code_base64,
          ticket_url: pedidoExistente.mp_ticket_url
        }
      }, 200);
    }
  }

  // 2. Rate limit de negócio aplicado apenas para novas criações / retries incompletos
  const rateLimit = await checkCheckoutRateLimit(env, request);
  if (rateLimit.misconfigured) {
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
  if (!rateLimit.allowed) {
    console.warn("Checkout rate limit excedido:", { retryAfter: rateLimit.retryAfter, count: rateLimit.count });
    return json(
      {
        erro: "Muitas tentativas de pedido em pouco tempo. Por favor, aguarde alguns instantes antes de tentar novamente.",
        retry_after: rateLimit.retryAfter,
      },
      429,
      { "Retry-After": String(rateLimit.retryAfter) }
    );
  }

  let pedidoId = pedidoExistente?.id;
  let tokenPublico = pedidoExistente?.token_publico;

  if (!pedidoExistente) {
    tokenPublico = crypto.randomUUID();
    const produtoResumo = itens.length === 1 ? itens[0].produto : `Pedido com ${itens.length} itens`;
    const statements = [env.DB.prepare(`
      INSERT INTO pedidos (token_publico, produto_id, produto_nome, quantidade,
        valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
        cliente_whatsapp, tipo_entrega, observacao, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tokenPublico, itens.length === 1 ? itens[0].produto_id : null, produtoResumo, quantidadeTotal,
      itens.length === 1 ? itens[0].valor_unitario_centavos : 0, total,
      nome, email, whatsapp, "RETIRADA", observacao, idempotencyKey)];
    for (const item of itens) {
      statements.push(env.DB.prepare(`
        INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade,
          valor_unitario_centavos, valor_total_centavos)
        SELECT id, ?, ?, ?, ?, ? FROM pedidos WHERE token_publico = ?
      `).bind(item.produto_id, item.produto, item.quantidade,
        item.valor_unitario_centavos, item.valor_total_centavos, tokenPublico));
    }

    try {
      const inserted = await env.DB.batch(statements);
      pedidoId = inserted[0]?.meta?.last_row_id;
    } catch (insertErr) {
      // Concorrência atômica: se outro request inseriu no mesmo milissegundo com a mesma chave
      pedidoExistente = await env.DB.prepare(`
        SELECT id, token_publico, produto_nome, quantidade, valor_total_centavos, cliente_email,
               cliente_whatsapp, observacao, status_pagamento, mp_order_id, mp_payment_id, mp_status,
               mp_status_detail, mp_ticket_url, mp_qr_code, mp_qr_code_base64, idempotency_key
        FROM pedidos WHERE idempotency_key = ? LIMIT 1
      `).bind(idempotencyKey).first();

      if (!pedidoExistente) throw insertErr;

      try {
        await assertPayloadCompatibility(env, pedidoExistente, { email, whatsapp, observacao, total, itensNovos: itens });
      } catch (err) {
        if (err.status === 409) return json({ erro: err.message }, 409);
        throw err;
      }

      if (pedidoExistente.mp_qr_code) {
        const { results: itensSalvos } = await env.DB.prepare(`
          SELECT produto_id, produto_nome AS produto, quantidade,
                 valor_unitario_centavos, valor_total_centavos
          FROM pedido_itens WHERE pedido_id = ? ORDER BY id
        `).bind(pedidoExistente.id).all();

        return json({
          pedido: {
            token: pedidoExistente.token_publico,
            referencia: `RP-${pedidoExistente.id}`,
            produto: pedidoExistente.produto_nome,
            quantidade: pedidoExistente.quantidade,
            quantidade_total: pedidoExistente.quantidade,
            itens: itensSalvos || [],
            valor_total_centavos: pedidoExistente.valor_total_centavos,
            status: pedidoExistente.status_pagamento
          },
          pix: {
            qr_code: pedidoExistente.mp_qr_code,
            qr_code_base64: pedidoExistente.mp_qr_code_base64,
            ticket_url: pedidoExistente.mp_ticket_url
          }
        }, 200);
      }

      pedidoId = pedidoExistente.id;
      tokenPublico = pedidoExistente.token_publico;
    }
  }

  if (!pedidoId) return json({ erro: "Não foi possível registrar o pedido." }, 500);
  const externalReference = `RP-${pedidoId}`;

  // 2. Chamada idempotente ao Mercado Pago usando a mesma chave
  try {
    const order = await mpRequest(env, "/v1/orders", {
      method: "POST", idempotencyKey,
      body: { type: "online", processing_mode: "automatic", external_reference: externalReference,
        total_amount: money(total), payer: { email,
          first_name: String(env.MP_TEST_MODE || "").toLowerCase() === "true" ? "APRO" : nome.split(/\s+/)[0] },
        transactions: { payments: [{ amount: money(total), payment_method: { id: "pix", type: "bank_transfer" } }] } }
    });
    const payment = paymentFromOrder(order);
    const localStatus = mpOrderToLocalStatus(order);
    await env.DB.prepare(`UPDATE pedidos SET mp_order_id = ?, mp_payment_id = ?, mp_status = ?, mp_status_detail = ?,
      mp_ticket_url = ?, mp_qr_code = ?, mp_qr_code_base64 = ?, status_pagamento = ?, atualizado_em = CURRENT_TIMESTAMP,
      pago_em = CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE pago_em END WHERE id = ?`).bind(
      order.id || null, payment.paymentId, order.status || null, order.status_detail || null,
      payment.ticketUrl, payment.qrCode, payment.qrCodeBase64, localStatus, localStatus, pedidoId).run();
    if (localStatus === "PAGO") {
      const estoque = await baixarEstoquePedido(env, pedidoId);
      if (!estoque.ok) console.error("Falha na baixa de estoque:", estoque.erro, "pedido", pedidoId);
      await notifyPaidOrder(env, pedidoId);
    }
    const produtoResumo = itens.length === 1 ? itens[0].produto : `Pedido com ${itens.length} itens`;
    return json({ pedido: { token: tokenPublico, referencia: externalReference, produto: produtoResumo,
      quantidade: quantidadeTotal, quantidade_total: quantidadeTotal, itens,
      valor_total_centavos: total, status: localStatus },
      pix: { qr_code: payment.qrCode, qr_code_base64: payment.qrCodeBase64, ticket_url: payment.ticketUrl } }, 201);
  } catch (err) {
    await env.DB.prepare(`
      UPDATE pedidos SET
        status_pagamento = 'ERRO',
        atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status_pagamento NOT IN ('PAGO', 'REEMBOLSADO')
    `).bind(pedidoId).run();
    console.error("Mercado Pago create order:", err?.status, err?.data || err?.message);
    return json({ erro: "Não foi possível gerar o Pix agora. Tente novamente em instantes." }, 502);
  }
}
