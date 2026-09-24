/// <reference types="@cloudflare/workers-types" />

// A marca privada só nasce no GET abaixo. Payloads e metadados persistidos
// não satisfazem este contrato, inclusive em runtime. Não é estado no banco.
const MP_GET_VERIFIED = Symbol("MP_GET_VERIFIED");

// Identidade fraca, sem cache de dados nem retenção entre requisições.
// Copiar um objeto verificado e trocar status/id não transfere autoridade.
const verifiedMpResponses = new WeakSet<MpPaymentResponse>();

export interface MpPaymentResponse {
  readonly id: number | string;
  readonly status: string;
  readonly status_detail?: string | null;
  readonly date_approved?: string | null;
  readonly external_reference?: string | null;
  readonly [MP_GET_VERIFIED]: true;
}

export function isVerifiedMpResponse(mp: MpPaymentResponse): boolean {
  return verifiedMpResponses.has(mp);
}

// Não havia timeout de GET MP no projeto. Um único limite inclui leitura
// do corpo e evita prender polling/lote administrativo por tempo indefinido.
export const MP_PAYMENT_GET_TIMEOUT_MS = 5000;

export async function fetchMpPayment(accessToken: string, paymentId: string): Promise<MpPaymentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_PAYMENT_GET_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error(`Mercado Pago respondeu ${response.status}`) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const payment = await response.json() as Omit<MpPaymentResponse, typeof MP_GET_VERIFIED>;
    if (!payment || String(payment.id) !== paymentId || typeof payment.status !== "string" || !payment.status) {
      throw new Error("RESPOSTA_MP_INVALIDA_OU_ID_DIVERGENTE");
    }
    const verified = Object.freeze({
      id: payment.id, status: payment.status,
      status_detail: payment.status_detail, date_approved: payment.date_approved,
      external_reference: payment.external_reference,
      [MP_GET_VERIFIED]: true as const,
    });
    verifiedMpResponses.add(verified);
    return verified;
  } finally {
    clearTimeout(timer);
  }
}
