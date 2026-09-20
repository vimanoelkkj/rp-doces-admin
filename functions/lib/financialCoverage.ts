export const EXCHANGE_COVERAGE_STATUSES = "'CONCLUIDA','AGUARDANDO_COBRANCA'";

export const REFUND_ALLOCATIONS_UNION_SQL = `(SELECT reembolso_id,pagamento_alocacao_id,valor_centavos
  FROM pedido_reembolso_alocacoes
  UNION ALL
  SELECT reembolso_id,pagamento_alocacao_id,valor_centavos
  FROM pedido_item_troca_reembolso_alocacoes)`;

export const CONFIRMED_REFUNDS_BY_ALLOCATION_CTE = `refunds_confirmados AS (
  SELECT x.pagamento_alocacao_id,SUM(x.valor_centavos) AS valor_centavos
  FROM ${REFUND_ALLOCATIONS_UNION_SQL} x
  JOIN pedido_reembolsos r ON r.id=x.reembolso_id
  WHERE r.status='REEMBOLSADO'
  GROUP BY x.pagamento_alocacao_id
)`;

export function financialLineageCte(seedSql: string, name = "linhagem_financeira"): string {
  return `${name}(item_id) AS (
    SELECT ${seedSql}
    UNION
    SELECT t.item_origem_id
    FROM pedido_item_trocas t
    JOIN ${name} l ON l.item_id=t.item_destino_id
    WHERE t.status IN (${EXCHANGE_COVERAGE_STATUSES})
  )`;
}

export function financialLineageMembership(
  allocationItemSql: string,
  seedSql: string,
  name = "linhagem_financeira",
): string {
  return `${allocationItemSql} IN (
    WITH RECURSIVE ${financialLineageCte(seedSql, name)}
    SELECT item_id FROM ${name}
  )`;
}

export function liveAdminPixPredicate(alias: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pedido_pagamentos sucessor
    WHERE sucessor.substitui_pagamento_id=${alias}.id
      AND sucessor.status IN ('PENDENTE','PAGO')
  )`;
}

// O primeiro placeholder, quando presente, e o Pix que esta sendo substituido.
// O segundo e sempre o pedido. A mesma expressao e usada na leitura e no CAS.
export function chargeableCapacitySql(excludedPaymentSql = "NULL"): string {
  return `(SELECT MAX(0,
      p.valor_total_centavos
      - (COALESCE((SELECT SUM(pg.valor_centavos) FROM pedido_pagamentos pg
                   WHERE pg.pedido_id=p.id AND pg.status='PAGO'),0)
         - COALESCE((SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
                     WHERE r.pedido_id=p.id AND r.status='REEMBOLSADO'),0))
      - COALESCE((SELECT SUM(px.valor_centavos) FROM pedido_pagamentos px
                  WHERE px.pedido_id=p.id AND px.metodo='PIX_MP' AND px.origem='ADMIN'
                    AND px.status='PENDENTE'
                    AND px.id<>COALESCE(${excludedPaymentSql},-1)
                    AND ${liveAdminPixPredicate("px")}),0)
    ) FROM pedidos p WHERE p.id=?)`;
}

export async function financialChargeSlotKey(
  db: D1Database,
  pedidoId: number,
  kind: "pix" | "manual",
): Promise<string> {
  const revision = await db.prepare(`SELECT
      COALESCE((SELECT MAX(id) FROM pedido_pagamentos WHERE pedido_id=?),0) AS pagamento_id,
      COALESCE((SELECT MAX(id) FROM pedido_reembolsos WHERE pedido_id=?),0) AS reembolso_id`)
    .bind(pedidoId, pedidoId).first<{ pagamento_id: number; reembolso_id: number }>();
  return `charge-slot:${kind}:${pedidoId}:${Number(revision?.pagamento_id || 0)}:${Number(revision?.reembolso_id || 0)}`;
}
