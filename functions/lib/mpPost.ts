import { MP_ORDERS_URL, orderPaymentSnapshot, type OrderPaymentSnapshot } from "./mp/orders/client";
import { orderIdempotencyKey, type MpOrder } from "./mp/orders/types";
import { compatiblePaymentStatus } from "./mp/orders/status";
import {
  describeMpErrorShape,
  describeUnsupportedDetailsShape,
  type MpDetailsShape,
  type MpErrorShape
} from "./mpErrorShape";
import { extractUnsupportedPropertyPaths } from "./mpPropertyPaths";

// Orders mutation results do not carry GET financial authority.
export const MP_PAYMENTS_URL = MP_ORDERS_URL;

// O GET autoritativo do B2 tem seu próprio prazo (`MP_PAYMENT_GET_TIMEOUT_MS`).
// A criação é mais lenta que uma consulta e é a única chamada de rede entre
// "pedido persistido" e "QR na tela", então o prazo aqui é maior — e existe
// justamente para que um POST pendurado termine como AMBÍGUO recuperável em
// vez de pendurar a requisição do cliente indefinidamente.
export const MP_PAYMENT_POST_TIMEOUT_MS = 20_000;

export type MpPaymentCriado = OrderPaymentSnapshot;

export type MotivoAmbiguo =
  "TRANSPORTE" | "TIMEOUT" | "HTTP_INDISPONIVEL" | "HTTP_INDETERMINADO" | "RESPOSTA_ILEGIVEL";

export type MpPostResultado =
  | { resultado: "SUCESSO"; payment: MpPaymentCriado }
  | {
      resultado: "RECUSA_DEFINITIVA";
      httpStatus: number;
      code: string | null;
      mensagem: string | null;
      detalhe: string | null;
      requestId?: string;
      // Diagnóstico temporário: só a estrutura do corpo de erro (sem valores).
      errorShape?: MpErrorShape;
      // Diagnóstico temporário: caminhos de propriedade rejeitados em errors[].details.
      unsupportedPropertyPaths?: string[];
      // Diagnóstico temporário: só a estrutura (sem valores) de errors[].details.
      detailsShape?: MpDetailsShape;
    }
  | { resultado: "AMBIGUO"; motivo: MotivoAmbiguo; httpStatus: number | null; requestId?: string };

const SAFE_ERROR_CODE_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

function sanitizeErrorCode(val: unknown): string | null {
  return typeof val === "string" && SAFE_ERROR_CODE_REGEX.test(val) ? val : null;
}

function extractErrorCodeFromContainer(container: unknown): string | null {
  if (!container) return null;
  if (Array.isArray(container)) {
    for (const item of container) {
      const code = extractErrorCodeFromContainer(item);
      if (code) return code;
    }
    return null;
  }
  if (typeof container === "object") {
    const obj = container as Record<string, unknown>;
    const candidate =
      sanitizeErrorCode(obj.code) ?? sanitizeErrorCode(obj.error) ?? sanitizeErrorCode(obj.id);
    if (candidate) return candidate;
  }
  return null;
}

// Orders: `errors[]`. Só array, só itens objeto (sem descer em arrays aninhados e sem olhar
// `message`): vale o primeiro code/error/id válido, na ordem dos itens.
function extractErrorCodeFromErrors(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  for (const item of errors) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const code = extractErrorCodeFromContainer(item);
    if (code) return code;
  }
  return null;
}

function extractErrorCode(parsed: Record<string, unknown>): string | null {
  // Prioridade 1: parsed.error
  const fromError = sanitizeErrorCode(parsed.error);
  if (fromError) return fromError;

  // Prioridade 2: parsed.code
  const fromCode = sanitizeErrorCode(parsed.code);
  if (fromCode) return fromCode;

  // Prioridade 3: parsed.errors[] (Orders)
  const fromErrors = extractErrorCodeFromErrors(parsed.errors);
  if (fromErrors) return fromErrors;

  // Prioridade 4: cause ou details com code/error/id estruturados
  const fromCause = extractErrorCodeFromContainer(parsed.cause);
  if (fromCause) return fromCause;

  const fromDetails = extractErrorCodeFromContainer(parsed.details);
  if (fromDetails) return fromDetails;

  // Prioridade 5: parsed.message SOMENTE se a própria string já tiver formato de código
  const fromMessage = sanitizeErrorCode(parsed.message);
  if (fromMessage) return fromMessage;

  return null;
}

