/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";
import { getFinanceiroPedido, hasNetConfirmedPayment } from "../../../lib/comandaLedger";
import { getCapacidadeCobravel, getPixAdminPendentesAtivos } from "../../../lib/comandaPix";
import { liberarReservaPedido, PIX_MP_PENDENTE_NO_PEDIDO_SQL } from "../../../lib/stock";
import { listarOperacoesInconclusivasDoPedido } from "../../../lib/operacoes";
import { reconcileExchangeCharges } from "../../../lib/itemExchange";

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
  origem_pedido: string;
  criado_em: string;
  pago_em: string | null;
}

interface PedidoItemRow {
  id: number;
  produto_id: number | null;
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  status_item: string;
  estoque_estado: string;
  cancelamento_id: number | null;
  cancelamento_status: string | null;
  troca_id: number | null;
  troca_status: string | null;
  troca_item_origem_id: number | null;
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

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
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
    await reconcileExchangeCharges(env.DB, id);
    const pedido = await env.DB.prepare(
      `SELECT id, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos,
              status_pagamento, status_pedido, status_comanda, origem_pedido,
              criado_em, pago_em
       FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<PedidoDetalheRow>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    const { results: itens } = await env.DB.prepare(
      `SELECT pi.id, pi.produto_id, pi.produto_nome, p.emoji, pi.quantidade,
              pi.valor_unitario_centavos, pi.valor_total_centavos,
              pi.status_item, pi.estoque_estado,
              (SELECT c.id FROM pedido_item_cancelamentos c
               WHERE c.pedido_item_id=pi.id AND c.status<>'FALHOU' ORDER BY c.id DESC LIMIT 1) AS cancelamento_id,
              (SELECT c.status FROM pedido_item_cancelamentos c
               WHERE c.pedido_item_id=pi.id AND c.status<>'FALHOU' ORDER BY c.id DESC LIMIT 1) AS cancelamento_status,
              (SELECT t.id FROM pedido_item_trocas t
               WHERE (t.item_origem_id=pi.id OR t.item_destino_id=pi.id) AND t.status<>'FALHOU' ORDER BY t.id DESC LIMIT 1) AS troca_id,
              (SELECT t.status FROM pedido_item_trocas t
               WHERE (t.item_origem_id=pi.id OR t.item_destino_id=pi.id) AND t.status<>'FALHOU' ORDER BY t.id DESC LIMIT 1) AS troca_status
              ,(SELECT t.item_origem_id FROM pedido_item_trocas t
               WHERE (t.item_origem_id=pi.id OR t.item_destino_id=pi.id) AND t.status<>'FALHOU' ORDER BY t.id DESC LIMIT 1) AS troca_item_origem_id
       FROM pedido_itens pi
       LEFT JOIN produtos p ON p.id = pi.produto_id
       WHERE pi.pedido_id = ?`,
    )
      .bind(id)
      .all<PedidoItemRow>();

    const [financeiro, pixAdminPendentes, capacidadeCobravelCentavos] = await Promise.all([
      getFinanceiroPedido(env.DB, id),
      getPixAdminPendentesAtivos(env.DB, id),
      getCapacidadeCobravel(env.DB, id),
    ]);

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
      capacidadeCobravelCentavos,
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

    // Cancelar com Pix vivo terminava num estado operacional impossível de
    // defender: o guard financeiro acima só prova que o líquido é zero AGORA,
    // e uma cobrança `PIX_MP/PENDENTE` é exatamente a situação em que isso
    // ainda pode mudar. Quando o cliente pagava depois, webhook/recuperação
    // preservavam corretamente a verdade financeira e o pedido terminava
    // CANCELADO + PAGO + estoque baixado.
    //
    // A recusa é decidida DENTRO da própria escrita, nunca por um SELECT
    // anterior: uma criação de Pix ADMIN, um webhook ou a recuperação B-3
    // concorrente não podem fazer nascer um Pix pendente entre a checagem e
    // o UPDATE. O predicado é o mesmo do B4 — a política pertence ao PEDIDO,
    // e Pix terminalizado (FALHOU/EXPIRADO/CANCELADO/PAGO) não bloqueia.
    //
    // Isto NÃO toca o Pix: nada vira CANCELADO/FALHOU, nada é enviado ao
    // Mercado Pago e nenhuma verdade financeira muda. É só o pedido que
    // deixa de poder mudar de estado enquanto a cobrança é inconclusiva.
    const alteracao = await env.DB.prepare(
      `UPDATE pedidos SET status_pedido = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND (? <> 'CANCELADO' OR NOT ${PIX_MP_PENDENTE_NO_PEDIDO_SQL})`,
    )
      .bind(novoStatus, id, novoStatus)
      .run();

    if (Number(alteracao?.meta?.changes || 0) === 0) {
      // O pedido foi confirmado acima, então só o guard do Pix recusa aqui.
      return jsonError(
        "Este pedido possui um Pix pendente de confirmação. Aguarde a confirmação ou o encerramento do Pix antes de cancelar.",
        409,
        "PEDIDO_COM_PIX_PENDENTE",
      );
    }

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
