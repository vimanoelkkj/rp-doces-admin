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

  // Persiste o pedido antes de chamar o Mercado Pago: se a chamada falhar,
  // o pedido fica registrado como PENDENTE em vez de se perder.
  const pedidoInsert = await env.DB.prepare(
    `INSERT INTO pedidos
       (token_publico, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tokenPublico,
      nome,
      whatsapp,
      (body.recado ?? "").slice(0, MAX_TEXT_LENGTH),
      totalCentavos,
      idempotencyKey,
    )
    .run();

  const pedidoId = pedidoInsert.meta.last_row_id;

  await env.DB.batch(
    itensParaPersistir.map((item) =>
      env.DB.prepare(
        `INSERT INTO pedido_itens
           (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        pedidoId,
        item.produtoId,
        item.produtoNome,
        item.quantidade,
        item.valorUnitarioCentavos,
        item.valorTotalCentavos,
      ),
    ),
  );

  const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
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

  if (!mpResponse.ok) {
    const errorBody = await mpResponse.text();
    console.error("Mercado Pago checkout error", mpResponse.status, errorBody);
    // O pedido já está persistido (PENDENTE, sem dados de pagamento) — não é perdido.
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

  await env.DB.prepare(
    `UPDATE pedidos
     SET mp_payment_id = ?, mp_status = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
         mp_ticket_url = ?, pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      String(payment.id),
      payment.status,
      txData?.qr_code ?? null,
      txData?.qr_code_base64 ?? null,
      txData?.ticket_url ?? null,
      payment.date_of_expiration,
      pedidoId,
    )
    .run();

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
