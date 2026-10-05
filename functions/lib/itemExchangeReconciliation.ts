/// <reference types="@cloudflare/workers-types" />

import { getFinanceiroPedido } from "./comandaLedger";
import type { ExchangeRow } from "./itemExchangeTypes";
import { exchangeById, exchangeView } from "./itemExchangeView";
import { getPedidoAnulacao } from "./pedidoValido";
import { preparePedidoPhysicalProjection } from "./stock";

export interface ExchangeReconciliationBuilders {
  completeExchangeStatements(db: D1Database, row: ExchangeRow): D1PreparedStatement[];
  destinationPhysicalStatements(
    db: D1Database,
    selector: { exchangeId: number }
  ): D1PreparedStatement[];
  completedExchangeInvariant(db: D1Database, row: ExchangeRow): D1PreparedStatement;
}

// Builders stay with the mutating coordinator. Injection avoids a circular import.
export function createExchangeReconciliation({
  completeExchangeStatements,
  destinationPhysicalStatements,
  completedExchangeInvariant
}: ExchangeReconciliationBuilders) {
  async function tryFinalizeExchange(db: D1Database, row: ExchangeRow): Promise<void> {
    const view = await exchangeView(db, row);
    if (view.reembolsoPendenteCentavos > 0) return;
    await db.batch(completeExchangeStatements(db, row));
  }

  async function reconcileExchangeFinalization(db: D1Database, exchangeId: number): Promise<void> {
    const row = await exchangeById(db, exchangeId);
    if (row) await tryFinalizeExchange(db, row);
  }

  async function reconcileExchangeFinalizationsForPedido(
    db: D1Database,
    pedidoId: number,
    limit = 8
  ): Promise<void> {
    const { results } = await db
      .prepare(
        `SELECT id FROM pedido_item_trocas
    WHERE pedido_id=? AND status IN ('SOLICITADA','AGUARDANDO_REEMBOLSO','INCONCLUSIVA')
    ORDER BY id LIMIT ?`
      )
      .bind(pedidoId, Math.max(1, Math.min(limit, 20)))
      .all<{ id: number }>();
    for (const row of results) await reconcileExchangeFinalization(db, Number(row.id));
  }

  async function reconcileExchangeCharges(db: D1Database, pedidoId: number): Promise<void> {
    if (await getPedidoAnulacao(db, pedidoId)) return;
    const financeiro = await getFinanceiroPedido(db, pedidoId);
    const { results } = await db
      .prepare(
        `SELECT id,pedido_id,item_origem_id,item_destino_id,status,estoque_acao_origem,snapshot_financeiro
    FROM pedido_item_trocas t WHERE pedido_id=?
      AND (status='CONCLUIDA' OR (status='AGUARDANDO_COBRANCA' AND ?<=0))
      AND EXISTS(SELECT 1 FROM pedido_itens pi WHERE pi.id=t.item_destino_id
        AND pi.status_item='ATIVO' AND pi.estoque_estado='RESERVADO')
    ORDER BY id`
      )
      .bind(pedidoId, financeiro.saldoCentavos)
      .all<ExchangeRow>();
    for (const row of results) {
      const statements = destinationPhysicalStatements(db, { exchangeId: Number(row.id) });
      statements.push(preparePedidoPhysicalProjection(db, pedidoId));
      statements.push(
        db
          .prepare(
            `UPDATE pedido_item_trocas
      SET status='CONCLUIDA',concluido_em=COALESCE(concluido_em,CURRENT_TIMESTAMP)
      WHERE id=? AND status IN ('AGUARDANDO_COBRANCA','CONCLUIDA')
        AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_destino_id
          AND status_item='ATIVO' AND estoque_estado='BAIXADO')`
          )
          .bind(row.id)
      );
      statements.push(completedExchangeInvariant(db, row));
      await db.batch(statements);
    }
    if (financeiro.saldoCentavos <= 0)
      await db
        .prepare(
          `UPDATE pedido_item_trocas
    SET status='CONCLUIDA',concluido_em=COALESCE(concluido_em,CURRENT_TIMESTAMP)
    WHERE pedido_id=? AND status='AGUARDANDO_COBRANCA'
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_destino_id
        AND status_item='ATIVO' AND estoque_estado='BAIXADO')`
        )
        .bind(pedidoId)
        .run();
  }

  return {
    tryFinalizeExchange,
    reconcileExchangeFinalization,
    reconcileExchangeFinalizationsForPedido,
    reconcileExchangeCharges
  };
}
