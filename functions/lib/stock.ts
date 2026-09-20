/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql } from "./pedidoValido";

import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";

// Estado fisico autoritativo por item. Os marcadores de `pedidos` continuam
// existindo somente como projecao de compatibilidade para leitores antigos.
export type EstoqueEstado =
  | "NAO_APLICAVEL"
  | "SEM_RESERVA"
  | "RESERVADO"
  | "LIBERADO"
  | "BAIXADO"
  | "REPOSTO";

export type BaixaResultado =
  | { ok: true; baixado: boolean }
  | {
      ok: false;
      baixado: false;
      erro: "ITENS_NAO_ENCONTRADOS" | "ESTOQUE_INSUFICIENTE";
    };

export type LiberacaoResultado =
  | { ok: true; liberado: boolean }
  | { ok: false; liberado: false; erro: "ERRO_TRANSACIONAL_LIBERACAO" };

interface ItemPedidoRow {
  id: number;
  produto_id: number;
  quantidade: number;
}

const ESTADOS_BAIXAVEIS_SQL = "('RESERVADO', 'SEM_RESERVA', 'LIBERADO')";

// Mantem os campos globais como uma projecao derivada. A prioridade e:
// alguma reserva viva -> ATIVA; alguma reserva ja liberada/reposta ->
// LIBERADA; algum item ainda sem reserva -> SEM_RESERVA; todos os itens
// controlados baixados -> CONVERTIDA. Estado misto nao exige um novo enum.
export function preparePedidoPhysicalProjection(
  db: D1Database,
  pedidoId: number,
  operationKey?: string,
): D1PreparedStatement {
  const ativoControlado = `pi.pedido_id = pedidos.id
    AND pi.status_item IN ('ATIVO', 'TROCA_PENDENTE') AND pi.produto_id IS NOT NULL`;
  const operationGuard = operationKey
    ? `AND EXISTS (SELECT 1 FROM pedido_operacoes o
                   WHERE o.operation_key = ? AND o.pedido_id = pedidos.id
                     AND o.pedido_item_id IS NOT NULL)`
    : "";
  return db.prepare(`
    UPDATE pedidos
    SET reserva_status = CASE
          WHEN EXISTS (SELECT 1 FROM pedido_itens pi
                       WHERE ${ativoControlado} AND pi.estoque_estado = 'RESERVADO')
            THEN 'ATIVA'
          WHEN EXISTS (SELECT 1 FROM pedido_itens pi
                       WHERE ${ativoControlado} AND pi.estoque_estado IN ('LIBERADO', 'REPOSTO'))
            THEN 'LIBERADA'
          WHEN EXISTS (SELECT 1 FROM pedido_itens pi
                       WHERE ${ativoControlado} AND pi.estoque_estado = 'SEM_RESERVA')
            THEN 'SEM_RESERVA'
          WHEN EXISTS (SELECT 1 FROM pedido_itens pi WHERE ${ativoControlado})
            THEN 'CONVERTIDA'
          WHEN status_pagamento = 'PAGO'
            THEN 'CONVERTIDA'
          ELSE 'SEM_RESERVA'
        END,
        estoque_baixado_em = CASE
          WHEN EXISTS (SELECT 1 FROM pedido_itens pi
                       WHERE ${ativoControlado} AND pi.estoque_estado <> 'BAIXADO')
            THEN NULL
          WHEN status_pagamento = 'PAGO'
            THEN COALESCE(estoque_baixado_em, CURRENT_TIMESTAMP)
          ELSE estoque_baixado_em
        END,
        reserva_liberada_em = CASE
          WHEN NOT EXISTS (SELECT 1 FROM pedido_itens pi
                           WHERE ${ativoControlado} AND pi.estoque_estado = 'RESERVADO')
           AND EXISTS (SELECT 1 FROM pedido_itens pi
                       WHERE ${ativoControlado} AND pi.estoque_estado = 'LIBERADO')
            THEN COALESCE(reserva_liberada_em, CURRENT_TIMESTAMP)
          ELSE reserva_liberada_em
        END,
        atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
      ${operationGuard}
  `).bind(pedidoId, ...(operationKey ? [operationKey] : []));
}

