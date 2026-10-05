/// <reference types="@cloudflare/workers-types" />

import type { ExchangeRow, ExchangeStockAction, ItemExchangePreview } from "./itemExchangeTypes";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";

export function originPhysicalStatements(
  db: D1Database,
  itemId: number,
  action: ExchangeStockAction,
  extraGuard = ""
): D1PreparedStatement[] {
  if (action === "LIBERAR_RESERVA")
    return [
      db
        .prepare(
          `UPDATE produtos SET estoque_reservado=estoque_reservado-(SELECT quantidade FROM pedido_itens WHERE id=?),atualizado_em=CURRENT_TIMESTAMP
    WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?)
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='ATIVO' AND estoque_estado='RESERVADO') ${extraGuard}`
        )
        .bind(itemId, itemId, itemId)
    ];
  if (action === "REPOR")
    return [
      db
        .prepare(
          `UPDATE produtos SET estoque=estoque+(SELECT quantidade FROM pedido_itens WHERE id=?),disponivel=CASE WHEN ativo=1 THEN 1 ELSE disponivel END,atualizado_em=CURRENT_TIMESTAMP
    WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?)
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='ATIVO' AND estoque_estado='BAIXADO') ${extraGuard}`
        )
        .bind(itemId, itemId, itemId)
    ];
  return [];
}

export function destinationPhysicalStatements(
  db: D1Database,
  selector: { exchangeId: number } | { operationKey: string },
  extraGuard = ""
): D1PreparedStatement[] {
  const byOperation = "operationKey" in selector;
  const exchangePredicate = byOperation
    ? `t.id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)`
    : `t.id=?`;
  const value = byOperation ? selector.operationKey : selector.exchangeId;
  return [
    db
      .prepare(
        `WITH destino AS (
      SELECT pi.produto_id,pi.quantidade FROM pedido_item_trocas t
      JOIN pedido_itens pi ON pi.id=t.item_destino_id
      WHERE ${exchangePredicate} AND pi.status_item IN ('TROCA_PENDENTE','ATIVO')
        AND pi.estoque_estado='RESERVADO' ${extraGuard}
    )
    UPDATE produtos SET estoque=estoque-(SELECT quantidade FROM destino),
      estoque_reservado=estoque_reservado-(SELECT quantidade FROM destino),
      disponivel=CASE WHEN ativo=1
        AND (estoque-(SELECT quantidade FROM destino))-(estoque_reservado-(SELECT quantidade FROM destino))>0
        THEN disponivel ELSE 0 END,
      atualizado_em=CURRENT_TIMESTAMP
    WHERE id=(SELECT produto_id FROM destino)
      AND estoque>=(SELECT quantidade FROM destino)
      AND estoque_reservado>=(SELECT quantidade FROM destino)`
      )
      .bind(value),
    db
      .prepare(
        `UPDATE pedido_itens SET status_item='ATIVO',pedido_item_troca_id=NULL,
      estoque_estado='BAIXADO',estoque_baixado_em=COALESCE(estoque_baixado_em,CURRENT_TIMESTAMP)
    WHERE id=(SELECT t.item_destino_id FROM pedido_item_trocas t WHERE ${exchangePredicate})
      AND status_item IN ('TROCA_PENDENTE','ATIVO') AND estoque_estado='RESERVADO' ${extraGuard}`
      )
      .bind(value)
  ];
}

