/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql, getPedidoAnulacao } from "./pedidoValido";

import { recalculatePedidoStatusPagamento } from "./ledger/projection";
import type { StatusFinanceiroAgregado } from "./ledger/types";
import { baixarEstoquePedido, type BaixaResultado } from "./stock";
import { STATUS_FINANCEIRO_SQL } from "./pedidoFinanceiroSql";
import { reconcileExchangeCharges } from "./itemExchange";

export type PedidoReconcileResult =
  | { ok: false; motivo: "PEDIDO_NAO_ENCONTRADO" | "LEGADO_SEM_LEDGER" | "PEDIDO_ANULADO" }
  | { ok: true; statusFinanceiro: StatusFinanceiroAgregado; estoque: BaixaResultado };

// Convergência por pedido: não cria fatos financeiros, não materializa legado,
// não libera reservas nem altera status operacional. Pode repetir sem evento MP.
export async function reconcilePedidoAfterFinancialChange(
  db: D1Database,
  pedidoId: number,
): Promise<PedidoReconcileResult> {
  if (await getPedidoAnulacao(db, pedidoId)) return { ok: false, motivo: "PEDIDO_ANULADO" };
  const agregado = await recalculatePedidoStatusPagamento(db, pedidoId);
  if (agregado === null) {
    const pedido = await db.prepare(`SELECT id FROM pedidos WHERE id = ?`).bind(pedidoId).first();
    return { ok: false, motivo: pedido ? "LEGADO_SEM_LEDGER" : "PEDIDO_NAO_ENCONTRADO" };
  }

  const estoque: BaixaResultado = agregado === "PAGO"
    ? await baixarEstoquePedido(db, pedidoId)
    : { ok: true, baixado: false };
  if (!estoque.ok) console.error("Reconciliação financeira com pendência de estoque", pedidoId, estoque.erro);

  // M2 (auditoria Comanda Viva) — mesmo gatilho de qualquer mudança
  // financeira (pagamento admin, refund admin, sync de webhook MP, ou este
  // próprio loop de divergentes). Sem isto, uma troca AGUARDANDO_COBRANCA só
  // convergia para CONCLUIDA quando alguém abria o detalhe do pedido no
  // admin. Idempotente (só atualiza linhas ainda em AGUARDANDO_COBRANCA) e
  // não cria fato financeiro nenhum — só espelha o saldo já reconciliado
  // acima. Falha aqui não pode mascarar o resultado financeiro já apurado.
  try {
    await reconcileExchangeCharges(db, pedidoId);
  } catch (err) {
    console.error("Reconciliação financeira com pendência de troca", pedidoId, err);
  }

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
      SELECT p.id, p.status_pagamento, p.reserva_status, p.estoque_baixado_em, p.atualizado_em,
             ${STATUS_FINANCEIRO_SQL} AS esperado,
             EXISTS (
               SELECT 1
               FROM pedido_itens pi
               WHERE pi.pedido_id = p.id
                 AND pi.status_item = 'ATIVO'
                 AND pi.produto_id IS NOT NULL
                 AND pi.estoque_estado IN ('RESERVADO', 'SEM_RESERVA', 'LIBERADO')
             ) AS estoque_pendente
      FROM pedidos p
      WHERE ${pedidoValidoSql('p.id')} AND EXISTS (SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id = p.id)
    ) divergente
    WHERE status_pagamento IS NOT esperado
       OR (esperado = 'PAGO' AND estoque_pendente)
       OR (esperado = 'PAGO'
           AND EXISTS (
             SELECT 1 FROM pedido_itens pi
             WHERE pi.pedido_id = divergente.id
               AND pi.status_item = 'ATIVO'
               AND pi.produto_id IS NOT NULL
           )
           AND NOT estoque_pendente
           AND (reserva_status <> 'CONVERTIDA' OR estoque_baixado_em IS NULL))
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
