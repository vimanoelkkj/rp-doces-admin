/// <reference types="@cloudflare/workers-types" />

import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";

// Passo 7: efeitos físicos de estoque (reserva/baixa/liberação). Este
// módulo revalida a projeção financeira e, na liberação, a ausência de
// Pix pendente na transação física. Não cria fatos financeiros ou alocações.
// Quem decide QUANDO chamar é `pedidoReconcile.ts`
// (baixa, a partir de qualquer mudança financeira) e os pontos de
// transição de pagamento individual / cancelamento (liberação).
//
// A proteção real contra overselling nunca é um `WHERE estoque >= ?`
// checado manualmente — é o CHECK constraint de `produtos`
// (`estoque >= 0`, `estoque_reservado >= 0 AND estoque_reservado <=
// estoque`). Um UPDATE que violaria essas invariantes lança erro, e como
// cada `env.DB.batch()` é uma transação implícita, o batch inteiro
// (inclusive itens de outros produtos já aplicados nesta mesma chamada)
// é revertido — nunca uma baixa parcial "Chocolate desceu, Morango não".

export type BaixaResultado =
  | { ok: true; baixado: boolean }
  | {
      ok: false;
      baixado: false;
      erro: "ITENS_NAO_ENCONTRADOS" | "ESTOQUE_INSUFICIENTE" | "ESTADO_ESTOQUE_INCONSISTENTE";
    };

export type LiberacaoResultado =
  | { ok: true; liberado: boolean }
  | { ok: false; liberado: false; erro: "ERRO_TRANSACIONAL_LIBERACAO" };

interface ItemPedidoRow {
  id: number;
  produto_id: number | null;
  quantidade: number;
}

// Converte a reserva de um pedido PAGO em baixa física definitiva.
//
// Não exige `reserva_status = 'ATIVA'` como pré-condição: uma reserva já
// `LIBERADA` (ex.: o Pix expirou antes de um pagamento manual quitar o
// resto) não impede a conversão — só significa que `estoque_reservado`
// já foi devolvido e não deve ser tocado de novo. A decisão de qual
// ramo aplicar é lida ao vivo, dentro do próprio UPDATE (subquery
// correlacionada), nunca de um valor lido antes e potencialmente
// obsoleto no instante da escrita.
export async function baixarEstoquePedido(db: D1Database, pedidoId: number): Promise<BaixaResultado> {
  const pedido = await db
    .prepare(`SELECT status_pagamento, estoque_baixado_em, reserva_status FROM pedidos WHERE id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ status_pagamento: string; estoque_baixado_em: string | null; reserva_status: string }>();

  if (!pedido || pedido.status_pagamento !== "PAGO" || pedido.estoque_baixado_em) {
    return { ok: true, baixado: false };
  }

  if (pedido.reserva_status === "CONVERTIDA") {
    return { ok: false, baixado: false, erro: "ESTADO_ESTOQUE_INCONSISTENTE" };
  }
  const itemJaBaixado = await db.prepare(
    `SELECT id FROM pedido_itens WHERE pedido_id = ? AND estoque_baixado_em IS NOT NULL LIMIT 1`,
  ).bind(pedidoId).first();
  if (itemJaBaixado) {
    // Outra baixa completa pode ter terminado entre as leituras acima.
    const concluido = await db.prepare(`SELECT estoque_baixado_em FROM pedidos WHERE id = ?`)
      .bind(pedidoId).first<{ estoque_baixado_em: string | null }>();
    return concluido?.estoque_baixado_em
      ? { ok: true, baixado: false }
      : { ok: false, baixado: false, erro: "ESTADO_ESTOQUE_INCONSISTENTE" };
  }

  const { results } = await db
    .prepare(
      `SELECT id, produto_id, quantidade FROM pedido_itens
       WHERE pedido_id = ? AND estoque_baixado_em IS NULL
       ORDER BY id`,
    )
    .bind(pedidoId)
    .all<ItemPedidoRow>();

  const itens = results || [];
  if (!itens.length) {
    const concluido = await db.prepare(`SELECT estoque_baixado_em FROM pedidos WHERE id = ?`)
      .bind(pedidoId).first<{ estoque_baixado_em: string | null }>();
    return concluido?.estoque_baixado_em
      ? { ok: true, baixado: false }
      : { ok: false, baixado: false, erro: "ITENS_NAO_ENCONTRADOS" };
  }

  // Reavalia o líquido na MESMA transação da baixa. Um refund registrado
  // depois da projeção anterior impede a baixa, mesmo antes de ser projetado.
  const statements = [preparePedidoFinancialProjection(db, pedidoId)];

  for (const item of itens) {
    if (!item.produto_id) continue; // item avulso sem produto vinculado: nada físico a baixar

    statements.push(
      db
        .prepare(
          `UPDATE produtos SET
             estoque = estoque - ?,
             estoque_reservado = estoque_reservado - (
               CASE WHEN (SELECT reserva_status FROM pedidos WHERE id = ?) = 'ATIVA' THEN ? ELSE 0 END
             ),
             disponivel = CASE
               WHEN ativo = 1
                 AND (estoque - ?) - (estoque_reservado - (
                   CASE WHEN (SELECT reserva_status FROM pedidos WHERE id = ?) = 'ATIVA' THEN ? ELSE 0 END
                 )) > 0
               THEN disponivel
               ELSE 0
             END,
             atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?
             AND EXISTS (
               SELECT 1 FROM pedidos WHERE id = ? AND status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL
             )
             AND EXISTS (
               SELECT 1 FROM pedido_itens WHERE id = ? AND pedido_id = ? AND estoque_baixado_em IS NULL
             )`,
        )
        .bind(
          item.quantidade,
          pedidoId,
          item.quantidade,
          item.quantidade,
          pedidoId,
          item.quantidade,
          item.produto_id,
          pedidoId,
          item.id,
          pedidoId,
        ),
    );

    statements.push(
      db
        .prepare(
          `UPDATE pedido_itens SET estoque_baixado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND estoque_baixado_em IS NULL
             AND EXISTS (
               SELECT 1 FROM pedidos WHERE id = ? AND status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL
             )`,
        )
        .bind(item.id, pedidoId),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE pedidos SET
           estoque_baixado_em = CURRENT_TIMESTAMP,
           reserva_status = 'CONVERTIDA',
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL`,
      )
      .bind(pedidoId),
  );

  try {
    const resultados = await db.batch(statements);
    const pedidoResultado = resultados[resultados.length - 1];
    const baixado = Number(pedidoResultado?.meta?.changes || 0) === 1;
    return { ok: true, baixado };
  } catch (err) {
    // CHECK (estoque >= 0) ou CHECK (estoque_reservado >= 0 AND <= estoque)
    // violado: estoque físico genuinamente insuficiente no instante da
    // conversão. O batch inteiro foi revertido (nenhum produto baixado
    // parcialmente). O pedido continua PAGO com estoque_baixado_em NULL —
    // detectável, não silencioso — e a reconciliação oportunista do admin
    // tenta de novo nas próximas cargas do painel.
    console.error("Falha ao converter reserva em baixa de estoque", pedidoId, err);
    if (String((err as Error)?.message || "").includes("CHECK constraint failed: estoque")) {
      return { ok: false, baixado: false, erro: "ESTOQUE_INSUFICIENTE" };
    }
    throw err; // Falha transitória/inesperada deve ser visível ao chamador/retry.
  }
}

