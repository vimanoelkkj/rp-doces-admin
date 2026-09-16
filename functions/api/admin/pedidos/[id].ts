/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";
import { getVirtualOrRealPayment } from "../../../lib/comandaLedger";

interface Env {
  DB: D1Database;
}

interface PedidoDetalheRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: string;
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
  statusPedido?: string;
}

// Mesmo enum de produção (order.model.ts / OrderStatusSelect.tsx). Sem
// CHECK no banco de propósito — produção também valida só em código.
const STATUS_PEDIDO_VALIDOS = [
  "NOVO",
  "PREPARANDO",
  "PRONTO",
  "ENTREGUE",
  "CANCELADO",
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
      `SELECT id, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos,
              status_pagamento, status_pedido, criado_em, pago_em
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

    const pagamento = await getVirtualOrRealPayment(env.DB, id);

    return Response.json({ pedido, itens, pagamento });
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

  const novoStatus = body.statusPedido;
  if (!novoStatus || !STATUS_PEDIDO_VALIDOS.includes(novoStatus)) {
    return jsonError("Status inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(
      `SELECT status_pagamento FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ status_pagamento: string }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    // Guarda-corpo interino: sem pedido_pagamentos (Passo 4) ainda,
    // status_pagamento='PAGO' é a melhor informação financeira disponível.
    // TODO(Passo 4): trocar por uma checagem no razão financeiro real.
    if (novoStatus === "CANCELADO" && pedido.status_pagamento === "PAGO") {
      return jsonError(
        "Pagamento confirmado. Faça o estorno antes de cancelar.",
        409,
      );
    }

    await env.DB.prepare(
      `UPDATE pedidos SET status_pedido = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(novoStatus, id)
      .run();

    return Response.json({ ok: true, statusPedido: novoStatus });
  } catch (err) {
    console.error("Erro ao alterar status do pedido (admin)", err);
    return jsonError("Erro interno ao alterar status do pedido", 500);
  }
};
