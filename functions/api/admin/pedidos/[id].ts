/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";

interface Env {
  DB: D1Database;
}

interface PedidoDetalheRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  recado: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_preparo: string;
  criado_em: string;
  pago_em: string | null;
}

interface PedidoItemRow {
  produto_id: number | null;
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
}

interface StatusInput {
  statusPreparo?: string;
}

const ORDEM_STATUS_PREPARO = [
  "RECEBIDO",
  "EM_PREPARACAO",
  "PRONTO_PARA_RETIRADA",
  "RETIRADO",
];

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(
      `SELECT id, cliente_nome, cliente_whatsapp, recado, valor_total_centavos,
              status_pagamento, status_preparo, criado_em, pago_em
       FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<PedidoDetalheRow>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    const { results: itens } = await env.DB.prepare(
      `SELECT pi.produto_id, pi.produto_nome, p.emoji, pi.quantidade,
              pi.valor_unitario_centavos, pi.valor_total_centavos
       FROM pedido_itens pi
       LEFT JOIN produtos p ON p.id = pi.produto_id
       WHERE pi.pedido_id = ?`,
    )
      .bind(id)
      .all<PedidoItemRow>();

    return Response.json({ pedido, itens });
  } catch (err) {
    console.error("Erro ao buscar pedido (admin)", err);
    return jsonError("Erro interno ao buscar pedido", 500);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: StatusInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const novoStatus = body.statusPreparo;
  if (!novoStatus || !ORDEM_STATUS_PREPARO.includes(novoStatus)) {
    return jsonError("Status inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(
      `SELECT status_preparo FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ status_preparo: string }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    const indiceAtual = ORDEM_STATUS_PREPARO.indexOf(pedido.status_preparo);
    const indiceNovo = ORDEM_STATUS_PREPARO.indexOf(novoStatus);
    if (indiceNovo !== indiceAtual + 1) {
      return jsonError("Só é possível avançar para o próximo status", 400);
    }

    await env.DB.prepare(
      `UPDATE pedidos SET status_preparo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(novoStatus, id)
      .run();

    return Response.json({ ok: true, statusPreparo: novoStatus });
  } catch (err) {
    console.error("Erro ao avançar status do pedido (admin)", err);
    return jsonError("Erro interno ao avançar status do pedido", 500);
  }
};
