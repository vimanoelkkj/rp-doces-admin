import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../lib/mercadoPago.js";

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

function money(centavos) {
  return (centavos / 100).toFixed(2);
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  if (!env.MP_ACCESS_TOKEN) return json({ erro: "Pagamento Pix ainda não configurado." }, 503);

  const data = await bodyJson(request, 8192);
  if (!data) return json({ erro: "Dados inválidos." }, 400);

  const produtoId = Number(data.produto_id);
  const quantidade = Math.trunc(Number(data.quantidade));
  const nome = String(data.nome || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  const observacao = String(data.observacao || "").trim().slice(0, 500);
  const whatsapp = normalizeWhatsapp(data.whatsapp);

  if (!Number.isInteger(produtoId) || produtoId <= 0) return json({ erro: "Produto inválido." }, 400);
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) return json({ erro: "Quantidade inválida." }, 400);
  if (nome.length < 2 || nome.length > 100) return json({ erro: "Informe seu nome." }, 400);
  if (!validEmail(email)) return json({ erro: "Informe um e-mail válido." }, 400);
  if (!validWhatsapp(whatsapp)) return json({ erro: "Informe um WhatsApp válido com DDD." }, 400);

  const produto = await env.DB.prepare(`
    SELECT id, nome, preco_centavos, disponivel, ativo, estoque
    FROM produtos WHERE id = ? LIMIT 1
  `).bind(produtoId).first();

  if (!produto || !produto.ativo) return json({ erro: "Produto não encontrado." }, 404);
  if (!produto.disponivel) return json({ erro: "Este produto está indisponível no momento." }, 409);
  if (Number(produto.estoque) < quantidade) {
    return json({ erro: produto.estoque > 0 ? `Restam apenas ${produto.estoque} unidade(s) deste produto.` : "Este produto está esgotado." }, 409);
  }

  const unitario = Number(produto.preco_centavos);
  const total = unitario * quantidade;
  if (!Number.isSafeInteger(total) || total <= 0) return json({ erro: "Valor do pedido inválido." }, 400);

  const tokenPublico = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();

  const insert = await env.DB.prepare(`
    INSERT INTO pedidos (
      token_publico, produto_id, produto_nome, quantidade,
      valor_unitario_centavos, valor_total_centavos,
      cliente_nome, cliente_email, cliente_whatsapp, tipo_entrega, observacao, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenPublico, produto.id, produto.nome, quantidade,
    unitario, total, nome, email, whatsapp, "RETIRADA", observacao, idempotencyKey
  ).run();

  const pedidoId = insert.meta?.last_row_id;
  const externalReference = `RP-${pedidoId}`;

  try {
    const order = await mpRequest(env, "/v1/orders", {
      method: "POST",
      idempotencyKey,
      body: {
        type: "online",
        processing_mode: "automatic",
        external_reference: externalReference,
        total_amount: money(total),
        payer: {
          email,
          first_name: String(env.MP_TEST_MODE || "").toLowerCase() === "true"
            ? "APRO"
            : nome.split(/\s+/)[0]
        },
        transactions: {
          payments: [{
            amount: money(total),
            payment_method: { id: "pix", type: "bank_transfer" }
          }]
        }
      }
    });

    const payment = paymentFromOrder(order);
    const localStatus = mpOrderToLocalStatus(order);
    await env.DB.prepare(`
      UPDATE pedidos SET
        mp_order_id = ?, mp_payment_id = ?, mp_status = ?, mp_status_detail = ?,
        mp_ticket_url = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
        status_pagamento = ?, atualizado_em = CURRENT_TIMESTAMP,
        pago_em = CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE pago_em END
      WHERE id = ?
    `).bind(
      order.id || null, payment.paymentId, order.status || null, order.status_detail || null,
      payment.ticketUrl, payment.qrCode, payment.qrCodeBase64,
      localStatus, localStatus, pedidoId
    ).run();

    return json({
      pedido: {
        token: tokenPublico,
        referencia: externalReference,
        produto: produto.nome,
        quantidade,
        valor_total_centavos: total,
        status: localStatus,
      },
      pix: {
        qr_code: payment.qrCode,
        qr_code_base64: payment.qrCodeBase64,
        ticket_url: payment.ticketUrl,
      }
    }, 201);
  } catch (err) {
    await env.DB.prepare(`
      UPDATE pedidos SET status_pagamento = 'ERRO', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(pedidoId).run();
    console.error("Mercado Pago create order:", err?.status, err?.data || err?.message);
    return json({ erro: "Não foi possível gerar o Pix agora. Tente novamente em instantes." }, 502);
  }
}
