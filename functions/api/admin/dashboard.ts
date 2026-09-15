/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

interface ValorContagem {
  count: number;
  total: number;
}

interface CatalogoRow {
  total: number;
  baixo: number;
}

interface MaisVendidoRow {
  nome: string;
  emoji: string | null;
  unidades: number;
}

interface PedidoRecenteRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: string;
  itens_count: number;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const data = url.searchParams.get("date") ?? "";
    if (!DATA_REGEX.test(data)) {
      return jsonError("Parâmetro date inválido (esperado YYYY-MM-DD)", 400);
    }

    const [
      recebidoHoje,
      aReceber,
      comandasAbertas,
      aguardandoPreparo,
      catalogo,
      maisVendidos,
      pedidosRecentes,
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(valor_total_centavos), 0) AS total
         FROM pedidos WHERE status_pagamento = 'PAGO' AND date(pago_em) = ?`,
      )
        .bind(data)
        .first<ValorContagem>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(valor_total_centavos), 0) AS total
         FROM pedidos WHERE status_pagamento = 'PENDENTE' AND date(criado_em) = ?`,
      )
        .bind(data)
        .first<ValorContagem>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM pedidos
         WHERE status_pagamento = 'PAGO' AND status_comanda = 'ABERTA' AND date(criado_em) = ?`,
      )
        .bind(data)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM pedidos
         WHERE status_pagamento = 'PAGO' AND status_pedido = 'NOVO' AND date(criado_em) = ?`,
      )
        .bind(data)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN (estoque - estoque_reservado) <= 2 THEN 1 ELSE 0 END) AS baixo
         FROM produtos WHERE ativo = 1`,
      ).first<CatalogoRow>(),
      env.DB.prepare(
        `SELECT pi.produto_nome AS nome, p.emoji AS emoji, SUM(pi.quantidade) AS unidades
         FROM pedido_itens pi
         JOIN pedidos ped ON ped.id = pi.pedido_id
         LEFT JOIN produtos p ON p.id = pi.produto_id
         WHERE ped.status_pagamento = 'PAGO' AND date(ped.criado_em) = ?
         GROUP BY pi.produto_nome, p.emoji
         ORDER BY unidades DESC
         LIMIT 4`,
      )
        .bind(data)
        .all<MaisVendidoRow>(),
      env.DB.prepare(
        `SELECT p.id, p.cliente_nome, p.valor_total_centavos, p.status_pedido,
                (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = p.id) AS itens_count
         FROM pedidos p
         WHERE p.status_pagamento = 'PAGO' AND date(p.criado_em) = ?
         ORDER BY p.criado_em DESC
         LIMIT 8`,
      )
        .bind(data)
        .all<PedidoRecenteRow>(),
    ]);

    return Response.json({
      data,
      recebidoHoje: recebidoHoje ?? { count: 0, total: 0 },
      aReceber: aReceber ?? { count: 0, total: 0 },
      comandasAbertas: comandasAbertas?.count ?? 0,
      aguardandoPreparo: aguardandoPreparo?.count ?? 0,
      catalogo: {
        total: catalogo?.total ?? 0,
        estoqueBaixo: catalogo?.baixo ?? 0,
      },
      maisVendidos: maisVendidos.results,
      pedidosRecentes: pedidosRecentes.results,
    });
  } catch (err) {
    console.error("Erro ao carregar dashboard (admin)", err);
    return jsonError("Erro interno ao carregar dashboard", 500);
  }
};
