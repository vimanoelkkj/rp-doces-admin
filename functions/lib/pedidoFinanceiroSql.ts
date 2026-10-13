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

// Perna Pix quitada: paga e INTEGRALMENTE estornada. Prova: estorno confirmado do PRÓPRIO
// pagamento e pedido (MP com mp_refund_id, ou manual PIX_MP; refund de outro método não prova
// devolução), somando EXATAMENTE o valor pago (soma maior é anomalia financeira, não quitação),
// sem refund pendente nem intenção em andamento/inconclusiva. A identidade remota precisa ser
// coerente (Orders: ORD+PAY alfanuméricos; Payments histórico: sem ORD e id numérico) e única no
// ledger. É a ÚNICA isenção da contenção abaixo.
//
// Lógica de três valores do SQLite: GLOB/= com NULL resultam em NULL, e NOT (NULL) é NULL, o que
// faria o WHERE descartar a perna em vez de acusar exposição. Por isso a prova é embrulhada em
// COALESCE(..., 0): identidade incompleta ou qualquer NULL vira 0 (sem prova), nunca "sem exposição".
const pagamentoPixQuitadoSql = (alias: string) =>
  `COALESCE((${alias}.metodo = 'PIX_MP' AND ${alias}.status = 'PAGO'
    AND ((${alias}.mp_order_id GLOB 'ORD?*' AND ${alias}.mp_order_id NOT GLOB '*[^A-Za-z0-9]*'
          AND ${alias}.mp_payment_id GLOB 'PAY?*' AND ${alias}.mp_payment_id NOT GLOB '*[^A-Za-z0-9]*')
      OR (${alias}.mp_order_id IS NULL AND ${alias}.mp_payment_id GLOB '[1-9]*'
          AND ${alias}.mp_payment_id NOT GLOB '*[^0-9]*'))
    AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos dup
                    WHERE dup.id <> ${alias}.id AND dup.mp_payment_id = ${alias}.mp_payment_id)
    AND ${alias}.valor_centavos = COALESCE((SELECT SUM(rq.valor_centavos) FROM pedido_reembolsos rq
        WHERE rq.pagamento_id = ${alias}.id AND rq.pedido_id = ${alias}.pedido_id
          AND rq.status = 'REEMBOLSADO' AND rq.metodo = 'PIX_MP'
          AND (rq.origem = 'MANUAL' OR (rq.origem = 'MERCADO_PAGO' AND rq.mp_refund_id IS NOT NULL))), 0)
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolsos rp
                    WHERE rp.pagamento_id = ${alias}.id AND rp.status = 'PENDENTE')
    AND NOT EXISTS (SELECT 1 FROM pedido_reembolso_pix_mp_intencoes ri
                    WHERE ri.pagamento_id = ${alias}.id
                      AND ri.status IN ('PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO'))), 0)`;

// Contenção conservadora da anulação: estados terminais locais não excluem uma captura
// desconhecida. Só uma perna Pix quitada (e a operação de checkout/Pix admin CONCLUIDA que a
// descreve, do mesmo pedido, com o mesmo mp_payment_id) deixa de contar como exposição. Qualquer
// outro histórico Pix, cobrança pendente/expirada/cancelada/falha, regeneração Pix (sempre),
// operação não concluída, órfã ou divergente e identidade legada sem correspondência continua
// bloqueando. Migration 0041 espelha este predicado (0040 o tornou absoluto); os testes de
// contrato impedem divergência.
export const exposicaoPixRemotaNoPedidoSql = (pedidoIdSql: string) =>
  `(EXISTS (SELECT 1 FROM pedido_pagamentos ep
            WHERE ep.pedido_id = ${pedidoIdSql} AND ep.metodo = 'PIX_MP'
              AND NOT ${pagamentoPixQuitadoSql("ep")})
    OR EXISTS (SELECT 1 FROM pedido_operacoes eo
               WHERE eo.pedido_id = ${pedidoIdSql}
                 AND eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO')
                 AND NOT COALESCE((eo.tipo IN ('CHECKOUT_SITE', 'PIX_ADMIN') AND eo.fase = 'CONCLUIDA'
                          AND EXISTS (SELECT 1 FROM pedido_pagamentos qp
                                      WHERE qp.id = eo.pagamento_id AND qp.pedido_id = eo.pedido_id
                                        AND qp.mp_payment_id = eo.mp_payment_id
                                        AND ${pagamentoPixQuitadoSql("qp")})), 0))
    OR EXISTS (SELECT 1 FROM pedidos el
               WHERE el.id = ${pedidoIdSql}
                 AND ((el.mp_payment_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos lp
                                       WHERE lp.pedido_id = el.id AND lp.mp_payment_id = el.mp_payment_id
                                         AND ${pagamentoPixQuitadoSql("lp")}))
                   OR (el.mp_payment_id IS NULL
                       AND (el.mp_qr_code IS NOT NULL OR el.mp_qr_code_base64 IS NOT NULL
                         OR el.mp_ticket_url IS NOT NULL)))))`;

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
      ${operationGuard}${confirmation ? `\n      AND (${confirmation.sql})` : ""}
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
