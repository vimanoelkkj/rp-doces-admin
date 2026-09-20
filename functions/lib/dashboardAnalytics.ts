/// <reference types="@cloudflare/workers-types" />

import {
  CONFIRMED_REFUNDS_BY_ALLOCATION_CTE,
  EXCHANGE_COVERAGE_STATUSES,
  REFUND_ALLOCATIONS_UNION_SQL,
} from "./financialCoverage";

export interface StoreFinancialSummary {
  brutoCentavos: number;
  reembolsadoCentavos: number;
  liquidoCentavos: number;
}

export interface BestSeller {
  produtoId: number | null;
  nome: string;
  quantidade: number;
}

interface FinancialRow {
  bruto_centavos: number;
  reembolsado_centavos: number;
  liquido_centavos: number;
}

interface BestSellerRow {
  produto_id: number | null;
  nome: string;
  quantidade: number;
}

const STORE_FINANCIAL_SQL = `SELECT
  COALESCE((SELECT SUM(valor_centavos)
            FROM pedido_pagamentos
            WHERE status='PAGO'),0) AS bruto_centavos,
  COALESCE((SELECT SUM(valor_centavos)
            FROM pedido_reembolsos
            WHERE status='REEMBOLSADO'),0) AS reembolsado_centavos,
  MAX(0,
    COALESCE((SELECT SUM(valor_centavos)
              FROM pedido_pagamentos
              WHERE status='PAGO'),0)
    - COALESCE((SELECT SUM(valor_centavos)
                FROM pedido_reembolsos
                WHERE status='REEMBOLSADO'),0)
  ) AS liquido_centavos`;

// Cada item ATIVO e uma venda candidata. A recursao leva junto a identidade
// dessa linha e encontra as alocacoes confirmadas dela e de todas as origens
// efetivas de troca. Refunds confirmados reduzem a propria alocacao; refunds
// sem provenance completa tornam a cobertura do pedido indeterminada e, por
// seguranca, suas linhas nao entram no ranking.
const BEST_SELLERS_SQL = `WITH RECURSIVE
  itens_ativos AS (
    SELECT pi.id,pi.pedido_id,pi.produto_id,pi.produto_nome,pi.quantidade,
      pi.valor_total_centavos,
      CASE WHEN pi.produto_id IS NOT NULL THEN 'produto:' || pi.produto_id
           ELSE 'historico:' || lower(trim(pi.produto_nome)) END AS identidade
    FROM pedido_itens pi
    WHERE pi.status_item='ATIVO' AND pi.valor_total_centavos>0
  ),
  linhagem_financeira(item_vendido_id,item_id) AS (
    SELECT id,id FROM itens_ativos
    UNION
    SELECT l.item_vendido_id,t.item_origem_id
    FROM pedido_item_trocas t
    JOIN linhagem_financeira l ON l.item_id=t.item_destino_id
    WHERE t.status IN (${EXCHANGE_COVERAGE_STATUSES})
  ),
  ${CONFIRMED_REFUNDS_BY_ALLOCATION_CTE},
  refunds_incompletos AS (
    SELECT r.pedido_id
    FROM pedido_reembolsos r
    LEFT JOIN ${REFUND_ALLOCATIONS_UNION_SQL} x ON x.reembolso_id=r.id
    WHERE r.status='REEMBOLSADO'
    GROUP BY r.id,r.pedido_id,r.valor_centavos
    HAVING COALESCE(SUM(x.valor_centavos),0)<>r.valor_centavos
  ),
  cobertura AS (
    SELECT l.item_vendido_id,
      COALESCE(SUM(CASE WHEN pp.status='PAGO'
        THEN MAX(0,a.valor_centavos-COALESCE(rf.valor_centavos,0))
        ELSE 0 END),0) AS valor_centavos
    FROM linhagem_financeira l
    JOIN itens_ativos i ON i.id=l.item_vendido_id
    LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id=l.item_id
    LEFT JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id AND pp.pedido_id=i.pedido_id
    LEFT JOIN refunds_confirmados rf ON rf.pagamento_alocacao_id=a.id
    GROUP BY l.item_vendido_id
  ),
  vendidos AS (
    SELECT i.id,i.produto_id,i.produto_nome,i.quantidade,i.identidade
    FROM itens_ativos i
    JOIN cobertura c ON c.item_vendido_id=i.id
    WHERE c.valor_centavos>=i.valor_total_centavos
      AND NOT EXISTS(SELECT 1 FROM refunds_incompletos r WHERE r.pedido_id=i.pedido_id)
  ),
  totais AS (
    SELECT identidade,MAX(produto_id) AS produto_id,SUM(quantidade) AS quantidade
    FROM vendidos
    GROUP BY identidade
  ),
  nomes AS (
    SELECT identidade,produto_nome,
      ROW_NUMBER() OVER(PARTITION BY identidade ORDER BY id DESC) AS ordem
    FROM vendidos
  )
SELECT t.produto_id,n.produto_nome AS nome,t.quantidade
FROM totais t
JOIN nomes n ON n.identidade=t.identidade AND n.ordem=1
ORDER BY t.quantidade DESC,n.produto_nome COLLATE NOCASE ASC,t.identidade ASC
LIMIT 5`;

export async function getStoreAnalytics(db: D1Database): Promise<{
  financeiro: StoreFinancialSummary;
  maisVendidos: BestSeller[];
}> {
  const [financial, bestSellers] = await Promise.all([
    db.prepare(STORE_FINANCIAL_SQL).first<FinancialRow>(),
    db.prepare(BEST_SELLERS_SQL).all<BestSellerRow>(),
  ]);

  return {
    financeiro: {
      brutoCentavos: Number(financial?.bruto_centavos ?? 0),
      reembolsadoCentavos: Number(financial?.reembolsado_centavos ?? 0),
      liquidoCentavos: Number(financial?.liquido_centavos ?? 0),
    },
    maisVendidos: bestSellers.results.map((row) => ({
      produtoId: row.produto_id === null ? null : Number(row.produto_id),
      nome: row.nome,
      quantidade: Number(row.quantidade),
    })),
  };
}
