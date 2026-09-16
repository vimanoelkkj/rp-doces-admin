/// <reference types="@cloudflare/workers-types" />

// Passo 7: efeitos físicos de estoque (reserva/baixa/liberação). Este
// módulo não sabe nada sobre múltiplos pagamentos, waterfall ou o
// agregado financeiro — só reage a `pedidos.status_pagamento` já
// resolvido. Quem decide QUANDO chamar isso é `pedidoReconcile.ts`
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
      erro: "ITENS_NAO_ENCONTRADOS" | "ESTOQUE_INSUFICIENTE";
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
    .prepare(`SELECT status_pagamento, estoque_baixado_em FROM pedidos WHERE id = ? LIMIT 1`)
    .bind(pedidoId)
    .first<{ status_pagamento: string; estoque_baixado_em: string | null }>();

  if (!pedido || pedido.status_pagamento !== "PAGO" || pedido.estoque_baixado_em) {
    return { ok: true, baixado: false };
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
  if (!itens.length) return { ok: false, baixado: false, erro: "ITENS_NAO_ENCONTRADOS" };

  const statements = [];

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
    return { ok: false, baixado: false, erro: "ESTOQUE_INSUFICIENTE" };
  }
}

// Libera atomicamente a reserva de um pedido cujo Pix expirou ou foi
// cancelado — só quando o agregado financeiro ainda está genuinamente
// PENDENTE (nenhum centavo confirmado). Um pedido PARCIAL nunca tem sua
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

  const statements = itens.map((item) =>
    db
      .prepare(
        `UPDATE produtos SET
           estoque_reservado = estoque_reservado - ?,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM pedidos WHERE id = ? AND reserva_status = 'ATIVA' AND status_pagamento = 'PENDENTE'
           )`,
      )
      .bind(item.quantidade, item.produto_id, pedidoId),
  );

  statements.push(
    db
      .prepare(
        `UPDATE pedidos SET
           reserva_status = 'LIBERADA',
           reserva_liberada_em = CURRENT_TIMESTAMP,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND reserva_status = 'ATIVA' AND status_pagamento = 'PENDENTE'`,
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

const RECONCILIAR_PAGOS_SEM_BAIXA_BATCH_SIZE = 4;

// Passo 7: gêmea de `reconcilePendingPixPayments`/`liberarReservasVencidasLocalmente`
// (Passo 6/7), chamada oportunisticamente por GET /api/admin/pedidos. Cobre
// o caso documentado no relatório do Passo 7: um pedido PAGO cuja reserva
// já tinha sido liberada por uma expiração concorrente pode ficar
// temporariamente com estoque_baixado_em NULL se o estoque físico não
// comportava a conversão naquele instante — nunca silencioso, sempre
// retentado aqui até o estoque permitir ou alguém resolver manualmente.
export async function reconciliarPagosSemBaixa(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id FROM pedidos
       WHERE status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL
       ORDER BY atualizado_em ASC
       LIMIT ?`,
    )
    .bind(RECONCILIAR_PAGOS_SEM_BAIXA_BATCH_SIZE)
    .all<{ id: number }>();

  const pendentes = results || [];
  if (!pendentes.length) return;

  await Promise.allSettled(
    pendentes.map(async (row) => {
      try {
        await baixarEstoquePedido(db, row.id);
      } catch (err) {
        console.error("Falha ao reconciliar pedido pago sem baixa de estoque", row.id, err);
      }
    }),
  );
}
