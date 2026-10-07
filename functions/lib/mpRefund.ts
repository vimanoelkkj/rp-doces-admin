/// <reference types="@cloudflare/workers-types" />

// Mercado Pago Orders refunds: POST /v1/orders/{ORD}/refund; recovery by GET order.
//
// Espelha exatamente a classificação de `mpPost.ts` (SUCESSO / RECUSA_DEFINITIVA
// / AMBIGUO) — não amplia a matriz, só troca o endpoint e o corpo enviado. Um
// 5xx/408/429/timeout/transporte nunca prova que o estorno não aconteceu do
// outro lado; por isso continua AMBIGUO, nunca vira sucesso nem recusa.

import { MP_ORDERS_URL } from "./mp/orders/client";
import {
  centsToDecimal,
  decimalToCents,
  orderIdempotencyKey,
  type MpOrder
} from "./mp/orders/types";

export const MP_REFUND_TIMEOUT_MS = 20_000;

export interface MpRefundCriado {
  id: string;
  payment_id: string;
  amount?: string;
  status: string;
}

export interface MpRefundOptions {
  amountCentavos?: number;
  renderInProcess?: boolean;
  priorRefundIds?: readonly string[];
}

export async function getOrderRefundIds(
  accessToken: string,
  orderId: string
): Promise<
  | { resultado: "SUCESSO"; refundIds: string[] }
  | Extract<MpRefundResultado, { resultado: "AMBIGUO" }>
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_REFUND_TIMEOUT_MS);
  try {
    const response = await fetch(`${MP_ORDERS_URL}/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    if (!response.ok)
      return { resultado: "AMBIGUO", motivo: "HTTP_INDISPONIVEL", httpStatus: response.status };
    const order = (await response.json()) as MpOrder;
    const refunds = order.transactions?.refunds === undefined ? [] : order.transactions.refunds;
    if (
      order.id !== orderId ||
      !order.transactions ||
      typeof order.transactions !== "object" ||
      Array.isArray(order.transactions) ||
      (order.transactions.refunds === undefined &&
        (!Array.isArray(order.transactions.payments) ||
          order.transactions.payments.length !== 1)) ||
      !Array.isArray(refunds) ||
      refunds.some(r => !/^REF[A-Za-z0-9]+$/.test(r?.id))
    )
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    return { resultado: "SUCESSO", refundIds: [...new Set(refunds.map(r => r.id))] };
  } catch {
    return {
      resultado: "AMBIGUO",
      motivo: controller.signal.aborted ? "TIMEOUT" : "TRANSPORTE",
      httpStatus: null
    };
  } finally {
    clearTimeout(timer);
  }
}

export type MotivoAmbiguoRefund =
  "TRANSPORTE" | "TIMEOUT" | "HTTP_INDISPONIVEL" | "HTTP_INDETERMINADO" | "RESPOSTA_ILEGIVEL";

export type MpRefundResultado =
  | { resultado: "SUCESSO"; refund: MpRefundCriado }
  | {
      resultado: "RECUSA_DEFINITIVA";
      httpStatus: number;
      mensagem: string | null;
      detalhe: string | null;
    }
  | { resultado: "AMBIGUO"; motivo: MotivoAmbiguoRefund; httpStatus: number | null };

export async function postRefundMp(
  accessToken: string,
  orderId: string,
  paymentId: string,
  idempotencyKey: string,
  options: MpRefundOptions = {}
): Promise<MpRefundResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_REFUND_TIMEOUT_MS);

  // O prazo cobre a operação HTTP INTEIRA, headers e corpo (como em fetchMpPayment): um
  // corpo que nunca termina também vira AMBÍGUO/TIMEOUT, em vez de pendurar a requisição.
  try {
    let response: Response;
    try {
      response = await fetch(`${MP_ORDERS_URL}/${encodeURIComponent(orderId)}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          // Estável por operação lógica: um retry da MESMA intenção reenvia
          // exatamente esta key, nunca uma nova (mesmo padrão de mpPost.ts).
          "X-Idempotency-Key":
            idempotencyKey.length > 128 ? await orderIdempotencyKey(idempotencyKey) : idempotencyKey
        },
        ...(options.amountCentavos === undefined
          ? {}
          : {
              body: JSON.stringify({
                transactions: [{ id: paymentId, amount: centsToDecimal(options.amountCentavos) }]
              })
            }),
        signal: controller.signal
      });
    } catch {
      const expirou = controller.signal.aborted;
      return {
        resultado: "AMBIGUO",
        motivo: expirou ? "TIMEOUT" : "TRANSPORTE",
        httpStatus: null
      };
    }

    if (!response.ok) {
      if (response.status >= 500 || [402, 408, 409, 423, 429].includes(response.status)) {
        return { resultado: "AMBIGUO", motivo: "HTTP_INDISPONIVEL", httpStatus: response.status };
      }
      if (response.status < 400) {
        return { resultado: "AMBIGUO", motivo: "HTTP_INDETERMINADO", httpStatus: response.status };
      }
      // O corpo do 4xx só traz diagnóstico: se travar, a decisão continua pelo STATUS.
      const corpo = await response.text().catch(() => "");
      let mensagem: string | null = null;
      let detalhe: string | null = null;
      try {
        const parsed = JSON.parse(corpo) as { message?: string; cause?: unknown };
        mensagem = parsed.message ?? null;
        detalhe = parsed.cause ? JSON.stringify(parsed.cause).slice(0, 500) : null;
      } catch {
        // corpo de erro não era JSON — segue sem detalhe estruturado
      }
      return { resultado: "RECUSA_DEFINITIVA", httpStatus: response.status, mensagem, detalhe };
    }

    let refund: MpRefundCriado | null = null;
    try {
      refund = refundFromOrder(
        (await response.json()) as MpOrder,
        orderId,
        paymentId,
        options.amountCentavos,
        undefined,
        options.priorRefundIds
      );
    } catch {
      // Abort durante o corpo é o prazo estourado: o provedor já respondeu 2xx, então o
      // estorno pode existir e o resultado segue AMBÍGUO. Qualquer outra falha segue ilegível.
      if (controller.signal.aborted) {
        return { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: response.status };
      }
      refund = null;
    }
    // 2xx sem `id` utilizável é ambíguo, não sucesso: o recurso pode existir
    // do outro lado e nós não conseguimos nomeá-lo.
    if (!refund) {
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    }
    if (
      options.amountCentavos !== undefined &&
      (String(refund.payment_id) !== paymentId ||
        decimalToCents(refund.amount) !== options.amountCentavos ||
        typeof refund.status !== "string" ||
        refund.status.trim() === "")
    ) {
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    }
    return { resultado: "SUCESSO", refund };
  } finally {
    clearTimeout(prazo);
  }
}

