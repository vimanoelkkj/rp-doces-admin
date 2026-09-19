/// <reference types="@cloudflare/workers-types" />

// POST de estorno no Mercado Pago (Payments API: /v1/payments/{id}/refunds).
//
// Espelha exatamente a classificação de `mpPost.ts` (SUCESSO / RECUSA_DEFINITIVA
// / AMBIGUO) — não amplia a matriz, só troca o endpoint e o corpo enviado. Um
// 5xx/408/429/timeout/transporte nunca prova que o estorno não aconteceu do
// outro lado; por isso continua AMBIGUO, nunca vira sucesso nem recusa.

export const MP_REFUND_TIMEOUT_MS = 20_000;

export interface MpRefundCriado {
  id: number;
  payment_id: number;
  amount?: number;
  status: string;
}

export interface MpRefundOptions {
  amountCentavos?: number;
  renderInProcess?: boolean;
}

export type MotivoAmbiguoRefund =
  | "TRANSPORTE"
  | "TIMEOUT"
  | "HTTP_INDISPONIVEL"
  | "HTTP_INDETERMINADO"
  | "RESPOSTA_ILEGIVEL";

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
  paymentId: string,
  idempotencyKey: string,
  options: MpRefundOptions = {},
): Promise<MpRefundResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_REFUND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          // Estável por operação lógica: um retry da MESMA intenção reenvia
          // exatamente esta key, nunca uma nova (mesmo padrão de mpPost.ts).
          "X-Idempotency-Key": idempotencyKey,
          ...(options.renderInProcess ? { "X-Render-In-Process-Refunds": "true" } : {}),
        },
        ...(options.amountCentavos === undefined
          ? {}
          : { body: JSON.stringify({ amount: options.amountCentavos / 100 }) }),
        signal: controller.signal,
      },
    );
  } catch {
    const expirou = controller.signal.aborted;
    return {
      resultado: "AMBIGUO",
      motivo: expirou ? "TIMEOUT" : "TRANSPORTE",
      httpStatus: null,
    };
  } finally {
    clearTimeout(prazo);
  }

  if (!response.ok) {
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      return { resultado: "AMBIGUO", motivo: "HTTP_INDISPONIVEL", httpStatus: response.status };
    }
    if (response.status < 400) {
      return { resultado: "AMBIGUO", motivo: "HTTP_INDETERMINADO", httpStatus: response.status };
    }
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
    refund = (await response.json()) as MpRefundCriado;
  } catch {
    refund = null;
  }
  // 2xx sem `id` utilizável é ambíguo, não sucesso: o recurso pode existir
  // do outro lado e nós não conseguimos nomeá-lo.
  if (!refund || !Number.isFinite(Number(refund.id)) || Number(refund.id) <= 0) {
    return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
  }
  if (options.amountCentavos !== undefined && (
    String(refund.payment_id) !== paymentId
    || !Number.isFinite(Number(refund.amount))
    || Math.round(Number(refund.amount) * 100) !== options.amountCentavos
    || typeof refund.status !== "string"
    || refund.status.trim() === ""
  )) {
    return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
  }
  return { resultado: "SUCESSO", refund };
}

export async function getRefundMp(
  accessToken: string,
  paymentId: string,
  refundId: string,
  amountCentavos: number,
): Promise<MpRefundResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_REFUND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal },
    );
  } catch {
    return { resultado: "AMBIGUO", motivo: controller.signal.aborted ? "TIMEOUT" : "TRANSPORTE", httpStatus: null };
  } finally {
    clearTimeout(prazo);
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      return { resultado: "AMBIGUO", motivo: "HTTP_INDISPONIVEL", httpStatus: response.status };
    }
    const corpo = await response.text().catch(() => "");
    let mensagem: string | null = null;
    let detalhe: string | null = null;
    try {
      const parsed = JSON.parse(corpo) as { message?: string; cause?: unknown };
      mensagem = parsed.message ?? null;
      detalhe = parsed.cause ? JSON.stringify(parsed.cause).slice(0, 500) : null;
    } catch { /* resposta sem diagnostico estruturado */ }
    return { resultado: "RECUSA_DEFINITIVA", httpStatus: response.status, mensagem, detalhe };
  }
  let refund: MpRefundCriado | null = null;
  try { refund = (await response.json()) as MpRefundCriado; } catch { refund = null; }
  if (!refund || String(refund.id) !== refundId || String(refund.payment_id) !== paymentId
      || !Number.isFinite(Number(refund.amount))
      || Math.round(Number(refund.amount) * 100) !== amountCentavos
      || typeof refund.status !== "string" || refund.status.trim() === "") {
    return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
  }
  return { resultado: "SUCESSO", refund };
}
