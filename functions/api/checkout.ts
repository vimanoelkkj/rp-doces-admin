/// <reference types="@cloudflare/workers-types" />

import { precoAtualCentavos, ProdutoRow } from "../lib/pricing";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface CheckoutItemInput {
  id: number;
  quantity: number;
}

interface CheckoutBody {
  items: CheckoutItemInput[];
  cliente: {
    nome: string;
    whatsapp: string;
  };
  recado?: string;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const MAX_ITEMS_PER_PEDIDO = 50;
const MAX_TEXT_LENGTH = 200;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await handleCheckout(request, env);
  } catch (err) {
    console.error("Erro inesperado no checkout", err);
    return jsonError("Erro interno ao processar checkout", 500);
  }
};

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonError("Carrinho vazio", 400);
  }
  if (body.items.length > MAX_ITEMS_PER_PEDIDO) {
    return jsonError("Carrinho com itens demais", 400);
  }
  if (
    !body.items.every(
      (i) => i && typeof i === "object" && Number.isInteger(i.id) && i.id > 0,
    )
  ) {
    return jsonError("Item de carrinho inválido", 400);
  }
  const nome = body.cliente?.nome?.trim();
  const whatsapp = body.cliente?.whatsapp?.trim();
  if (!nome || !whatsapp) {
    return jsonError("Dados do cliente incompletos", 400);
  }
  if (nome.length > MAX_TEXT_LENGTH || whatsapp.length > MAX_TEXT_LENGTH) {
    return jsonError("Dados do cliente inválidos", 400);
  }

  const ids = [...new Set(body.items.map((i) => i.id))];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, preco_promocional_centavos,
            promocao_inicio, promocao_fim, disponivel, estoque, estoque_reservado
     FROM produtos WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<ProdutoRow>();

  const produtosPorId = new Map(results.map((p) => [p.id, p]));

  let totalCentavos = 0;
  const itensParaPersistir: {
    produtoId: number;
    produtoNome: string;
    quantidade: number;
    valorUnitarioCentavos: number;
    valorTotalCentavos: number;
  }[] = [];

  for (const item of body.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      return jsonError("Quantidade inválida", 400);
    }
    const produto = produtosPorId.get(item.id);
    if (!produto || !produto.disponivel) {
      return jsonError(`Produto ${item.id} indisponível`, 400);
    }
    const estoqueLivre = produto.estoque - produto.estoque_reservado;
    if (item.quantity > estoqueLivre) {
      return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409);
    }
    const valorUnitarioCentavos = precoAtualCentavos(produto);
    const valorTotalItemCentavos = valorUnitarioCentavos * item.quantity;
    totalCentavos += valorTotalItemCentavos;
    itensParaPersistir.push({
      produtoId: produto.id,
      produtoNome: produto.nome,
      quantidade: item.quantity,
      valorUnitarioCentavos,
      valorTotalCentavos: valorTotalItemCentavos,
    });
  }

  // O Mercado Pago exige e-mail do pagador; o checkout do site só coleta
  // nome e WhatsApp, então geramos um e-mail sintético só pra satisfazer a API.
  const whatsappDigits = whatsapp.replace(/\D/g, "") || "cliente";
  const payerEmail = `${whatsappDigits}@checkout.rpdoces.com.br`;

  const idempotencyKey = crypto.randomUUID();
  const tokenPublico = crypto.randomUUID();
  const PIX_EXPIRATION_MINUTES = 30;
  const expiresAt = new Date(
    Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000,
  ).toISOString();

  // Persiste pedido + itens + pagamento PENDENTE + alocações num único
  // batch (uma transação): o registro financeiro nasce antes de chamar o
  // Mercado Pago, sem janela entre "pagamento criado" e "alocado aos
  // itens" — cada statement resolve o id de que precisa por subquery
  // (token_publico / idempotency_key), sem depender de last_row_id entre
  // statements do mesmo batch.
  const batchResults = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pedidos
         (token_publico, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      tokenPublico,
      nome,
      whatsapp,
      (body.recado ?? "").slice(0, MAX_TEXT_LENGTH),
      totalCentavos,
      idempotencyKey,
    ),
    ...itensParaPersistir.map((item) =>
      env.DB.prepare(
        `INSERT INTO pedido_itens
           (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
         SELECT id, ?, ?, ?, ?, ? FROM pedidos WHERE token_publico = ?`,
      ).bind(
        item.produtoId,
        item.produtoNome,
        item.quantidade,
        item.valorUnitarioCentavos,
        item.valorTotalCentavos,
        tokenPublico,
      ),
    ),
    env.DB.prepare(
      `INSERT INTO pedido_pagamentos (pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
       SELECT id, 'PIX_MP', 'SITE', ?, 'PENDENTE', ? FROM pedidos WHERE token_publico = ?`,
    ).bind(totalCentavos, idempotencyKey, tokenPublico),
    env.DB.prepare(
      `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
       SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), pi.id, pi.valor_total_centavos
       FROM pedido_itens pi
       JOIN pedidos p ON p.id = pi.pedido_id
       WHERE p.token_publico = ? AND pi.valor_total_centavos > 0`,
    ).bind(idempotencyKey, tokenPublico),
  ]);

  const pedidoId = batchResults[0].meta.last_row_id;
  const pagamentoId = batchResults[1 + itensParaPersistir.length].meta.last_row_id;

  let mpResponse: Response;
  try {
    mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: totalCentavos / 100,
        description: "Pedido R&P Doces",
        payment_method_id: "pix",
        date_of_expiration: expiresAt,
        external_reference: tokenPublico,
        payer: { email: payerEmail, first_name: nome },
      }),
    });
  } catch (err) {
    // fetch() nunca resolveu (timeout/rede) — resultado financeiro
    // AMBÍGUO, não sabemos se o MP chegou a criar a cobrança. O ledger
    // fica PENDENTE (não FALHOU): marcar falha aqui seria mentira.
    console.error("Erro de transporte ao chamar o Mercado Pago", err);
    return jsonError("Falha ao criar pagamento Pix", 502);
  }

  if (!mpResponse.ok) {
    // O Mercado Pago respondeu e recusou — rejeição conhecida, não
    // ambígua. O ledger já pode registrar isso com mais fidelidade que
    // `pedidos`, que por compatibilidade do 4c-1 permanece PENDENTE.
    const errorBody = await mpResponse.text();
    console.error("Mercado Pago checkout error", mpResponse.status, errorBody);

    let mensagemErro: string | null = null;
    let detalheErro: string | null = null;
    try {
      const parsed = JSON.parse(errorBody) as {
        message?: string;
        cause?: unknown;
      };
      mensagemErro = parsed.message ?? null;
      detalheErro = parsed.cause ? JSON.stringify(parsed.cause).slice(0, 500) : null;
    } catch {
      // corpo de erro não era JSON — segue sem detalhe estruturado
    }

    await env.DB.prepare(
      `UPDATE pedido_pagamentos
       SET status = 'FALHOU', mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(mensagemErro, detalheErro, pagamentoId)
      .run();

    return jsonError("Falha ao criar pagamento Pix", 502);
  }

  const payment = (await mpResponse.json()) as {
    id: number;
    status: string;
    date_of_expiration: string | null;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    };
  };

  const txData = payment.point_of_interaction?.transaction_data;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pedidos
       SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
           mp_ticket_url = ?, pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(
      String(payment.id),
      payment.status,
      txData?.qr_code ?? null,
      txData?.qr_code_base64 ?? null,
      txData?.ticket_url ?? null,
      payment.date_of_expiration,
      pedidoId,
    ),
    env.DB.prepare(
      `UPDATE pedido_pagamentos
       SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
           mp_ticket_url = ?, pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(
      String(payment.id),
      payment.status,
      txData?.qr_code ?? null,
      txData?.qr_code_base64 ?? null,
      txData?.ticket_url ?? null,
      payment.date_of_expiration,
      pagamentoId,
    ),
  ]);

  return Response.json({
    pedidoId,
    tokenPublico,
    paymentId: payment.id,
    status: payment.status,
    qrCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
    ticketUrl: txData?.ticket_url ?? null,
    expiresAt: payment.date_of_expiration,
    totalCentavos,
  });
}
