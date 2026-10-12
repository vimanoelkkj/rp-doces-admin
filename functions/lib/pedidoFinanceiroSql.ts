/// <reference types="@cloudflare/workers-types" />

import { pedidoValidoSql } from "./pedidoValido";
import type { PaymentConfirmationGuard } from "./paymentSync/confirmationGuard";

// Compartilhada por projeção, seleção de divergências e revalidação física.
// Subqueries independentes evitam multiplicar pagamentos por refunds/alocações.
// O alias p sempre representa pedidos.
export const BRUTO_PAGO_SQL = `COALESCE((SELECT SUM(pp.valor_centavos)
                                         FROM pedido_pagamentos pp
                                         WHERE pp.pedido_id = p.id
                                           AND pp.status = 'PAGO'), 0)`;

export const REEMBOLSADO_SQL = `COALESCE((SELECT SUM(r.valor_centavos)
                                          FROM pedido_reembolsos r
                                          WHERE r.pedido_id = p.id
                                            AND r.status = 'REEMBOLSADO'), 0)`;

export const LIQUIDO_SQL = `MAX(0, ${BRUTO_PAGO_SQL} - ${REEMBOLSADO_SQL})`;

export const STATUS_FINANCEIRO_SQL = `CASE
  WHEN ${LIQUIDO_SQL} <= 0 THEN 'PENDENTE'
  WHEN ${LIQUIDO_SQL} < p.valor_total_centavos THEN 'PARCIAL'
  ELSE 'PAGO'
END`;

// Captura remota ainda não conciliada: o Mercado Pago confirma (ou devolveu) o Pix, mas o ledger
// local não aceitou essa transição — conferência de integridade (INTEGRIDADE_MP:*) ou matriz de
// transição. `mp_status` é o fato estruturado; `mp_status_detail` só diagnostica. Não é o mesmo
// predicado de quem retém a reserva nem de quem mostra o detalhe, é uma parte de cada um:
// PIX_MP_PENDENTE_NO_PEDIDO_SQL (stock.ts) tem este como segundo braço e segura também todo PIX_MP
// PENDENTE; o bloco PIX_MP_INTEGRIDADE do detalhe (api/admin/pedidos/[id].ts) tem este como
// primeiro braço e ainda sinaliza PAGO+refunded parcial e REEMBOLSADO reconhecido.
// O WHERE do índice parcial idx_pedido_pagamentos_captura_nao_conciliada (migration 0039) espelha
// este predicado: mudar um exige mudar o outro. O parâmetro é o alias de `pedido_pagamentos`.
export const capturaRemotaNaoConciliadaSql = (pp: string) =>
  `(${pp}.metodo = 'PIX_MP' AND ${pp}.status NOT IN ('PAGO', 'REEMBOLSADO')
    AND LOWER(COALESCE(${pp}.mp_status, '')) IN ('approved', 'refunded'))`;

// Guard atômico de cancelamento: só cancela se não houver saldo líquido retido.
export const pedidoSemSaldoLiquidoSql = (pedidoIdSql = "pedidos.id") =>
  `((SELECT ${LIQUIDO_SQL} FROM pedidos p WHERE p.id = ${pedidoIdSql}) <= 0)`;

// Elegibilidade operacional para recebimento manual ou cobrança administrativa:
// bloqueia pedidos cancelados ou com comanda encerrada, mas preserva liquidação legítima após entrega.
export const elegibilidadeOperacionalCobrancaSql = (alias = "pedidos") =>
  `(${alias}.status_pedido <> 'CANCELADO' AND (${alias}.status_comanda = 'ABERTA' OR ${alias}.status_pedido = 'ENTREGUE'))`;

// Conservative void containment: local terminal states cannot exclude an unknown capture.
// Includes pre-dispatch refusals and fully refunded history; no remote certainty is inferred.
// Migration 0040 mirrors this predicate; contract tests prevent drift.
export const exposicaoPixRemotaNoPedidoSql = (pedidoIdSql: string) =>
  `(EXISTS (SELECT 1 FROM pedido_pagamentos ep
            WHERE ep.pedido_id = ${pedidoIdSql} AND ep.metodo = 'PIX_MP')
    OR EXISTS (SELECT 1 FROM pedido_operacoes eo
               WHERE eo.pedido_id = ${pedidoIdSql}
                 AND eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO'))
    OR EXISTS (SELECT 1 FROM pedidos el
               WHERE el.id = ${pedidoIdSql}
                 AND (el.mp_payment_id IS NOT NULL OR el.mp_qr_code IS NOT NULL
                   OR el.mp_qr_code_base64 IS NOT NULL OR el.mp_ticket_url IS NOT NULL)))`;

function preparePedidoFinancialProjectionBase(
  db: D1Database,
  pedidoId: number,
  operationKey?: string,
  confirmation?: PaymentConfirmationGuard
): D1PreparedStatement {
  const operationGuard = operationKey
    ? `AND EXISTS (SELECT 1 FROM pedido_operacoes o
                   WHERE o.operation_key = ? AND o.pedido_id = p.id
                     AND o.pedido_item_id IS NOT NULL)`
    : "";
  const ledgerGuard = operationKey
    ? ""
    : "AND EXISTS (SELECT 1 FROM pedido_pagamentos pp WHERE pp.pedido_id = p.id)";
  return db
    .prepare(
      `
    UPDATE pedidos AS p
    SET status_pagamento = ${STATUS_FINANCEIRO_SQL},
        atualizado_em = CASE WHEN p.status_pagamento IS NOT (${STATUS_FINANCEIRO_SQL})
                             THEN CURRENT_TIMESTAMP ELSE p.atualizado_em END
    WHERE p.id = ? AND ${pedidoValidoSql("p.id")}
      ${ledgerGuard}
      ${operationGuard}
      ${confirmation ? `AND (${confirmation.sql})` : ""}
    RETURNING status_pagamento
  `
    )
    .bind(pedidoId, ...(operationKey ? [operationKey] : []), ...(confirmation?.args ?? []));
}

export function preparePedidoFinancialProjection(
  db: D1Database,
  pedidoId: number,
  confirmation?: PaymentConfirmationGuard
): D1PreparedStatement {
  return preparePedidoFinancialProjectionBase(db, pedidoId, undefined, confirmation);
}

export function preparePedidoFinancialProjectionForItemOperation(
  db: D1Database,
  pedidoId: number,
  operationKey: string
): D1PreparedStatement {
  return preparePedidoFinancialProjectionBase(db, pedidoId, operationKey);
}