// Converte somente itens ATIVOS que ainda precisam de baixa. A decisao sobre
// quanto remover de estoque_reservado le `pedido_itens.estoque_estado` dentro
// da propria transacao: se uma liberacao vencer a corrida, LIBERADO ->
// BAIXADO desconta apenas estoque; se a baixa vencer, a liberacao vira no-op.
export async function baixarEstoquePedido(db: D1Database, pedidoId: number): Promise<BaixaResultado> {
  const pedido = await db
    .prepare(`SELECT status_pagamento, reserva_status, estoque_baixado_em
              FROM pedidos WHERE ${pedidoValidoSql('pedidos.id')} AND id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ status_pagamento: string; reserva_status: string; estoque_baixado_em: string | null }>();

  if (!pedido || pedido.status_pagamento !== "PAGO") {
    return { ok: true, baixado: false };
  }

  const totalItens = await db
    .prepare(`SELECT COUNT(*) AS total FROM pedido_itens WHERE pedido_id = ?`)
    .bind(pedidoId)
    .first<{ total: number }>();
  if (Number(totalItens?.total || 0) === 0) {
    return { ok: false, baixado: false, erro: "ITENS_NAO_ENCONTRADOS" };
  }

  const { results } = await db
    .prepare(
      `SELECT id, produto_id, quantidade
       FROM pedido_itens
       WHERE pedido_id = ? AND ${pedidoValidoSql('pedido_itens.pedido_id')}
         AND status_item = 'ATIVO'
         AND produto_id IS NOT NULL
         AND estoque_estado IN ${ESTADOS_BAIXAVEIS_SQL}
       ORDER BY id`,
    )
    .bind(pedidoId)
    .all<ItemPedidoRow>();

  const itens = results || [];
  if (!itens.length) {
    if (pedido.reserva_status === "CONVERTIDA" && pedido.estoque_baixado_em) {
      return { ok: true, baixado: false };
    }
    // Mesmo sem efeito fisico restante, corrige marcadores globais antigos
    // a partir da autoridade por item. Isso torna um retry capaz de reparar
    // uma projecao interrompida depois da ultima baixa.
    await db.batch([
      preparePedidoFinancialProjection(db, pedidoId),
      preparePedidoPhysicalProjection(db, pedidoId),
    ]);
    return { ok: true, baixado: false };
  }

  // Reavalia o liquido no mesmo batch da baixa. Um refund concorrente que
  // vencer primeiro muda a projecao e faz todos os guards fisicos virarem
  // no-op antes de qualquer unidade ser consumida.
  const statements: D1PreparedStatement[] = [preparePedidoFinancialProjection(db, pedidoId)];
  const itemResultIndexes: number[] = [];

  for (const item of itens) {
    statements.push(
      db.prepare(`
        UPDATE produtos
        SET estoque = estoque - ?,
            estoque_reservado = estoque_reservado - CASE
              WHEN (SELECT pi.estoque_estado FROM pedido_itens pi
                    WHERE pi.id = ? AND pi.pedido_id = ?
                      AND pi.status_item = 'ATIVO') = 'RESERVADO'
                THEN ? ELSE 0
            END,
            disponivel = CASE
              WHEN ativo = 1
               AND (estoque - ?) - (estoque_reservado - CASE
                 WHEN (SELECT pi.estoque_estado FROM pedido_itens pi
                       WHERE pi.id = ? AND pi.pedido_id = ?
                         AND pi.status_item = 'ATIVO') = 'RESERVADO'
                   THEN ? ELSE 0
               END) > 0
                THEN disponivel
              ELSE 0
            END,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM pedido_itens pi
            JOIN pedidos p ON p.id = pi.pedido_id
            WHERE pi.id = ? AND pi.pedido_id = ?
              AND pi.produto_id = produtos.id
              AND pi.quantidade = ?
              AND pi.status_item = 'ATIVO'
              AND pi.estoque_estado IN ${ESTADOS_BAIXAVEIS_SQL}
              AND p.status_pagamento = 'PAGO' AND ${pedidoValidoSql('p.id')}
          )
      `).bind(
        item.quantidade,
        item.id,
        pedidoId,
        item.quantidade,
        item.quantidade,
        item.id,
        pedidoId,
        item.quantidade,
        item.produto_id,
        item.id,
        pedidoId,
        item.quantidade,
      ),
    );

    statements.push(
      db.prepare(`
        UPDATE pedido_itens
        SET estoque_estado = 'BAIXADO',
            estoque_baixado_em = COALESCE(estoque_baixado_em, CURRENT_TIMESTAMP)
        WHERE id = ? AND pedido_id = ? AND produto_id = ? AND quantidade = ?
          AND status_item = 'ATIVO'
          AND estoque_estado IN ${ESTADOS_BAIXAVEIS_SQL}
          AND EXISTS (SELECT 1 FROM pedidos p
                      WHERE p.id = pedido_itens.pedido_id AND p.status_pagamento = 'PAGO' AND ${pedidoValidoSql('p.id')})
          AND EXISTS (SELECT 1 FROM produtos pr WHERE pr.id = pedido_itens.produto_id)
      `).bind(item.id, pedidoId, item.produto_id, item.quantidade),
    );
    itemResultIndexes.push(statements.length - 1);
  }

  statements.push(preparePedidoPhysicalProjection(db, pedidoId));

  try {
    const resultados = await db.batch(statements);
    const baixado = itemResultIndexes.some((index) => Number(resultados[index]?.meta?.changes || 0) === 1);
    return { ok: true, baixado };
  } catch (err) {
    console.error("Falha ao converter reserva em baixa de estoque", pedidoId, err);
    if (String((err as Error)?.message || "").includes("CHECK constraint failed: estoque")) {
      return { ok: false, baixado: false, erro: "ESTOQUE_INSUFICIENTE" };
    }
    throw err;
  }
}

// Cobranca Pix viva pertence ao pedido, independentemente de id remoto,
// deadline local ou cadeia de substituicao.
export const PIX_MP_PENDENTE_NO_PEDIDO_SQL = `EXISTS (SELECT 1 FROM pedido_pagamentos pp
                  WHERE pp.pedido_id = pedidos.id AND pp.metodo = 'PIX_MP' AND pp.status = 'PENDENTE')`;

const RESERVA_LIBERAVEL_SQL = `${pedidoValidoSql('pedidos.id')} AND status_pagamento = 'PENDENTE'
  AND NOT ${PIX_MP_PENDENTE_NO_PEDIDO_SQL}`;

// Libera somente itens que ainda estao RESERVADOS. As guards B4 continuam
// dentro da mesma transacao: liquido zero projetado e nenhum PIX_MP pendente.
export async function liberarReservaPedido(db: D1Database, pedidoId: number): Promise<LiberacaoResultado> {
  const { results } = await db
    .prepare(
      `SELECT id, produto_id, quantidade
       FROM pedido_itens
       WHERE pedido_id = ? AND ${pedidoValidoSql('pedido_itens.pedido_id')}
         AND status_item = 'ATIVO'
         AND produto_id IS NOT NULL
         AND estoque_estado = 'RESERVADO'
       ORDER BY id`,
    )
    .bind(pedidoId)
    .all<ItemPedidoRow>();

  const itens = results || [];
  if (!itens.length) return { ok: true, liberado: false };

  const statements: D1PreparedStatement[] = [preparePedidoFinancialProjection(db, pedidoId)];
  const itemResultIndexes: number[] = [];

  for (const item of itens) {
    statements.push(
      db.prepare(`
        UPDATE produtos
        SET estoque_reservado = estoque_reservado - ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM pedido_itens pi
            JOIN pedidos ON pedidos.id = pi.pedido_id
            WHERE pi.id = ? AND pi.pedido_id = ?
              AND pi.produto_id = produtos.id
              AND pi.quantidade = ?
              AND pi.status_item = 'ATIVO'
              AND pi.estoque_estado = 'RESERVADO'
              AND ${RESERVA_LIBERAVEL_SQL}
          )
      `).bind(item.quantidade, item.produto_id, item.id, pedidoId, item.quantidade),
    );

    statements.push(
      db.prepare(`
        UPDATE pedido_itens
        SET estoque_estado = 'LIBERADO',
            estoque_liberado_em = COALESCE(estoque_liberado_em, CURRENT_TIMESTAMP)
        WHERE id = ? AND pedido_id = ? AND produto_id = ? AND quantidade = ?
          AND status_item = 'ATIVO'
          AND estoque_estado = 'RESERVADO'
          AND EXISTS (
            SELECT 1 FROM pedidos
            WHERE pedidos.id = pedido_itens.pedido_id
              AND ${RESERVA_LIBERAVEL_SQL}
          )
          AND EXISTS (SELECT 1 FROM produtos pr WHERE pr.id = pedido_itens.produto_id)
      `).bind(item.id, pedidoId, item.produto_id, item.quantidade),
    );
    itemResultIndexes.push(statements.length - 1);
  }

  statements.push(preparePedidoPhysicalProjection(db, pedidoId));

  try {
    const resultados = await db.batch(statements);
    const liberado = itemResultIndexes.some((index) => Number(resultados[index]?.meta?.changes || 0) === 1);
    return { ok: true, liberado };
  } catch (err) {
    console.error("Falha ao liberar reserva de estoque", pedidoId, err);
    return { ok: false, liberado: false, erro: "ERRO_TRANSACIONAL_LIBERACAO" };
  }
}
