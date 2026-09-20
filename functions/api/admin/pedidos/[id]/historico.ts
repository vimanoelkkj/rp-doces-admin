/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../lib/auth";

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

type EventoTipo =
  | "ITEM_ADICIONADO"
  | "TROCA_SOLICITADA"
  | "TROCA_CONCLUIDA"
  | "CANCELAMENTO_SOLICITADO"
  | "CANCELAMENTO_CONCLUIDO"
  | "PAGAMENTO"
  | "REEMBOLSO";

interface ItemRef {
  id: number | null;
  nome: string;
  quantidade?: number;
  valorCentavos?: number;
  estoqueEstado?: string | null;
}

interface HistoricoEvento {
  id: string;
  tipo: EventoTipo;
  data: string;
  titulo: string;
  status?: string | null;
  item?: ItemRef;
  itemOrigem?: ItemRef;
  itemDestino?: ItemRef;
  valorOrigemCentavos?: number;
  valorDestinoCentavos?: number;
  diferencaCentavos?: number;
  tipoDiferenca?: string;
  metodo?: string | null;
  metodosReembolso?: string[];
  valorCentavos?: number;
  valorReembolsoCentavos?: number;
  estoqueAcao?: string | null;
  motivo?: string;
  usuario?: string | null;
  referenciaId?: number;
}

interface ItemAdicionadoRow {
  id: number;
  produto_nome: string;
  quantidade: number;
  valor_total_centavos: number;
  data: string;
  usuario_nome: string | null;
}

interface TrocaRow {
  id: number;
  item_origem_id: number;
  item_destino_id: number | null;
  produto_destino_id: number;
  quantidade_destino: number;
  valor_origem_centavos: number;
  valor_destino_centavos: number;
  diferenca_centavos: number;
  tipo_diferenca: string;
  estoque_acao_origem: string;
  status: string;
  motivo: string;
  criado_em: string;
  concluido_em: string | null;
  origem_nome: string;
  origem_estoque_estado: string;
  destino_nome: string | null;
  destino_estoque_estado: string | null;
  produto_destino_nome: string;
  usuario_nome: string | null;
}

interface CancelamentoRow {
  id: number;
  pedido_item_id: number;
  status: string;
  estoque_acao: string;
  motivo: string;
  valor_item_centavos: number;
  criado_em: string;
  concluido_em: string | null;
  item_nome: string;
  item_estoque_estado: string;
  usuario_nome: string | null;
}

interface RefundConfirmadoRow {
  ref_id: number;
  metodo: string;
  valor: number;
}

interface PagamentoRow {
  id: number;
  metodo: string;
  valor_centavos: number;
  pago_em: string;
  usuario_nome: string | null;
}

