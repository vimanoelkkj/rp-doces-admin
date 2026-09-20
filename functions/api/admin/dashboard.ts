/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../lib/auth";
import { getStoreAnalytics } from "../../lib/dashboardAnalytics";

interface Env {
  DB: D1Database;
}

interface ValorContagem {
  count: number;
  total: number;
}

interface AReceberResumo extends ValorContagem {
  anteriores: number;
}

interface PendenciaPagamentoRow {
  id: number;
  cliente_nome: string;
  status_pedido: string;
  criado_em: string;
  saldo_centavos: number;
  dias_em_aberto: number;
}

interface CatalogoRow {
  total: number;
  baixo: number;
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

// "A receber" é estado atual da loja, não resultado do dia selecionado.
// O CTE usa o mesmo princípio do ledger: bruto PAGO menos refunds
// REEMBOLSADO, e carrega a obrigação enquanto houver saldo líquido aberto.
// Pedido manual é compromisso operacional mesmo sem Pix vivo; pedido SITE
// PENDENTE só entra se ainda houver uma tentativa de pagamento viva.
const PENDENCIAS_FINANCEIRAS_CTE = `
WITH candidatos AS (
  SELECT
    p.id,
    p.cliente_nome,
    p.status_pedido,
    p.criado_em,
    p.valor_total_centavos,
    COALESCE((
      SELECT SUM(pp.valor_centavos)
      FROM pedido_pagamentos pp
      WHERE pp.pedido_id = p.id AND pp.status = 'PAGO'
    ), 0) AS bruto_pago_centavos,
    COALESCE((
      SELECT SUM(r.valor_centavos)
      FROM pedido_reembolsos r
      WHERE r.pedido_id = p.id AND r.status = 'REEMBOLSADO'
    ), 0) AS reembolsado_centavos
  FROM pedidos p
  WHERE p.status_pedido <> 'CANCELADO'
    AND (
      p.origem_pedido = 'MANUAL'
      OR EXISTS (
        SELECT 1
        FROM pedido_pagamentos pp
        WHERE pp.pedido_id = p.id
          AND (
            pp.status = 'PAGO'
            OR (
              pp.status = 'PENDENTE'
              AND (pp.pix_expira_em IS NULL OR datetime(pp.pix_expira_em) > CURRENT_TIMESTAMP)
            )
          )
      )
    )
),
pendencias AS (
  SELECT
    id,
    cliente_nome,
    status_pedido,
    criado_em,
    MAX(
      0,
      valor_total_centavos - MAX(0, bruto_pago_centavos - reembolsado_centavos)
    ) AS saldo_centavos
  FROM candidatos
)
`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const url = new URL(request.url);
    const data = url.searchParams.get("date") ?? "";
    const hoje = url.searchParams.get("today") ?? data;
    if (!DATA_REGEX.test(data) || !DATA_REGEX.test(hoje)) {
      return jsonError("Parâmetro date/today inválido (esperado YYYY-MM-DD)", 400);
    }

    const [
      recebidoHoje,
      aReceber,
      pagamentosPendentes,
      comandasAbertas,
      aguardandoPreparo,
      catalogo,
      analytics,
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
      // Estado financeiro ATUAL: atravessa a virada do dia e independe do
      // filtro de data do dashboard. "anteriores" usa a data local enviada
      // pelo browser, então selecionar outro dia no calendário não apaga a
      // fila operacional de cobrança.
      env.DB.prepare(
        `${PENDENCIAS_FINANCEIRAS_CTE}
         SELECT
           COUNT(*) AS count,
           COALESCE(SUM(saldo_centavos), 0) AS total,
           COALESCE(SUM(CASE WHEN date(criado_em) < ? THEN 1 ELSE 0 END), 0) AS anteriores
         FROM pendencias
         WHERE saldo_centavos > 0`,
      )
        .bind(hoje)
        .first<AReceberResumo>(),
      env.DB.prepare(
        `${PENDENCIAS_FINANCEIRAS_CTE}
         SELECT
           id,
           cliente_nome,
           status_pedido,
           criado_em,
           saldo_centavos,
           CASE
             WHEN date(criado_em) < ?
             THEN MAX(1, CAST(julianday(?) - julianday(date(criado_em)) AS INTEGER))
             ELSE 0
           END AS dias_em_aberto
         FROM pendencias
         WHERE saldo_centavos > 0
         ORDER BY
           CASE WHEN date(criado_em) < ? THEN 0 ELSE 1 END,
           criado_em ASC,
           id ASC
         LIMIT 4`,
      )
        .bind(hoje, hoje, hoje)
        .all<PendenciaPagamentoRow>(),
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
      getStoreAnalytics(env.DB),
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
      aReceber: aReceber ?? { count: 0, total: 0, anteriores: 0 },
      pagamentosPendentes: pagamentosPendentes.results,
      comandasAbertas: comandasAbertas?.count ?? 0,
      aguardandoPreparo: aguardandoPreparo?.count ?? 0,
      catalogo: {
        total: catalogo?.total ?? 0,
        estoqueBaixo: catalogo?.baixo ?? 0,
      },
      financeiro: analytics.financeiro,
      maisVendidos: analytics.maisVendidos,
      pedidosRecentes: pedidosRecentes.results,
    });
  } catch (err) {
    console.error("Erro ao carregar dashboard (admin)", err);
    return jsonError("Erro interno ao carregar dashboard", 500);
  }
};
