/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

interface PedidoListRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: string;
  criado_em: string;
}

interface CountsRow {
  todos: number;
  hoje: number;
  em_producao: number;
  prontos: number;
  entregues: number;
}

const ITEMS_PER_PAGE = 8;
const TAB_FILTERS: Record<string, string> = {
  hoje: "AND date(criado_em) = date('now')",
  em_producao: "AND status_pedido IN ('NOVO', 'PREPARANDO')",
  prontos: "AND status_pedido = 'PRONTO'",
  entregues: "AND status_pedido = 'ENTREGUE'",
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const tab = url.searchParams.get("status") ?? "todos";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    const tabFilter = TAB_FILTERS[tab] ?? "";

    let searchFilter = "";
    const searchParams: string[] = [];
    if (search) {
      const idPart = search.replace(/^RP-/i, "");
      searchFilter =
        "AND (CAST(id AS TEXT) LIKE ? OR cliente_nome LIKE ?)";
      searchParams.push(`%${idPart}%`, `%${search}%`);
    }

    const { count } = (await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pedidos
       WHERE status_pagamento = 'PAGO' ${tabFilter} ${searchFilter}`,
    )
      .bind(...searchParams)
      .first<{ count: number }>())!;

    const totalPages = Math.max(1, Math.ceil(count / ITEMS_PER_PAGE));
    const offset = (page - 1) * ITEMS_PER_PAGE;

    const { results: pedidos } = await env.DB.prepare(
      `SELECT id, cliente_nome, valor_total_centavos, status_pedido, criado_em
       FROM pedidos
       WHERE status_pagamento = 'PAGO' ${tabFilter} ${searchFilter}
       ORDER BY criado_em DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...searchParams, ITEMS_PER_PAGE, offset)
      .all<PedidoListRow>();

    const counts = (await env.DB.prepare(
      `SELECT
         COUNT(*) AS todos,
         SUM(CASE WHEN date(criado_em) = date('now') THEN 1 ELSE 0 END) AS hoje,
         SUM(CASE WHEN status_pedido IN ('NOVO', 'PREPARANDO') THEN 1 ELSE 0 END) AS em_producao,
         SUM(CASE WHEN status_pedido = 'PRONTO' THEN 1 ELSE 0 END) AS prontos,
         SUM(CASE WHEN status_pedido = 'ENTREGUE' THEN 1 ELSE 0 END) AS entregues
       FROM pedidos WHERE status_pagamento = 'PAGO'`,
    ).first<CountsRow>())!;

    return Response.json({
      pedidos,
      total: count,
      page,
      totalPages,
      counts,
    });
  } catch (err) {
    console.error("Erro ao listar pedidos (admin)", err);
    return jsonError("Erro interno ao listar pedidos", 500);
  }
};
