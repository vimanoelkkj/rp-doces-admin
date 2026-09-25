/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql } from "../lib/pedidoValido";
import { sameOrigin } from "../lib/auth";

import { readPedidoStatus, refreshPedidoStatus, PedidoStatusRow } from "../lib/pedidoStatus";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// GET: somente leitura do estado já persistido. POST: gatilho explícito da
// recuperação (consulta ao Mercado Pago com throttle de 15s por tentativa,
// expiração local, reconciliação). O token público é a autorização nos dois.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const pedido = await buscarPedido(request, env);
    if (pedido instanceof Response) return pedido;
    const atual = await readPedidoStatus(env.DB, pedido);
    return Response.json({ pedidoId: pedido.id, ...atual });
  } catch (err) {
    console.error("Erro inesperado ao consultar status do pedido", err);
    return jsonError("Erro interno ao consultar pedido", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }
  try {
    const pedido = await buscarPedido(request, env);
    if (pedido instanceof Response) return pedido;
    const atual = await refreshPedidoStatus(env.DB, env.MP_ACCESS_TOKEN, pedido, env);
    return Response.json({ pedidoId: pedido.id, ...atual });
  } catch (err) {
    console.error("Erro inesperado ao reconciliar status do pedido", err);
    return jsonError("Erro interno ao consultar pedido", 500);
  }
};

async function buscarPedido(request: Request, env: Env): Promise<PedidoStatusRow | Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 100) {
    return jsonError("Token inválido", 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, token_publico, status_pagamento, status_pedido, mp_payment_id, pix_expira_em
     FROM pedidos WHERE ${pedidoValidoSql('pedidos.id')} AND token_publico = ?`,
  )
    .bind(token)
    .first<PedidoStatusRow>();

  return pedido ?? jsonError("Pedido não encontrado", 404);
}
