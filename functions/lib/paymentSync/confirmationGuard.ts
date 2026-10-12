/// <reference types="@cloudflare/workers-types" />

// Revalidated inside each write, including the stock batch on a paid replay.
export interface PaymentConfirmationGuard {
  sql: string;
  args: (string | number | null)[];
}

export const PAYMENT_OPERATION_TYPES_SQL = "('CHECKOUT_SITE','PIX_ADMIN','PIX_ADMIN_REGENERACAO')";

export interface PaymentOperationSnapshot {
  id: number;
  pedido_id: number | null;
  tipo: string;
  escopo: string;
  fase: string;
  mp_request: string | null;
  mp_payment_id: string | null;
  external_reference: string | null;
}

export function operationSnapshotGuard(
  pagamentoId: number,
  operations: PaymentOperationSnapshot[]
): PaymentConfirmationGuard {
  return {
    sql: `(SELECT COUNT(*) FROM pedido_operacoes o WHERE o.pagamento_id = ?
           AND o.tipo IN ${PAYMENT_OPERATION_TYPES_SQL}) = ?
      ${operations
        .map(
          () => `AND EXISTS (SELECT 1 FROM pedido_operacoes o WHERE o.id = ?
        AND o.pagamento_id = ? AND o.pedido_id IS ? AND o.tipo = ? AND o.escopo = ?
        AND o.mp_request IS ? AND o.mp_payment_id IS ? AND o.fase = ?)`
        )
        .join("\n")}`,
    args: [
      pagamentoId,
      operations.length,
      ...operations.flatMap(o => [
        o.id,
        pagamentoId,
        o.pedido_id,
        o.tipo,
        o.escopo,
        o.mp_request,
        o.mp_payment_id,
        o.fase
      ])
    ]
  };
}