interface ReembolsoRow {
  id: number;
  metodo: string;
  valor_centavos: number;
  motivo: string;
  data: string;
  usuario_nome: string | null;
}

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

    const [itensAdicionados, trocas, cancelamentos, refundsCancelamento, refundsTroca, pagamentos, reembolsos] =
      await Promise.all([
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
             )`,
        ).bind(id).all<ItemAdicionadoRow>(),

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
           ORDER BY t.id`,
        ).bind(id).all<TrocaRow>(),

        env.DB.prepare(
          `SELECT c.id, c.pedido_item_id, c.status, c.estoque_acao, c.motivo, c.valor_item_centavos,
                  c.criado_em, c.concluido_em,
                  i.produto_nome AS item_nome, i.estoque_estado AS item_estoque_estado,
                  ua.nome AS usuario_nome
           FROM pedido_item_cancelamentos c
           JOIN pedido_itens i ON i.id = c.pedido_item_id
           LEFT JOIN usuarios_admin ua ON ua.id = c.registrado_por_usuario_id
           WHERE c.pedido_id = ?
           ORDER BY c.id`,
        ).bind(id).all<CancelamentoRow>(),

        env.DB.prepare(
          `SELECT ra.pedido_item_cancelamento_id AS ref_id, r.metodo, SUM(ra.valor_centavos) AS valor
           FROM pedido_reembolso_alocacoes ra
           JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
           GROUP BY ra.pedido_item_cancelamento_id, r.metodo`,
        ).bind(id).all<RefundConfirmadoRow>(),

        env.DB.prepare(
          `SELECT ta.pedido_item_troca_id AS ref_id, r.metodo, SUM(ta.valor_centavos) AS valor
           FROM pedido_item_troca_reembolso_alocacoes ta
           JOIN pedido_reembolsos r ON r.id = ta.reembolso_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
           GROUP BY ta.pedido_item_troca_id, r.metodo`,
        ).bind(id).all<RefundConfirmadoRow>(),

        env.DB.prepare(
          `SELECT pp.id, pp.metodo, pp.valor_centavos, pp.pago_em, ua.nome AS usuario_nome
           FROM pedido_pagamentos pp
           LEFT JOIN usuarios_admin ua ON ua.id = pp.registrado_por_usuario_id
           WHERE pp.pedido_id = ? AND pp.status = 'PAGO'`,
        ).bind(id).all<PagamentoRow>(),

        env.DB.prepare(
          `SELECT r.id, r.metodo, r.valor_centavos, r.motivo,
                  COALESCE(r.concluido_em, r.criado_em) AS data,
                  ua.nome AS usuario_nome
           FROM pedido_reembolsos r
           LEFT JOIN usuarios_admin ua ON ua.id = r.registrado_por_usuario_id
           WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
             AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_alocacoes ra WHERE ra.reembolso_id = r.id)
             AND NOT EXISTS (SELECT 1 FROM pedido_item_troca_reembolso_alocacoes ta WHERE ta.reembolso_id = r.id)`,
        ).bind(id).all<ReembolsoRow>(),
      ]);

    function agruparRefunds(rows: RefundConfirmadoRow[]): Map<number, { metodos: string[]; total: number }> {
      const mapa = new Map<number, { metodos: string[]; total: number }>();
      for (const row of rows) {
        const atual = mapa.get(row.ref_id) ?? { metodos: [], total: 0 };
        atual.metodos.push(row.metodo);
        atual.total += Number(row.valor);
        mapa.set(row.ref_id, atual);
      }
      return mapa;
    }
    const refundsPorCancelamento = agruparRefunds(refundsCancelamento.results);
    const refundsPorTroca = agruparRefunds(refundsTroca.results);

    const eventos: HistoricoEvento[] = [];

    for (const row of itensAdicionados.results) {
      eventos.push({
        id: `item-${row.id}`,
        tipo: "ITEM_ADICIONADO",
        data: row.data,
        titulo: `${row.produto_nome} adicionado`,
        item: {
          id: row.id,
          nome: row.produto_nome,
          quantidade: Number(row.quantidade),
          valorCentavos: Number(row.valor_total_centavos),
        },
        usuario: row.usuario_nome,
        referenciaId: row.id,
      });
    }

    for (const row of trocas.results) {
      const destinoNome = row.destino_nome ?? row.produto_destino_nome;
      const itemOrigem: ItemRef = {
        id: row.item_origem_id, nome: row.origem_nome,
        valorCentavos: Number(row.valor_origem_centavos), estoqueEstado: row.origem_estoque_estado,
      };
      const itemDestino: ItemRef = {
        id: row.item_destino_id, nome: destinoNome,
        quantidade: Number(row.quantidade_destino),
        valorCentavos: Number(row.valor_destino_centavos), estoqueEstado: row.destino_estoque_estado,
      };
      const refundTroca = refundsPorTroca.get(row.id);
      const base = {
        itemOrigem, itemDestino,
        valorOrigemCentavos: Number(row.valor_origem_centavos),
        valorDestinoCentavos: Number(row.valor_destino_centavos),
        diferencaCentavos: Number(row.diferenca_centavos),
        tipoDiferenca: row.tipo_diferenca,
        estoqueAcao: row.estoque_acao_origem,
        motivo: row.motivo || undefined,
        usuario: row.usuario_nome,
        referenciaId: row.item_origem_id,
        ...(refundTroca
          ? { metodosReembolso: Array.from(new Set(refundTroca.metodos)), valorReembolsoCentavos: refundTroca.total }
          : {}),
      };
      eventos.push({
        id: `troca-solicitada-${row.id}`,
        tipo: "TROCA_SOLICITADA",
        data: row.criado_em,
        titulo: "Troca solicitada",
        status: row.status === "CONCLUIDA" ? null : row.status,
        ...base,
      });
      if (row.status === "CONCLUIDA" && row.concluido_em) {
        eventos.push({
          id: `troca-concluida-${row.id}`,
          tipo: "TROCA_CONCLUIDA",
          data: row.concluido_em,
          titulo: "Troca concluída",
          status: "CONCLUIDA",
          ...base,
        });
      }
    }

    for (const row of cancelamentos.results) {
      const refund = refundsPorCancelamento.get(row.id);
      const item: ItemRef = {
        id: row.pedido_item_id, nome: row.item_nome,
        valorCentavos: Number(row.valor_item_centavos), estoqueEstado: row.item_estoque_estado,
      };
      const base = {
        item,
        estoqueAcao: row.estoque_acao,
        motivo: row.motivo || undefined,
        usuario: row.usuario_nome,
        referenciaId: row.pedido_item_id,
        ...(refund
          ? { metodosReembolso: Array.from(new Set(refund.metodos)), valorReembolsoCentavos: refund.total }
          : {}),
      };
      eventos.push({
        id: `cancelamento-solicitado-${row.id}`,
        tipo: "CANCELAMENTO_SOLICITADO",
        data: row.criado_em,
        titulo: "Cancelamento solicitado",
        status: row.status === "CONCLUIDO" ? null : row.status,
        ...base,
      });
      if (row.status === "CONCLUIDO" && row.concluido_em) {
        eventos.push({
          id: `cancelamento-concluido-${row.id}`,
          tipo: "CANCELAMENTO_CONCLUIDO",
          data: row.concluido_em,
          titulo: "Cancelamento concluído",
          status: "CONCLUIDO",
          ...base,
        });
      }
    }

    for (const row of pagamentos.results) {
      eventos.push({
        id: `pagamento-${row.id}`,
        tipo: "PAGAMENTO",
        data: row.pago_em,
        titulo: "Pagamento registrado",
        metodo: row.metodo,
        valorCentavos: Number(row.valor_centavos),
        usuario: row.usuario_nome,
        referenciaId: row.id,
      });
    }

    for (const row of reembolsos.results) {
      eventos.push({
        id: `reembolso-${row.id}`,
        tipo: "REEMBOLSO",
        data: row.data,
        titulo: "Reembolso confirmado",
        metodo: row.metodo,
        valorReembolsoCentavos: Number(row.valor_centavos),
        motivo: row.motivo || undefined,
        usuario: row.usuario_nome,
        referenciaId: row.id,
      });
    }

    eventos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

    return Response.json({ eventos });
  } catch (err) {
    console.error("Erro ao montar histórico do pedido (admin)", err);
    return jsonError("Erro interno ao buscar histórico", 500);
  }
};
