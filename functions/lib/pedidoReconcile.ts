/// <reference types="@cloudflare/workers-types" />

import { recalculatePedidoStatusPagamento, type StatusFinanceiroAgregado } from "./comandaLedger";
import { baixarEstoquePedido, type BaixaResultado } from "./stock";
import { STATUS_FINANCEIRO_SQL } from "./pedidoFinanceiroSql";

export type PedidoReconcileResult =
  | { ok: false; motivo: "PEDIDO_NAO_ENCONTRADO" | "LEGADO_SEM_LEDGER" }
  | { ok: true; statusFinanceiro: StatusFinanceiroAgregado; estoque: BaixaResultado };

// Convergência por pedido: não cria fatos financeiros, não materializa legado,
// não libera reservas nem altera status operacional. Pode repetir sem evento MP.
export async function reconcilePedidoAfterFinancialChange(
  db: D1Database,
  pedidoId: number,
): Promise<PedidoReconcileResult> {
  const agregado = await recalculatePedidoStatusPagamento(db, pedidoId);
  if (agregado === null) {
    const pedido = await db.prepare(`SELECT id FROM pedidos WHERE id = ?`).bind(pedidoId).first();
    return { ok: false, motivo: pedido ? "LEGADO_SEM_LEDGER" : "PEDIDO_NAO_ENCONTRADO" };
  }

  const estoque: BaixaResultado = agregado === "PAGO"
    ? await baixarEstoquePedido(db, pedidoId)
    : { ok: true, baixado: false };
  if (!estoque.ok) console.error("Reconciliação financeira com pendência de estoque", pedidoId, estoque.erro);

  // A baixa revalida no batch: um refund concorrente pode mudar a projeção.
  const atual = await db.prepare(`SELECT status_pagamento FROM pedidos WHERE id = ?`)
    .bind(pedidoId).first<{ status_pagamento: StatusFinanceiroAgregado }>();
  return { ok: true, statusFinanceiro: atual?.status_pagamento ?? agregado, estoque };
}

const RECONCILE_PEDIDOS_BATCH_SIZE = 4;

// Sem dependência de mp_payment_id, método/origem ou tentativa PENDENTE.
// Prioridade financeira impede que faltas de estoque escondam divergências.
export async function reconcilePedidosDivergentes(db: D1Database): Promise<void> {
  const { results } = await db.prepare(`
    SELECT id FROM (
      SELECT p.id, p.status_pagamento, p.estoque_baixado_em, p.atualizado_em,
             ${STATUS_FINANCEIRO_SQL} AS esperado
      FROM pedidos p
      WHERE EXISTS (SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id = p.id)
    )
    WHERE status_pagamento IS NOT esperado
       OR (esperado = 'PAGO' AND estoque_baixado_em IS NULL)
    ORDER BY (status_pagamento IS NOT esperado) DESC, atualizado_em ASC, id ASC
    LIMIT ?
  `).bind(RECONCILE_PEDIDOS_BATCH_SIZE).all<{ id: number }>();

  await Promise.all(results.map(async ({ id }) => {
    try {
      await reconcilePedidoAfterFinancialChange(db, id);
    } catch (err) {
      console.error("Falha ao reconciliar pedido com ledger", id, err);
    }
  }));
}