// O mesmo predicado protege todos os produtos e o marcador do pedido.
// Substituição, prazo ou falta de ID remoto não tornam um Pix PENDENTE morto.
const RESERVA_LIBERAVEL_SQL = `reserva_status = 'ATIVA'
  AND estoque_baixado_em IS NULL AND status_pagamento = 'PENDENTE'
  AND NOT EXISTS (SELECT 1 FROM pedido_itens pi
                  WHERE pi.pedido_id = pedidos.id AND pi.estoque_baixado_em IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos pp
                  WHERE pp.pedido_id = pedidos.id AND pp.metodo = 'PIX_MP' AND pp.status = 'PENDENTE')`;

// Libera atomicamente a reserva de um pedido cujo Pix expirou ou foi
// cancelado — só quando o agregado financeiro ainda está genuinamente
// PENDENTE (líquido zero) e nenhum Pix continua PENDENTE. Um pedido PARCIAL nunca tem sua
// reserva liberada por esta função: é dívida operacional conhecida e
// deliberada (ver relatório do Passo 7), não um bug a esconder atrás de
// uma liberação automática que vender-ia mercadoria já parcialmente paga.
export async function liberarReservaPedido(db: D1Database, pedidoId: number): Promise<LiberacaoResultado> {
  const pedido = await db
    .prepare(`SELECT reserva_status FROM pedidos WHERE id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ reserva_status: string }>();

  if (!pedido || pedido.reserva_status !== "ATIVA") {
    return { ok: true, liberado: false };
  }

  const { results } = await db
    .prepare(
      `SELECT produto_id, SUM(quantidade) AS quantidade
       FROM pedido_itens
       WHERE pedido_id = ? AND produto_id IS NOT NULL
       GROUP BY produto_id`,
    )
    .bind(pedidoId)
    .all<{ produto_id: number; quantidade: number }>();

  const itens = results || [];

  // O ledger pode ter mudado após a projeção anterior: revalidar no batch.
  const statements = [preparePedidoFinancialProjection(db, pedidoId)];
  statements.push(...itens.map((item) =>
    db
      .prepare(
        `UPDATE produtos SET
           estoque_reservado = estoque_reservado - ?,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM pedidos WHERE id = ? AND ${RESERVA_LIBERAVEL_SQL}
           )`,
      )
      .bind(item.quantidade, item.produto_id, pedidoId),
  ));

  statements.push(
    db
      .prepare(
        `UPDATE pedidos SET
           reserva_status = 'LIBERADA',
           reserva_liberada_em = CURRENT_TIMESTAMP,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND ${RESERVA_LIBERAVEL_SQL}`,
      )
      .bind(pedidoId),
  );

  try {
    const resultados = await db.batch(statements);
    const pedidoResultado = resultados[resultados.length - 1];
    const liberado = Number(pedidoResultado?.meta?.changes || 0) === 1;
    return { ok: true, liberado };
  } catch (err) {
    console.error("Falha ao liberar reserva de estoque", pedidoId, err);
    return { ok: false, liberado: false, erro: "ERRO_TRANSACIONAL_LIBERACAO" };
  }
}
