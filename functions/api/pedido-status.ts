/// <reference types="@cloudflare/workers-types" />

import { refreshPedidoStatus, PedidoStatusRow } from "../lib/pedidoStatus";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
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
    `SELECT id, token_publico, status_pagamento, status_pedido, mp_payment_id, pix_expira_em
     FROM pedidos WHERE token_publico = ?`,
  )
    .bind(token)
    .first<PedidoStatusRow>();

  if (!pedido) {
    return jsonError("Pedido não encontrado", 404);
  }

  const atual = await refreshPedidoStatus(env.DB, env.MP_ACCESS_TOKEN, pedido);

  return Response.json({ pedidoId: pedido.id, ...atual });
}
