import type { MpOrder } from "./types";
import { compatiblePaymentStatus, mapOrderStatus } from "./status";

const verifiedOrders = new WeakSet<VerifiedMpOrder>();
export const MP_ORDER_GET_TIMEOUT_MS = 5000;
export const MP_ORDERS_URL = "https://api.mercadopago.com/v1/orders";

// Flat immutable snapshot: id is PAY for compatibility; order_id is the GET's ORD.
export interface OrderPaymentSnapshot {
  readonly id: string;
  readonly order_id: string;
  readonly status: string;
  readonly status_detail: string | null;
  readonly order_status: string;
  readonly order_status_detail: string | null;
  readonly transaction_status: string;
  readonly transaction_status_detail: string | null;
  readonly external_reference: string | null;
  readonly total_amount: string | null;
  readonly transaction_amount: string | null;
  readonly paid_amount: string | null;
  readonly payment_method_id: string | null;
  readonly payment_method_type: string | null;
  readonly country_code: string | null;
  readonly date_approved: string | null;
  readonly date_of_expiration: string | null;
  readonly point_of_interaction: {
    readonly transaction_data: {
      readonly qr_code?: string;
      readonly qr_code_base64?: string;
      readonly ticket_url?: string;
    };
  };
}
declare const verifiedOrderBrand: unique symbol;
export interface VerifiedMpOrder extends OrderPaymentSnapshot {
  readonly [verifiedOrderBrand]: true;
}

export function isVerifiedMpOrder(order: OrderPaymentSnapshot): order is VerifiedMpOrder {
  return verifiedOrders.has(order as VerifiedMpOrder);
}

export function orderExpiration(order: MpOrder): string | null {
  const transaction = order.transactions?.payments?.[0];
  const date = transaction?.date_of_expiration;
  if (typeof date === "string" && Number.isFinite(Date.parse(date))) return date;
  const duration = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    transaction?.expiration_time ?? ""
  );
  const created = Date.parse(order.created_date ?? "");
  if (!duration || !Number.isFinite(created)) return null;
  const seconds =
    Number(duration[1] ?? 0) * 86400 +
    Number(duration[2] ?? 0) * 3600 +
    Number(duration[3] ?? 0) * 60 +
    Number(duration[4] ?? 0);
  const expiration = created + seconds * 1000;
  return seconds > 0 && Number.isFinite(expiration) && expiration <= 8.64e15
    ? new Date(expiration).toISOString()
    : null;
}

// Parsing a POST/search response does NOT confer financial authority.
export function orderPaymentSnapshot(order: MpOrder): OrderPaymentSnapshot {
  const payments = order?.transactions?.payments;
  const transaction = payments?.[0];
  if (
    !order ||
    !/^ORD[A-Za-z0-9]+$/.test(order.id ?? "") ||
    !Array.isArray(payments) ||
    payments.length !== 1 ||
    !transaction ||
    !/^PAY[A-Za-z0-9]+$/.test(transaction.id ?? "") ||
    typeof order.status !== "string" ||
    typeof transaction.status !== "string"
  ) {
    throw new Error("RESPOSTA_ORDER_INVALIDA");
  }
  const method = transaction.payment_method;
  const rootStatus = mapOrderStatus(order.status, order.status_detail);
  const transactionStatus = mapOrderStatus(transaction.status, transaction.status_detail);
  // An observed capture remains financially inconclusive until both statuses
  // agree and local integrity is checked; it cannot authorize reserve release.
  const status =
    rootStatus === "PAGO" || transactionStatus === "PAGO"
      ? "approved"
      : rootStatus !== null && rootStatus === transactionStatus
        ? compatiblePaymentStatus(transaction.status, transaction.status_detail)
        : `unknown:${order.status}:${transaction.status}`;
  return Object.freeze({
    id: transaction.id,
    order_id: order.id,
    status,
    status_detail: transaction.status_detail ?? null,
    order_status: order.status,
    order_status_detail: order.status_detail ?? null,
    transaction_status: transaction.status,
    transaction_status_detail: transaction.status_detail ?? null,
    external_reference:
      typeof order.external_reference === "string" ? order.external_reference : null,
    total_amount: typeof order.total_amount === "string" ? order.total_amount : null,
    transaction_amount: typeof transaction.amount === "string" ? transaction.amount : null,
    paid_amount: typeof transaction.paid_amount === "string" ? transaction.paid_amount : null,
    payment_method_id: method?.id ?? null,
    payment_method_type: method?.type ?? null,
    country_code: order.country_code ?? null,
    date_approved: order.last_updated_date ?? null,
    date_of_expiration: orderExpiration(order),
    point_of_interaction: Object.freeze({
      transaction_data: Object.freeze({
        qr_code: method?.qr_code,
        qr_code_base64: method?.qr_code_base64,
        ticket_url: method?.ticket_url
      })
    })
  });
}

export async function fetchMpOrder(accessToken: string, orderId: string): Promise<VerifiedMpOrder> {
  if (!/^ORD[A-Za-z0-9]+$/.test(orderId)) throw new Error("ORDER_ID_INVALIDO");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_ORDER_GET_TIMEOUT_MS);
  try {
    const response = await fetch(`${MP_ORDERS_URL}/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Mercado Pago respondeu ${response.status}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    const order = (await response.json()) as MpOrder;
    if (order?.id !== orderId) throw new Error("RESPOSTA_MP_INVALIDA_OU_ID_DIVERGENTE");
    const snapshot = orderPaymentSnapshot(order) as VerifiedMpOrder;
    verifiedOrders.add(snapshot);
    return snapshot;
  } finally {
    clearTimeout(timer);
  }
}
