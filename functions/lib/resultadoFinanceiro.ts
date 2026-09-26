/// <reference types="@cloudflare/workers-types" />

// Ponte de LEITURA entre faturamento (pedidos) e despesas — nunca escreve em
// nenhuma tabela de pedido. A definição de "faturamento líquido" é
// EXATAMENTE a mesma usada por functions/lib/dashboardAnalytics.ts
// (getStoreAnalytics/STORE_FINANCIAL_SQL): bruto de pagamentos PAGO menos
// reembolsos REEMBOLSADO, nunca negativo, sempre excluindo pedidos anulados
// via pedidoValidoSql. A única adição aqui é o recorte por período, usando
// a mesma data de referência que o dashboard já usa para "recebido hoje"
// (pago_em / concluido_em).

import { pedidoValidoSql } from "./pedidoValido";
import { storeDateSql } from "./storeDay";

export interface ResultadoFinanceiro {
  faturamentoLiquidoCentavos: number;
  despesasCentavos: number;
  lucroEstimadoCentavos: number;
  // null quando faturamento = 0 (divisão por zero não é "0%", é indefinida).
  margemEstimada: number | null;
}

interface ResultadoRow {
  faturamento_liquido_centavos: number;
  despesas_centavos: number;
}

export async function getResultadoFinanceiro(
  db: D1Database,
  params?: { desde: string; ate: string },
): Promise<ResultadoFinanceiro> {
  // Sem params: acumulado geral, na mesma definição de "Caixa total"
  // (getStoreAnalytics) — bate com o que o dono vê como saldo da loja,
  // em vez de recortar só o dia e destoar do card de cima.
  // pago_em/concluido_em são instantes (UTC ou ISO com offset): o recorte usa
  // o dia comercial da loja (America/Sao_Paulo, ver storeDay.ts).
  // data_competencia já é uma data comercial YYYY-MM-DD escolhida pelo
  // usuário — comparada como está, sem conversão de fuso.
  const filtroPagamentos = params ? `AND ${storeDateSql("pago_em")} BETWEEN ? AND ?` : "";
  const filtroReembolsos = params ? `AND ${storeDateSql("concluido_em")} BETWEEN ? AND ?` : "";
  const filtroDespesas = params ? "AND d.data_competencia BETWEEN ? AND ?" : "";
  const row = await db.prepare(`SELECT
      MAX(0,
        COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos
                  WHERE status='PAGO' ${filtroPagamentos}
                    AND ${pedidoValidoSql("pedido_pagamentos.pedido_id")}), 0)
        - COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos
                    WHERE status='REEMBOLSADO' ${filtroReembolsos}
                      AND ${pedidoValidoSql("pedido_reembolsos.pedido_id")}), 0)
      ) AS faturamento_liquido_centavos,
      COALESCE((SELECT SUM(di.valor_total_centavos)
                FROM despesa_itens di
                JOIN despesas d ON d.id = di.despesa_id
                WHERE d.status = 'ATIVA' ${filtroDespesas}), 0) AS despesas_centavos
    `)
    .bind(...(params ? [params.desde, params.ate, params.desde, params.ate, params.desde, params.ate] : []))
    .first<ResultadoRow>();

  const faturamentoLiquidoCentavos = Number(row?.faturamento_liquido_centavos ?? 0);
  const despesasCentavos = Number(row?.despesas_centavos ?? 0);
  // Lucro/margem NUNCA são clampados em zero: prejuízo é um resultado
  // válido e precisa aparecer negativo, não escondido atrás de "R$ 0".
  const lucroEstimadoCentavos = faturamentoLiquidoCentavos - despesasCentavos;
  const margemEstimada = faturamentoLiquidoCentavos === 0
    ? null
    : (lucroEstimadoCentavos / faturamentoLiquidoCentavos) * 100;

  return { faturamentoLiquidoCentavos, despesasCentavos, lucroEstimadoCentavos, margemEstimada };
}
