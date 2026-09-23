/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql } from "../lib/pedidoValido";

import { refreshPedidoStatus, PedidoStatusRow } from "../lib/pedidoStatus";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface PedidoDetalheRow extends PedidoStatusRow {
  cliente_nome: string;
  valor_total_centavos: number;
  criado_em: string;
}

interface PedidoItemRow {
  produto_nome: string;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await handleDetalhe(request, env);
  } catch (err) {
    console.error("Erro inesperado ao buscar pedido", err);
    return jsonError("Erro interno ao buscar pedido", 500);
  }
};

async function handleDetalhe(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 100) {
    return jsonError("Token inválido", 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, token_publico, cliente_nome, valor_total_centavos, criado_em,
            status_pagamento, status_pedido, mp_payment_id, pix_expira_em
     FROM pedidos WHERE ${pedidoValidoSql('pedidos.id')} AND token_publico = ?`,
  )
    .bind(token)
    .first<PedidoDetalheRow>();

  if (!pedido) {
    return jsonError("Pedido não encontrado", 404);
  }

  const atual = await refreshPedidoStatus(env.DB, env.MP_ACCESS_TOKEN, pedido, env);

  const { results: itens } = await env.DB.prepare(
    `SELECT produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos
     FROM pedido_itens WHERE pedido_id = ?`,
  )
    .bind(pedido.id)
    .all<PedidoItemRow>();

  return Response.json({
    pedidoId: pedido.id,
    clienteNome: pedido.cliente_nome,
    valorTotalCentavos: pedido.valor_total_centavos,
    criadoEm: pedido.criado_em,
    itens,
    ...atual,
  });
}
