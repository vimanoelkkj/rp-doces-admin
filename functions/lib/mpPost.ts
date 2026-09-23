/// <reference types="@cloudflare/workers-types" />

// A1 — POST de criação de pagamento no Mercado Pago (Payments API; NÃO
// Orders API, decisão deliberada do projeto) com classificação explícita da
// ambiguidade.
//
// A investigação A1 encontrou que um POST não-2xx era tratado como recusa
// DEFINITIVA: um HTTP 500 simulado levava a `FALHOU` e liberação de reserva.
// Isso é diferente do cuidado que o GET autoritativo do B2 já tinha. Uma
// resposta 5xx (ou um timeout, ou um corpo ilegível) NÃO prova que o
// provedor deixou de criar a cobrança.
//
// Este módulo separa três resultados e nada mais — não amplia a matriz de
// transições do B2, não inventa aprovação nem rejeição, não faz reenvio
// automático:
//
//   SUCESSO ............ corpo 2xx com `id` numérico utilizável.
//   RECUSA_DEFINITIVA .. o provedor respondeu e recusou de forma
//                        comprovada (4xx de negócio/validação).
//   AMBIGUO ............ não é possível provar se o recurso remoto existe.
//
// 408 e 429 são tratados como AMBÍGUOS mesmo sendo 4xx: nenhum dos dois
// prova que o pagamento não foi criado do outro lado.

export const MP_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments";

// O GET autoritativo do B2 tem seu próprio prazo (`MP_PAYMENT_GET_TIMEOUT_MS`).
// A criação é mais lenta que uma consulta e é a única chamada de rede entre
// "pedido persistido" e "QR na tela", então o prazo aqui é maior — e existe
// justamente para que um POST pendurado termine como AMBÍGUO recuperável em
// vez de pendurar a requisição do cliente indefinidamente.
export const MP_PAYMENT_POST_TIMEOUT_MS = 20_000;

export interface MpPaymentCriado {
  id: number;
  status: string;
  date_of_expiration: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

export type MotivoAmbiguo =
  | "TRANSPORTE"
  | "TIMEOUT"
  | "HTTP_INDISPONIVEL"
  | "HTTP_INDETERMINADO"
  | "RESPOSTA_ILEGIVEL";

export type MpPostResultado =
  | { resultado: "SUCESSO"; payment: MpPaymentCriado }
  | {
      resultado: "RECUSA_DEFINITIVA";
      httpStatus: number;
      mensagem: string | null;
      detalhe: string | null;
    }
  | { resultado: "AMBIGUO"; motivo: MotivoAmbiguo; httpStatus: number | null };

export async function postPagamentoMp(
  accessToken: string,
  idempotencyKey: string,
  body: unknown,
): Promise<MpPostResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_POST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(MP_PAYMENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Estável por operação lógica (A1): um retry da MESMA intenção
        // reenvia exatamente esta key, nunca uma nova.
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
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

  let payment: MpPaymentCriado | null = null;
  try {
    payment = (await response.json()) as MpPaymentCriado;
  } catch {
    payment = null;
  }
  // 2xx sem `id` utilizável é ambíguo, não sucesso: o recurso pode existir
  // do outro lado e nós não conseguimos nomeá-lo.
  if (!payment || !Number.isFinite(Number(payment.id)) || Number(payment.id) <= 0) {
    return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
  }
  return { resultado: "SUCESSO", payment };
}

export type MpCancelResultado =
  | { resultado: "SUCESSO"; status: string; statusDetail: string | null }
  | {
      resultado: "RECUSA_DEFINITIVA";
      httpStatus: number;
      mensagem: string | null;
      detalhe: string | null;
    }
  | { resultado: "AMBIGUO"; motivo: MotivoAmbiguo; httpStatus: number | null };

export async function cancelarPagamentoMp(
  accessToken: string,
  paymentId: string | number,
  idempotencyKey?: string,
): Promise<MpCancelResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_POST_TIMEOUT_MS);

  let response: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (idempotencyKey) {
      headers["X-Idempotency-Key"] = idempotencyKey;
    }
    response = await fetch(`${MP_PAYMENTS_URL}/${encodeURIComponent(String(paymentId))}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "cancelled" }),
      signal: controller.signal,
    });
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
      // corpo de erro não era JSON
    }
    return { resultado: "RECUSA_DEFINITIVA", httpStatus: response.status, mensagem, detalhe };
  }

  let payment: { status?: string; status_detail?: string } | null = null;
  try {
    payment = (await response.json()) as { status?: string; status_detail?: string };
  } catch {
    payment = null;
  }

  if (!payment || typeof payment.status !== "string") {
    return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
  }

  return {
    resultado: "SUCESSO",
    status: payment.status,
    statusDetail: payment.status_detail ?? null,
  };
}
