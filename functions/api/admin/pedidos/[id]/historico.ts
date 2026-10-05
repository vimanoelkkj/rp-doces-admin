/// <reference types="@cloudflare/workers-types" />

import { getPedidoAnulacao } from "../../../../lib/pedidoValido";
import { requireUser } from "../../../../lib/auth";
import { montarHistoricoTimeline } from "../../../../lib/historicoTimeline";
import type {
  ItemAdicionadoRow,
  TrocaRow,
  CancelamentoRow,
  RefundConfirmadoRow,
  PagamentoRow,
  ReembolsoRow
} from "../../../../lib/historicoTimeline";

interface Env {
  DB: D1Database;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Leitura pura: nenhum INSERT/UPDATE/DELETE, nenhuma reconciliação, nenhuma
// chamada ao Mercado Pago. Só transforma fatos já persistidos (pedido_itens,
// pedido_item_cancelamentos, pedido_item_trocas, pedido_pagamentos,
// pedido_reembolsos e as alocações de reembolso) numa lista de eventos
// pronta para a timeline do admin. Nenhuma regra financeira ou de estoque é
// recalculada aqui — os valores exibidos são os que já estão gravados.

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(`SELECT id FROM pedidos WHERE id = ?`).bind(id).first();
    if (!pedido) return jsonError("Pedido não encontrado", 404);

    const [
      itensAdicionados,
      trocas,
      cancelamentos,
      refundsCancelamento,
      refundsTroca,
      pagamentos,
      reembolsos
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT pi.id, pi.produto_nome, pi.quantidade, pi.valor_total_centavos,
                  COALESCE(pi.adicionado_em, pi.criado_em) AS data,
                  ua.nome AS usuario_nome
           FROM pedido_itens pi
           LEFT JOIN usuarios_admin ua ON ua.id = pi.adicionado_por_usuario_id
           WHERE pi.pedido_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM pedido_item_trocas t
               WHERE t.item_destino_id = pi.id AND t.status <> 'FALHOU'
             )`
      )
        .bind(id)
        .all<ItemAdicionadoRow>(),

      env.DB.prepare(
        `SELECT t.id, t.item_origem_id, t.item_destino_id, t.produto_destino_id,
                  t.quantidade_destino, t.valor_origem_centavos, t.valor_destino_centavos,
                  t.diferenca_centavos, t.tipo_diferenca, t.estoque_acao_origem, t.status,
                  t.motivo, t.criado_em, t.concluido_em,
                  origem.produto_nome AS origem_nome, origem.estoque_estado AS origem_estoque_estado,
                  destino.produto_nome AS destino_nome, destino.estoque_estado AS destino_estoque_estado,
                  pd.nome AS produto_destino_nome,
                  ua.nome AS usuario_nome
           FROM pedido_item_trocas t
           JOIN pedido_itens origem ON origem.id = t.item_origem_id
           LEFT JOIN pedido_itens destino ON destino.id = t.item_destino_id
           LEFT JOIN produtos pd ON pd.id = t.produto_destino_id
           LEFT JOIN usuarios_admin ua ON ua.id = t.registrado_por_usuario_id
           WHERE t.pedido_id = ?
           ORDER BY t.id`
      )
        .bind(id)
        .all<TrocaRow>(),

      env.DB.prepare(
        `SELECT c.id, c.pedido_item_id, c.status, c.estoque_acao, c.motivo, c.valor_item_centavos,
                  c.criado_em, c.concluido_em,
                  i.produto_nome AS item_nome, i.estoque_estado AS item_estoque_estado,
                  ua.nome AS usuario_nome
           FROM pedido_item_cancelamentos c
           JOIN pedido_itens i ON i.id = c.pedido_item_id
           LEFT JOIN usuarios_admin ua ON ua.id = c.registrado_por_usuario_id
           WHERE c.pedido_id = ?
           ORDER BY c.id`
      )
        .bind(id)
        .all<CancelamentoRow>(),

      env.DB.prepare(
        `SELECT ra.pedido_item_cancelamento_id AS ref_id, r.metodo, SUM(ra.valor_centavos) AS valor
           FROM pedido_reembolso_alocacoes ra
           JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
           GROUP BY ra.pedido_item_cancelamento_id, r.metodo`
      )
        .bind(id)
        .all<RefundConfirmadoRow>(),

      env.DB.prepare(
        `SELECT ta.pedido_item_troca_id AS ref_id, r.metodo, SUM(ta.valor_centavos) AS valor
           FROM pedido_item_troca_reembolso_alocacoes ta
           JOIN pedido_reembolsos r ON r.id = ta.reembolso_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
           GROUP BY ta.pedido_item_troca_id, r.metodo`
      )
        .bind(id)
        .all<RefundConfirmadoRow>(),

      env.DB.prepare(
        `SELECT pp.id, pp.metodo, pp.valor_centavos, pp.pago_em, ua.nome AS usuario_nome
           FROM pedido_pagamentos pp
           LEFT JOIN usuarios_admin ua ON ua.id = pp.registrado_por_usuario_id
           WHERE pp.pedido_id = ? AND pp.status = 'PAGO'`
      )
        .bind(id)
        .all<PagamentoRow>(),

      env.DB.prepare(
        `SELECT r.id, r.metodo, r.valor_centavos, r.motivo,
                  COALESCE(r.concluido_em, r.criado_em) AS data,
                  ua.nome AS usuario_nome
           FROM pedido_reembolsos r
           LEFT JOIN usuarios_admin ua ON ua.id = r.registrado_por_usuario_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
             AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_alocacoes ra WHERE ra.reembolso_id = r.id)
             AND NOT EXISTS (SELECT 1 FROM pedido_item_troca_reembolso_alocacoes ta WHERE ta.reembolso_id = r.id)`
      )
        .bind(id)
        .all<ReembolsoRow>()
    ]);

    const anulacao = await getPedidoAnulacao(env.DB, id);
    const eventos = montarHistoricoTimeline({
      itensAdicionados: itensAdicionados.results,
      trocas: trocas.results,
      cancelamentos: cancelamentos.results,
      refundsCancelamento: refundsCancelamento.results,
      refundsTroca: refundsTroca.results,
      pagamentos: pagamentos.results,
      reembolsos: reembolsos.results,
      anulacao
    });

    return Response.json({ eventos });
  } catch (err) {
    console.error("Erro ao montar histórico do pedido (admin)", err);
    return jsonError("Erro interno ao buscar histórico", 500);
  }
};