export async function getRefundMp(
  accessToken: string,
  orderId: string,
  paymentId: string,
  refundId: string | undefined,
  amountCentavos: number,
  priorRefundIds?: readonly string[]
): Promise<MpRefundResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_REFUND_TIMEOUT_MS);
  // Mesmo prazo único para headers e corpo (ver postRefundMp).
  try {
    let response: Response;
    try {
      response = await fetch(`${MP_ORDERS_URL}/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal
      });
    } catch {
      return {
        resultado: "AMBIGUO",
        motivo: controller.signal.aborted ? "TIMEOUT" : "TRANSPORTE",
        httpStatus: null
      };
    }
    if (!response.ok) {
      if (response.status >= 500 || [402, 408, 409, 423, 429].includes(response.status)) {
        return { resultado: "AMBIGUO", motivo: "HTTP_INDISPONIVEL", httpStatus: response.status };
      }
      const corpo = await response.text().catch(() => "");
      let mensagem: string | null = null;
      let detalhe: string | null = null;
      try {
        const parsed = JSON.parse(corpo) as { message?: string; cause?: unknown };
        mensagem = parsed.message ?? null;
        detalhe = parsed.cause ? JSON.stringify(parsed.cause).slice(0, 500) : null;
      } catch {
        /* resposta sem diagnostico estruturado */
      }
      return { resultado: "RECUSA_DEFINITIVA", httpStatus: response.status, mensagem, detalhe };
    }
    let refund: MpRefundCriado | null = null;
    try {
      refund = refundFromOrder(
        (await response.json()) as MpOrder,
        orderId,
        paymentId,
        amountCentavos,
        refundId,
        priorRefundIds
      );
    } catch {
      if (controller.signal.aborted) {
        return { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: response.status };
      }
      refund = null;
    }
    if (
      !refund ||
      (refundId !== undefined && String(refund.id) !== refundId) ||
      String(refund.payment_id) !== paymentId ||
      decimalToCents(refund.amount) !== amountCentavos ||
      typeof refund.status !== "string" ||
      refund.status.trim() === ""
    ) {
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    }
    return { resultado: "SUCESSO", refund };
  } finally {
    clearTimeout(prazo);
  }
}

// A known REF identity is required on recovery. Never select a different refund
// merely because its amount happens to match a legitimate previous refund.
function refundFromOrder(
  order: MpOrder,
  orderId: string,
  paymentId: string,
  amount?: number,
  refundId?: string,
  priorRefundIds?: readonly string[]
): MpRefundCriado | null {
  if (
    order?.id !== orderId ||
    !/^ORD[A-Za-z0-9]+$/.test(orderId) ||
    !/^PAY[A-Za-z0-9]+$/.test(paymentId)
  )
    return null;
  const refunds = order.transactions?.refunds;
  if (!Array.isArray(refunds)) return null;
  const candidates = refunds.filter(
    refund =>
      refund?.transaction_id === paymentId &&
      /^REF[A-Za-z0-9]+$/.test(refund.id) &&
      typeof refund.status === "string" &&
      decimalToCents(refund.amount) !== null &&
      (amount === undefined || decimalToCents(refund.amount) === amount) &&
      (refundId === undefined || refund.id === refundId) &&
      (priorRefundIds === undefined || !priorRefundIds.includes(refund.id))
  );
  if (candidates.length !== 1) return null;
  const refund = candidates[0];
  return {
    id: refund.id,
    payment_id: refund.transaction_id,
    amount: refund.amount,
    status:
      refund.status === "processed"
        ? "approved"
        : ["pending", "in_process", "rejected", "canceled", "cancelled", "failed"].includes(
              refund.status
            )
          ? refund.status
          : `unknown:${refund.status}`
  };
}
