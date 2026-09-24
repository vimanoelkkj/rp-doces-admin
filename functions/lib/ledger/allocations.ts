/// <reference types="@cloudflare/workers-types" />

import {
  CONFIRMED_REFUNDS_BY_ALLOCATION_CTE,
  EXCHANGE_COVERAGE_STATUSES,
} from "../financialCoverage";

export interface ItemComSaldo {
  itemId: number;
  valorTotalCentavos: number;
  pagoPorOutrosCentavos: number;
}

// Aloca 100% do valor de cada item positivo ao pagamento informado — mesma
// primitiva usada pela materialização lazy (4b) e pela criação do pagamento
// no checkout (4c-1). Estrutural: não afirma "isso foi pago", só "este
// pagamento é responsável por estes itens" (ver relatório do 4b).
export async function allocateFullValueAcrossItems(
  db: D1Database,
  pagamentoId: number,
  pedidoId: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
       SELECT ?, id, valor_total_centavos
       FROM pedido_itens
       WHERE pedido_id = ? AND valor_total_centavos > 0`,
    )
    .bind(pagamentoId, pedidoId)
    .run();
}

// Só considera dinheiro de pagamentos com status='PAGO' — a alocação
// estrutural de um Pix SITE ainda PENDENTE nunca conta como saldo
// consumido (é exatamente o que separa este helper de
// allocateFullValueAcrossItems).
export async function getItensComSaldo(db: D1Database, pedidoId: number): Promise<ItemComSaldo[]> {
  // Durante o cutover B5 o mesmo código ainda precisa ler a topologia
  // histórica, anterior à 0016. Depois da migration, somente ATIVO entra no
  // waterfall; TROCA_PENDENTE jamais recebe cobertura financeira.
  const temStatusItem = await db.prepare(
    `SELECT 1 FROM pragma_table_info('pedido_itens') WHERE name='status_item' LIMIT 1`,
  ).first();
  if (!temStatusItem) {
    const { results } = await db.prepare(
      `SELECT pi.id AS itemId,pi.valor_total_centavos AS valorTotalCentavos,
              COALESCE(SUM(CASE WHEN pp.status='PAGO' THEN a.valor_centavos ELSE 0 END),0) AS pagoPorOutrosCentavos
       FROM pedido_itens pi
       LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id=pi.id
       LEFT JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
       WHERE pi.pedido_id=? GROUP BY pi.id,pi.valor_total_centavos ORDER BY pi.id`,
    ).bind(pedidoId).all<ItemComSaldo>();
    return results;
  }
  const { results } = await db
    .prepare(
      `WITH RECURSIVE linhagem(item_atual_id,item_id) AS (
         SELECT pi.id,pi.id FROM pedido_itens pi
         WHERE pi.pedido_id=? AND pi.status_item='ATIVO'
         UNION
         SELECT l.item_atual_id,t.item_origem_id FROM linhagem l
         JOIN pedido_item_trocas t ON t.item_destino_id=l.item_id
         WHERE t.status IN (${EXCHANGE_COVERAGE_STATUSES})
       ), ${CONFIRMED_REFUNDS_BY_ALLOCATION_CTE}
       SELECT pi.id AS itemId, pi.valor_total_centavos AS valorTotalCentavos,
              COALESCE(SUM(CASE WHEN pp.status='PAGO'
                THEN MAX(0,a.valor_centavos-COALESCE(rf.valor_centavos,0)) ELSE 0 END),0)
                AS pagoPorOutrosCentavos
       FROM pedido_itens pi
       LEFT JOIN linhagem l ON l.item_atual_id=pi.id
       LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id=l.item_id
       LEFT JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
       LEFT JOIN refunds_confirmados rf ON rf.pagamento_alocacao_id=a.id
       WHERE pi.pedido_id=? AND pi.status_item='ATIVO'
       GROUP BY pi.id, pi.valor_total_centavos
       ORDER BY pi.id ASC`,
    )
    .bind(pedidoId, pedidoId)
    .all<ItemComSaldo>();
  return results;
}

// Pura e determinística, sem D1: do item mais antigo (id ASC) pro mais
// novo, preenche o saldo aberto de cada um até o valor do pagamento
// acabar. Se não couber inteiro, falha sem propor nenhuma alocação parcial
// inválida.
export function computeWaterfallAllocations(
  itens: ItemComSaldo[],
  valorCentavos: number,
):
  | { ok: true; alocacoes: { itemId: number; valorCentavos: number }[] }
  | { ok: false; erro: "VALOR_ACIMA_DO_SALDO" } {
  let restante = valorCentavos;
  const alocacoes: { itemId: number; valorCentavos: number }[] = [];

  for (const item of itens) {
    if (restante <= 0) break;
    const aberto = item.valorTotalCentavos - item.pagoPorOutrosCentavos;
    if (aberto <= 0) continue;
    const parcela = Math.min(aberto, restante);
    alocacoes.push({ itemId: item.itemId, valorCentavos: parcela });
    restante -= parcela;
  }

  if (restante > 0) return { ok: false, erro: "VALOR_ACIMA_DO_SALDO" };
  return { ok: true, alocacoes };
}