export async function postPagamentoMp(
  accessToken: string,
  idempotencyKey: string,
  body: unknown
): Promise<MpPostResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_POST_TIMEOUT_MS);

  // O prazo cobre a operação HTTP INTEIRA, headers e corpo (como em fetchMpPayment): um
  // corpo que nunca termina também vira AMBÍGUO/TIMEOUT, em vez de pendurar a requisição.
  try {
    let response: Response;
    try {
      response = await fetch(MP_PAYMENTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          // Estável por operação lógica (A1): um retry da MESMA intenção
          // reenvia exatamente esta key, nunca uma nova.
          "X-Idempotency-Key":
            idempotencyKey.length > 128 ? await orderIdempotencyKey(idempotencyKey) : idempotencyKey
        },
        body: JSON.stringify(body),
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
      const requestId = response.headers.get("x-request-id") || undefined;
      if (response.status >= 500 || [402, 408, 409, 423, 429].includes(response.status)) {
        return {
          resultado: "AMBIGUO",
          motivo: "HTTP_INDISPONIVEL",
          httpStatus: response.status,
          requestId
        };
      }
      if (response.status < 400) {
        return {
          resultado: "AMBIGUO",
          motivo: "HTTP_INDETERMINADO",
          httpStatus: response.status,
          requestId
        };
      }
      // O corpo do 4xx só traz diagnóstico: se travar, a decisão continua pelo STATUS.
      const corpo = await response.text().catch(() => "");
      let code: string | null = null;
      let mensagem: string | null = null;
      let detalhe: string | null = null;
      try {
        const parsed = JSON.parse(corpo) as Record<string, unknown>;
        // `mensagem` antes da extração: se `extractErrorCode` lançar (estrutura patologicamente
        // profunda em cause/details), a mensagem já lida não se perde.
        mensagem = typeof parsed.message === "string" ? parsed.message : null;
        code = extractErrorCode(parsed);
        detalhe = parsed.cause ? JSON.stringify(parsed.cause).slice(0, 500) : null;
      } catch {
        // corpo de erro não era JSON — segue sem detalhe estruturado
      }
      const errorShape = describeMpErrorShape(corpo);
      const unsupportedPropertyPaths = extractUnsupportedPropertyPaths(corpo);
      const detailsShape = describeUnsupportedDetailsShape(corpo);
      return {
        resultado: "RECUSA_DEFINITIVA",
        httpStatus: response.status,
        code,
        mensagem,
        detalhe,
        requestId,
        ...(errorShape && { errorShape }),
        ...(unsupportedPropertyPaths.length > 0 && { unsupportedPropertyPaths }),
        ...(detailsShape && { detailsShape })
      };
    }

    let payment: MpPaymentCriado | null = null;
    try {
      payment = orderPaymentSnapshot((await response.json()) as MpOrder);
    } catch {
      // Abort durante o corpo é o prazo estourado: o provedor já respondeu 2xx, então o
      // recurso pode existir e o resultado segue AMBÍGUO. Qualquer outra falha segue ilegível.
      if (controller.signal.aborted) {
        return { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: response.status };
      }
      payment = null;
    }
    // 2xx sem `id` utilizável é ambíguo, não sucesso: o recurso pode existir
    // do outro lado e nós não conseguimos nomeá-lo.
    if (!payment) {
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    }
    return { resultado: "SUCESSO", payment };
  } finally {
    clearTimeout(prazo);
  }
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
  idempotencyKey?: string
): Promise<MpCancelResultado> {
  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_POST_TIMEOUT_MS);

  // Mesmo prazo único para headers e corpo (ver postPagamentoMp).
  try {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      };
      if (idempotencyKey) {
        headers["X-Idempotency-Key"] =
          idempotencyKey.length > 128 ? await orderIdempotencyKey(idempotencyKey) : idempotencyKey;
      }
      response = await fetch(`${MP_PAYMENTS_URL}/${encodeURIComponent(String(paymentId))}/cancel`, {
        method: "POST",
        headers,
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
      const order = (await response.json()) as MpOrder;
      if (order?.id !== String(paymentId)) throw new Error("ORDER_ID_DIVERGENTE");
      payment = {
        status: compatiblePaymentStatus(order.status, order.status_detail),
        status_detail: order.status_detail ?? undefined
      };
    } catch {
      if (controller.signal.aborted) {
        return { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: response.status };
      }
      payment = null;
    }

    if (!payment || typeof payment.status !== "string") {
      return { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: response.status };
    }

    return {
      resultado: "SUCESSO",
      status: payment.status,
      statusDetail: payment.status_detail ?? null
    };
  } finally {
    clearTimeout(prazo);
  }
}