export function completedExchangeInvariant(db: D1Database, row: ExchangeRow): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE pedidos SET valor_total_centavos=-1 WHERE id=?
    AND EXISTS(SELECT 1 FROM pedido_item_trocas WHERE id=? AND status='CONCLUIDA')
    AND NOT EXISTS(
      SELECT 1 FROM pedido_item_trocas t
      JOIN pedido_itens destino ON destino.id=t.item_destino_id
      WHERE t.id=? AND destino.status_item='ATIVO' AND destino.estoque_estado='BAIXADO'
        AND NOT EXISTS(
          SELECT 1 FROM produtos pr WHERE pr.id=destino.produto_id
            AND pr.estoque_reservado<>(SELECT COALESCE(SUM(pi.quantidade),0) FROM pedido_itens pi
              WHERE pi.produto_id=pr.id AND pi.status_item IN ('ATIVO','TROCA_PENDENTE')
                AND pi.estoque_estado='RESERVADO')
        )
    )`
    )
    .bind(row.pedido_id, row.id, row.id);
}

export function completeExchangeStatements(
  db: D1Database,
  row: ExchangeRow
): D1PreparedStatement[] {
  let projectedTotal = 0;
  try {
    projectedTotal = (JSON.parse(row.snapshot_financeiro) as ItemExchangePreview).financeiro
      .totalProjetadoCentavos;
  } catch {
    projectedTotal = -1;
  }
  const net = `(COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id=${Number(row.pedido_id)} AND status='PAGO'),0)
    -COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=${Number(row.pedido_id)} AND status='REEMBOLSADO'),0))`;
  const safe = `AND ${net}<=${Number(projectedTotal)}`;
  const statements = originPhysicalStatements(
    db,
    row.item_origem_id,
    row.estoque_acao_origem,
    safe
  );
  statements.push(
    db
      .prepare(
        `UPDATE pedido_itens SET status_item='CANCELADO',
      estoque_estado=CASE WHEN ?='LIBERAR_RESERVA' THEN 'LIBERADO' WHEN ?='REPOR' THEN 'REPOSTO' ELSE estoque_estado END,
      estoque_liberado_em=CASE WHEN ?='LIBERAR_RESERVA' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
      estoque_reposto_em=CASE WHEN ?='REPOR' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END
    WHERE id=? AND status_item='ATIVO' ${safe}`
      )
      .bind(
        row.estoque_acao_origem,
        row.estoque_acao_origem,
        row.estoque_acao_origem,
        row.estoque_acao_origem,
        row.item_origem_id
      )
  );
  statements.push(
    db
      .prepare(
        `UPDATE pedido_itens SET status_item='ATIVO',pedido_item_troca_id=NULL
    WHERE id=? AND pedido_item_troca_id=? AND status_item='TROCA_PENDENTE' ${safe}`
      )
      .bind(row.item_destino_id, row.id)
  );
  const financiallyResolved = `${safe} AND ${net}>=(SELECT COALESCE(SUM(valor_total_centavos),0)
    FROM pedido_itens WHERE pedido_id=${Number(row.pedido_id)} AND status_item='ATIVO')`;
  statements.push(
    ...destinationPhysicalStatements(db, { exchangeId: row.id }, financiallyResolved)
  );
  statements.push(
    db
      .prepare(
        `UPDATE pedidos SET valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0)
    FROM pedido_itens WHERE pedido_id=? AND status_item='ATIVO'),atualizado_em=CURRENT_TIMESTAMP WHERE id=?`
      )
      .bind(row.pedido_id, row.pedido_id)
  );
  statements.push(preparePedidoFinancialProjection(db, row.pedido_id));
  statements.push(preparePedidoPhysicalProjection(db, row.pedido_id));
  statements.push(
    db
      .prepare(
        `UPDATE pedido_item_trocas SET status=CASE
      WHEN (SELECT MAX(0,p.valor_total_centavos-COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id=p.id AND status='PAGO'),0)+COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=p.id AND status='REEMBOLSADO'),0)) FROM pedidos p WHERE p.id=pedido_id)>0
      THEN 'AGUARDANDO_COBRANCA' ELSE 'CONCLUIDA' END,
      concluido_em=CASE WHEN (SELECT status_pagamento FROM pedidos WHERE id=pedido_id)='PAGO' THEN COALESCE(concluido_em,CURRENT_TIMESTAMP) ELSE concluido_em END
    WHERE id=? AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_origem_id AND status_item='CANCELADO')
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_destino_id AND status_item='ATIVO'
        AND estoque_estado=CASE WHEN (SELECT MAX(0,p.valor_total_centavos-${net}) FROM pedidos p WHERE p.id=pedido_id)>0
          THEN 'RESERVADO' ELSE 'BAIXADO' END)`
      )
      .bind(row.id)
  );
  statements.push(completedExchangeInvariant(db, row));
  return statements;
}

export function completeInitialExchangeStatements(
  db: D1Database,
  params: {
    pedidoId: number;
    itemId: number;
    operationKey: string;
    action: ExchangeStockAction;
    projectedBalance: number;
  }
): D1PreparedStatement[] {
  const statements = originPhysicalStatements(db, params.itemId, params.action);
  statements.push(
    db
      .prepare(
        `UPDATE pedido_itens SET status_item='CANCELADO',
    estoque_estado=CASE WHEN ?='LIBERAR_RESERVA' THEN 'LIBERADO' WHEN ?='REPOR' THEN 'REPOSTO' ELSE estoque_estado END,
    estoque_liberado_em=CASE WHEN ?='LIBERAR_RESERVA' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
    estoque_reposto_em=CASE WHEN ?='REPOR' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END
    WHERE id=? AND status_item='ATIVO'`
      )
      .bind(params.action, params.action, params.action, params.action, params.itemId)
  );
  if (params.projectedBalance > 0)
    statements.push(
      db
        .prepare(
          `UPDATE pedido_itens SET status_item='ATIVO',pedido_item_troca_id=NULL
    WHERE pedido_item_troca_id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND status_item='TROCA_PENDENTE'`
        )
        .bind(params.operationKey)
    );
  else statements.push(...destinationPhysicalStatements(db, { operationKey: params.operationKey }));
  statements.push(
    db
      .prepare(
        `UPDATE pedidos SET valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0)
    FROM pedido_itens WHERE pedido_id=? AND status_item='ATIVO'),atualizado_em=CURRENT_TIMESTAMP WHERE id=?`
      )
      .bind(params.pedidoId, params.pedidoId)
  );
  statements.push(preparePedidoFinancialProjection(db, params.pedidoId));
  statements.push(preparePedidoPhysicalProjection(db, params.pedidoId));
  statements.push(
    db
      .prepare(
        `UPDATE pedido_item_trocas SET status=?,concluido_em=CASE WHEN ?='CONCLUIDA' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)`
      )
      .bind(
        params.projectedBalance > 0 ? "AGUARDANDO_COBRANCA" : "CONCLUIDA",
        params.projectedBalance > 0 ? "AGUARDANDO_COBRANCA" : "CONCLUIDA",
        params.operationKey
      )
  );
  return statements;
}

export function exchangeInvariant(
  db: D1Database,
  pedidoId: number,
  operationKey: string,
  expected: {
    originStatus: "ATIVO" | "CANCELADO";
    destinationStatus: "TROCA_PENDENTE" | "ATIVO";
    destinationStock: "RESERVADO" | "BAIXADO";
  }
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE pedidos AS p SET valor_total_centavos=-1 WHERE p.id=? AND NOT EXISTS(
    SELECT 1 FROM pedido_operacoes o JOIN pedido_item_trocas t ON t.id=o.pedido_item_troca_id
    JOIN pedido_itens origem ON origem.id=t.item_origem_id
    JOIN pedido_itens destino ON destino.id=t.item_destino_id
    WHERE o.operation_key=? AND t.pedido_id=p.id
      AND origem.status_item=? AND destino.status_item=?
      AND destino.estoque_estado=?
      AND p.valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0) FROM pedido_itens
                                  WHERE pedido_id=p.id AND status_item='ATIVO')
      AND NOT EXISTS(
        SELECT 1 FROM produtos pr WHERE pr.id IN (origem.produto_id,destino.produto_id)
          AND pr.estoque_reservado<>(SELECT COALESCE(SUM(pi.quantidade),0) FROM pedido_itens pi
            WHERE pi.produto_id=pr.id AND pi.status_item IN ('ATIVO','TROCA_PENDENTE') AND pi.estoque_estado='RESERVADO')
      )
  )`
    )
    .bind(
      pedidoId,
      operationKey,
      expected.originStatus,
      expected.destinationStatus,
      expected.destinationStock
    );
}
