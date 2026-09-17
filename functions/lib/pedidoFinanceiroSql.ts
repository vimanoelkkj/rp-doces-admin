/// <reference types="@cloudflare/workers-types" />

// Compartilhada por projeção, seleção de divergências e revalidação física.
// Subqueries independentes evitam multiplicar pagamentos por refunds/alocações.
// O alias p sempre representa pedidos.
const LIQUIDO_SQL = `MAX(0,
  COALESCE((SELECT SUM(pp.valor_centavos) FROM pedido_pagamentos pp
            WHERE pp.pedido_id = p.id AND pp.status = 'PAGO'), 0)
  - COALESCE((SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
              WHERE r.pedido_id = p.id AND r.status = 'REEMBOLSADO'), 0)
)`;

export const STATUS_FINANCEIRO_SQL = `CASE
  WHEN ${LIQUIDO_SQL} <= 0 THEN 'PENDENTE'
  WHEN ${LIQUIDO_SQL} < p.valor_total_centavos THEN 'PARCIAL'
  ELSE 'PAGO'
END`;

export function preparePedidoFinancialProjection(db: D1Database, pedidoId: number): D1PreparedStatement {
  return db.prepare(`
    UPDATE pedidos AS p
    SET status_pagamento = ${STATUS_FINANCEIRO_SQL},
        atualizado_em = CASE WHEN p.status_pagamento IS NOT (${STATUS_FINANCEIRO_SQL})
                             THEN CURRENT_TIMESTAMP ELSE p.atualizado_em END
    WHERE p.id = ?
      AND EXISTS (SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id = p.id)
    RETURNING status_pagamento
  `).bind(pedidoId);
}
