/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../auth";
import { pedidoValidoSql } from "../pedidoValido";
import { getFinanceirosPorPedidos, type FinanceiroPedido } from "../comandaLedger";
import type { Env } from "./types";

interface PedidoListRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: string;
  criado_em: string;
}

interface PedidoListItem extends PedidoListRow {
  financeiro: FinanceiroPedido;
}

interface CountsRow {
  todos: number;
  hoje: number;
  novos: number;
  em_producao: number;
  prontos: number;
  entregues: number;
  arquivados: number;
}

const ITEMS_PER_PAGE = 8;
const TAB_FILTERS: Record<string, string> = {
  hoje: "AND date(criado_em) = date('now')",
  novos: "AND status_pedido = 'NOVO'",
  em_producao: "AND status_pedido = 'PREPARANDO'",
  prontos: "AND status_pedido = 'PRONTO'",
  entregues: "AND status_pedido = 'ENTREGUE'",
};

// B-1 — quais pedidos pertencem à operação do balcão.
//
// Antes: somente `status_pagamento IN ('PARCIAL','PAGO')`. Isso escondia por
// completo os pedidos criados pelo próprio admin que nascem PENDENTE — e
// esse é o caminho DEFAULT do "Novo pedido" (DINHEIRO/PENDENTE), além de
// todo `A_COMBINAR`. O pedido existia, reservava estoque, e não havia
// nenhuma outra listagem por onde alcançá-lo: o detalhe, a troca de status,
// o registro de pagamento e a geração de Pix ficavam inacessíveis
// exatamente para os pedidos que mais precisavam deles.
//
// `origem_pedido = 'MANUAL'` entra INDEPENDENTE do status financeiro porque
// um pedido de balcão é um compromisso real assumido pela operadora no
// instante em que ela o registrou — inclusive quando o pagamento ficou para
// depois. É a mesma razão pela qual a reserva dele não expira sozinha (ver
// nota de política na criação, abaixo).
//
// Pedido SITE PENDENTE continua deliberadamente FORA: é carrinho não pago,
// não um compromisso. Ele entra na listagem no instante em que vira
// PARCIAL/PAGO, como sempre. Isso não é efeito colateral — é o recorte.
//
// Um único predicado alimenta contagem, página e contadores das abas; nunca
// três cópias que possam divergir e produzir "8 de 12" numa aba vazia.
const PEDIDOS_OPERACIONAIS_SQL =
  "(status_pagamento IN ('PARCIAL', 'PAGO') OR origem_pedido = 'MANUAL')";

export async function listPedidos(
  context: Parameters<PagesFunction<Env>>[0],
): Promise<Response> {
  const { request, env } = context;
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const tab = url.searchParams.get("status") ?? "todos";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    const tabFilter = TAB_FILTERS[tab] ?? "";
    const listScope = tab === "arquivados"
      ? "arquivado = 1"
      : `arquivado = 0 AND ${PEDIDOS_OPERACIONAIS_SQL}`;

    let searchFilter = "";
    const searchParams: string[] = [];
    if (search) {
      const idPart = search.replace(/^RP-/i, "");
      searchFilter =
        "AND (CAST(id AS TEXT) LIKE ? OR cliente_nome LIKE ?)";
      searchParams.push(`%${idPart}%`, `%${search}%`);
    }

    const offset = (page - 1) * ITEMS_PER_PAGE;

    // As três leituras independentes da tela saem juntas. Antes eram
    // round-trips sequenciais ao D1 (count -> página -> financeiros -> counts).
    // Agora count, página e contadores são buscados em paralelo; só a projeção
    // financeira depende da lista de ids retornada.
    const [countRow, pedidosResult, counts] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM pedidos
         WHERE ${pedidoValidoSql('pedidos.id')} AND ${listScope} ${tabFilter} ${searchFilter}`,
      )
        .bind(...searchParams)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT id, cliente_nome, valor_total_centavos, status_pagamento, status_pedido, criado_em
         FROM pedidos
         WHERE ${pedidoValidoSql('pedidos.id')} AND ${listScope} ${tabFilter} ${searchFilter}
         ORDER BY criado_em DESC
         LIMIT ? OFFSET ?`,
      )
        .bind(...searchParams, ITEMS_PER_PAGE, offset)
        .all<PedidoListRow>(),
      env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL} THEN 1 ELSE 0 END),0) AS todos,
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL}
                     AND date(criado_em)=date('now') THEN 1 ELSE 0 END),0) AS hoje,
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL}
                     AND status_pedido='NOVO' THEN 1 ELSE 0 END),0) AS novos,
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL}
                     AND status_pedido='PREPARANDO' THEN 1 ELSE 0 END),0) AS em_producao,
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL}
                     AND status_pedido='PRONTO' THEN 1 ELSE 0 END),0) AS prontos,
           COALESCE(SUM(CASE WHEN arquivado=0 AND ${PEDIDOS_OPERACIONAIS_SQL}
                     AND status_pedido='ENTREGUE' THEN 1 ELSE 0 END),0) AS entregues,
           COALESCE(SUM(CASE WHEN arquivado=1 THEN 1 ELSE 0 END),0) AS arquivados
         FROM pedidos WHERE ${pedidoValidoSql('pedidos.id')}`,
      ).first<CountsRow>(),
    ]);

    const count = Number(countRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(count / ITEMS_PER_PAGE));
    const pedidos = pedidosResult.results ?? [];

    // Lote único pra página inteira (no máximo ITEMS_PER_PAGE pedidos) —
    // nunca uma consulta financeira por linha.
    const financeiroPorPedido = await getFinanceirosPorPedidos(
      env.DB,
      pedidos.map((p) => ({
        id: p.id,
        valorTotalCentavos: p.valor_total_centavos,
        statusPagamento: p.status_pagamento,
      })),
    );
    const pedidosComFinanceiro: PedidoListItem[] = pedidos.map((p) => ({
      ...p,
      financeiro: financeiroPorPedido.get(p.id) ?? {
        status: p.status_pagamento as FinanceiroPedido["status"],
        brutoPagoCentavos: 0,
        reembolsadoCentavos: 0,
        liquidoCentavos: 0,
        saldoCentavos: p.valor_total_centavos,
        pagoCentavos: 0,
        totalCentavos: p.valor_total_centavos,
        excessoCentavos: 0,
        temExcesso: false,
        metodosConfirmados: [],
      },
    }));

    return Response.json({
      pedidos: pedidosComFinanceiro,
      total: count,
      page,
      totalPages,
      counts: counts ?? {
        todos: 0,
        hoje: 0,
        novos: 0,
        em_producao: 0,
        prontos: 0,
        entregues: 0,
        arquivados: 0,
      },
    });
  } catch (err) {
    console.error("Erro ao listar pedidos (admin)", err);
    return Response.json({ error: "Erro interno ao listar pedidos" }, { status: 500 });
  }
}
