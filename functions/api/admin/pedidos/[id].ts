/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";
import { getFinanceiroPedido, hasNetConfirmedPayment } from "../../../lib/comandaLedger";
import { getPixAdminPendentesAtivos } from "../../../lib/comandaPix";
import { liberarReservaPedido } from "../../../lib/stock";
import { listarOperacoesInconclusivasDoPedido } from "../../../lib/operacoes";

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
  status_comanda: string;
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
              status_pagamento, status_pedido, status_comanda, criado_em, pago_em
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

    const financeiro = await getFinanceiroPedido(env.DB, id);
    const pixAdminPendentes = await getPixAdminPendentesAtivos(env.DB, id);

    // B-3: cobranças cujo envio ao Mercado Pago ficou inconclusivo. Leitura
    // pura — não inventa estado nem decide nada. Existe para que o caso pare
    // de ser cego: a recuperação read-only tenta convergir sozinha, e o que
    // não converge (ambiguidade, provedor indisponível) fica visível aqui
    // para intervenção em vez de silenciosamente preso.
    const operacoesInconclusivas = (
      await listarOperacoesInconclusivasDoPedido(env.DB, id)
    ).map((o) => ({
      tipo: o.tipo,
      diagnostico: o.erro,
      atualizadoEm: o.atualizado_em,
    }));

    return Response.json({
      pedido,
      itens,
      financeiro,
      pixAdminPendentes,
      operacoesInconclusivas,
    });
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
      `SELECT id FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ id: number }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    // Consulta o ledger direto: "existe dinheiro do cliente RETIDO?" —
    // líquido (bruto - reembolsado), não bruto. Um pedido pago e depois
    // totalmente reembolsado (Passo 5) tem líquido zero e pode ser
    // cancelado sem exigir um segundo estorno que já aconteceu.
    if (novoStatus === "CANCELADO" && (await hasNetConfirmedPayment(env.DB, id))) {
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

    // Cancelar o pedido não terminaliza cobranças MP. A liberação revalida
    // o líquido e a ausência de Pix pendente dentro da transação física.
    if (novoStatus === "CANCELADO") {
      await liberarReservaPedido(env.DB, id);
    }

    return Response.json({ ok: true, statusPedido: novoStatus });
  } catch (err) {
    console.error("Erro ao alterar status do pedido (admin)", err);
    return jsonError("Erro interno ao alterar status do pedido", 500);
  }
};
