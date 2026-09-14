/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface PedidoRow {
  id: number;
  token_publico: string;
  status_pagamento: string;
  status_preparo: string;
  mp_payment_id: string | null;
  pix_expira_em: string | null;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function mapMpStatus(mpStatus: string): "PAGO" | "CANCELADO" | "EXPIRADO" | null {
  if (mpStatus === "approved") return "PAGO";
  if (mpStatus === "rejected" || mpStatus === "cancelled") return "CANCELADO";
  if (mpStatus === "expired") return "EXPIRADO";
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await handleStatus(request, env);
  } catch (err) {
    console.error("Erro inesperado ao consultar status do pedido", err);
    return jsonError("Erro interno ao consultar pedido", 500);
  }
};

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 100) {
    return jsonError("Token inválido", 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, token_publico, status_pagamento, status_preparo, mp_payment_id, pix_expira_em
     FROM pedidos WHERE token_publico = ?`,
  )
    .bind(token)
    .first<PedidoRow>();

  if (!pedido) {
    return jsonError("Pedido não encontrado", 404);
  }

  // Status já é definitivo — não precisa consultar o Mercado Pago de novo.
  if (pedido.status_pagamento !== "PENDENTE") {
    return Response.json({
      pedidoId: pedido.id,
      statusPagamento: pedido.status_pagamento,
      statusPreparo: pedido.status_preparo,
    });
  }

  if (
    pedido.pix_expira_em &&
    Date.now() > Date.parse(pedido.pix_expira_em)
  ) {
    await env.DB.prepare(
      `UPDATE pedidos SET status_pagamento = 'EXPIRADO', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(pedido.id)
      .run();
    return Response.json({
      pedidoId: pedido.id,
      statusPagamento: "EXPIRADO",
      statusPreparo: pedido.status_preparo,
    });
  }

  if (!pedido.mp_payment_id) {
    return Response.json({
      pedidoId: pedido.id,
      statusPagamento: pedido.status_pagamento,
      statusPreparo: pedido.status_preparo,
    });
  }

  const mpResponse = await fetch(
    `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}`,
    { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } },
  );

  if (!mpResponse.ok) {
    console.error(
      "Falha ao consultar pagamento no Mercado Pago",
      mpResponse.status,
    );
    return Response.json({
      pedidoId: pedido.id,
      statusPagamento: pedido.status_pagamento,
      statusPreparo: pedido.status_preparo,
    });
  }

  const payment = (await mpResponse.json()) as { status: string };
  const novoStatus = mapMpStatus(payment.status);

  if (!novoStatus) {
    return Response.json({
      pedidoId: pedido.id,
      statusPagamento: pedido.status_pagamento,
      statusPreparo: pedido.status_preparo,
    });
  }

  // Avança RECEBIDO -> EM_PREPARACAO quando o pagamento é confirmado,
  // sem nunca sobrescrever um status de preparo mais avançado.
  const novoStatusPreparo =
    novoStatus === "PAGO" && pedido.status_preparo === "RECEBIDO"
      ? "EM_PREPARACAO"
      : pedido.status_preparo;

  await env.DB.prepare(
    `UPDATE pedidos
     SET status_pagamento = ?, status_preparo = ?, mp_status = ?,
         pago_em = CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE pago_em END,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(novoStatus, novoStatusPreparo, payment.status, novoStatus, pedido.id)
    .run();

  return Response.json({
    pedidoId: pedido.id,
    statusPagamento: novoStatus,
    statusPreparo: novoStatusPreparo,
  });
}
