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
      // "Quanto dinheiro confirmado entrou hoje" é pergunta do livro-caixa,
      // não do agregado do pedido — um pedido PARCIAL contribui só a fração
      // realmente paga. Conta pagamentos confirmados (bate com o rótulo da
      // UI, "pagamento(s) confirmado(s)"), não pedidos.
      env.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pedido_pagamentos WHERE status = 'PAGO' AND date(pago_em) = ?`,
      )
        .bind(data)
        .first<ValorContagem>(),
      // "Ainda pode virar receita": PENDENTE agregado (zero confirmado) E
      // existe uma tentativa genuinamente viva no ledger — sem o EXISTS, um
      // Pix expirado (pago=0, mas tentativa morta) voltaria a contar aqui.
      env.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(valor_total_centavos), 0) AS total
         FROM pedidos p
         WHERE p.status_pagamento = 'PENDENTE' AND date(p.criado_em) = ?
           AND EXISTS (
             SELECT 1 FROM pedido_pagamentos pp
             WHERE pp.pedido_id = p.id AND pp.status = 'PENDENTE'
           )`,
      )
        .bind(data)
        .first<ValorContagem>(),
      // "Tem dinheiro confirmado (total ou parcial) e ainda está em
      // atendimento" — pergunta financeira+operacional combinada, PARCIAL
      // participa por definição.
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM pedidos
         WHERE status_pagamento IN ('PARCIAL', 'PAGO') AND status_comanda = 'ABERTA' AND date(criado_em) = ?`,
      )
        .bind(data)
        .first<{ count: number }>(),
      // "A cozinha pode começar a preparar" é pergunta operacional distinta
      // de "existe dinheiro confirmado" — fica só em PAGO, deliberadamente,
      // até virar decisão de negócio explícita incluir parcial aqui.
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
      // Visibilidade de vendas confirmadas (total ou parcial) — mesma
      // classificação de comandasAbertas/pedidosRecentes.
      env.DB.prepare(
        `SELECT pi.produto_nome AS nome, p.emoji AS emoji, SUM(pi.quantidade) AS unidades
         FROM pedido_itens pi
         JOIN pedidos ped ON ped.id = pi.pedido_id
         LEFT JOIN produtos p ON p.id = pi.produto_id
         WHERE ped.status_pagamento IN ('PARCIAL', 'PAGO') AND date(ped.criado_em) = ?
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
         WHERE p.status_pagamento IN ('PARCIAL', 'PAGO') AND date(p.criado_em) = ?
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
