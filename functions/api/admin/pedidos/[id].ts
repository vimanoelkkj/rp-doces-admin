/// <reference types="@cloudflare/workers-types" />

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
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// TODO(admin auth): proteger este endpoint quando a autenticação administrativa existir.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
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
      `SELECT pi.produto_nome, p.emoji, pi.quantidade,
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
