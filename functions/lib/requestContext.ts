import { AsyncLocalStorage } from "node:async_hooks";
import { sanitizePushError } from "./pushError";
import {
  sanitizeMpDetailsShape,
  sanitizeMpErrorShape,
  type MpDetailsShape,
  type MpErrorShape
} from "./mpErrorShape";
import { sanitizePropertyPaths } from "./mpPropertyPaths";
import {
  sanitizeWebhookSignatureShape,
  type WebhookSignatureShape
} from "./mpWebhookSignatureShape";

interface RequestContext {
  readonly requestId: string;
  readonly source: "cloudflare" | "generated";
}
// The storage instance is shared; its immutable store is isolated per async
// execution. Never use enterWith or a mutable global current-request variable.
const requestStorage = new AsyncLocalStorage<Readonly<RequestContext>>();

export function getRequestContext(): Readonly<RequestContext> | undefined {
  return requestStorage.getStore();
}

export function withRequestContext<T>(request: Request, action: () => T): T {
  const existing = getRequestContext();
  if (existing) return action();
  const ray = request.headers.get("cf-ray");
  // cf metadata is supplied by the runtime, not by an HTTP client. Do not
  // reuse client X-Request-Id (also part of Mercado Pago webhook signatures).
  const trustedRay = Boolean(request.cf?.colo && ray && /^[a-f0-9]{16}-[A-Z]{3}$/.test(ray));
  const requestId =
    trustedRay && ray
      ? `cf-${ray.toLowerCase()}`
      : `req-${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return requestStorage.run(
    Object.freeze({ requestId, source: trustedRay ? "cloudflare" : "generated" }),
    action
  );
}

export function logRequestEvent(event: string, status?: number): void {
  const context = getRequestContext();
  if (context)
    console.info(event, {
      requestId: context.requestId,
      ...(status === undefined ? {} : { status })
    });
}

export interface SafeOperationalMeta {
  readonly httpStatus?: number | null;
  readonly mpRequestId?: string | null;
  readonly motivo?: string | null;
  readonly code?: string | null;
  readonly mpErrorShape?: MpErrorShape | null;
  readonly unsupportedPropertyPaths?: readonly string[];
  readonly detailsShape?: MpDetailsShape | null;
  readonly webhookSignature?: WebhookSignatureShape;
}

const ALLOWED_MOTIVOS = new Set([
  "TRANSPORTE",
  "TIMEOUT",
  "HTTP_INDISPONIVEL",
  "HTTP_INDETERMINADO",
  "RESPOSTA_ILEGIVEL"
]);

const SAFE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_MP_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Filtro rigoroso com allowlist explícita para metadados operacionais.
 * Somente tipos primitivos seguros e campos conhecidos são mantidos.
 * Rejeita qualquer vazamento de tokens, headers, cookies, payloads ou dados sensíveis.
 */
export function sanitizeOperationalMeta(raw: unknown): SafeOperationalMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Object.freeze({});
  }

  const input = raw as Record<string, unknown>;
  const clean: {
    httpStatus?: number | null;
    mpRequestId?: string | null;
    motivo?: string | null;
    code?: string | null;
    mpErrorShape?: MpErrorShape | null;
    unsupportedPropertyPaths?: string[];
    detailsShape?: MpDetailsShape | null;
    webhookSignature?: WebhookSignatureShape;
  } = {};

  if (typeof input.httpStatus === "number" && Number.isInteger(input.httpStatus)) {
    clean.httpStatus = input.httpStatus;
  } else if (input.httpStatus === null) {
    clean.httpStatus = null;
  }

  if (typeof input.mpRequestId === "string" && SAFE_MP_REQUEST_ID_PATTERN.test(input.mpRequestId)) {
    clean.mpRequestId = input.mpRequestId;
  } else if (input.mpRequestId === null) {
    clean.mpRequestId = null;
  }

  if (typeof input.motivo === "string" && ALLOWED_MOTIVOS.has(input.motivo)) {
    clean.motivo = input.motivo;
  } else if (input.motivo === null) {
    clean.motivo = null;
  }

  if (typeof input.code === "string" && SAFE_CODE_PATTERN.test(input.code)) {
    clean.code = input.code;
  } else if (input.code === null) {
    clean.code = null;
  }

  const mpErrorShape = sanitizeMpErrorShape(input.mpErrorShape);
  if (mpErrorShape) {
    clean.mpErrorShape = mpErrorShape;
  } else if (input.mpErrorShape === null) {
    clean.mpErrorShape = null;
  }

  if (Array.isArray(input.unsupportedPropertyPaths)) {
    clean.unsupportedPropertyPaths = sanitizePropertyPaths(input.unsupportedPropertyPaths);
  }

  const detailsShape = sanitizeMpDetailsShape(input.detailsShape);
  if (detailsShape) {
    clean.detailsShape = detailsShape;
  } else if (input.detailsShape === null) {
    clean.detailsShape = null;
  }

  const webhookSignature = sanitizeWebhookSignatureShape(input.webhookSignature);
  if (webhookSignature) clean.webhookSignature = webhookSignature;

  return Object.freeze(clean);
}

function log(level: "error" | "warn", message: string, args: unknown[]): void {
  const context = getRequestContext();
  if (!context) {
    // Preserve existing standalone/background behavior and diagnostics.
    console[level](message, ...args);
    return;
  }
  // No request URL, headers, cookie, body, identifiers or raw error messages.
  console[level](message, { requestId: context.requestId, error: sanitizePushError(args.at(-1)) });
}

function logMeta(level: "error" | "warn", message: string, meta: unknown): void {
  const context = getRequestContext();
  const safeMeta = sanitizeOperationalMeta(meta);
  const payload = {
    ...(context ? { requestId: context.requestId } : {}),
    ...safeMeta
  };
  console[level](message, payload);
}

export const requestLogger = {
  error: (message: string, ...args: unknown[]) => log("error", message, args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, args),
  errorMeta: (message: string, meta: SafeOperationalMeta | unknown) =>
    logMeta("error", message, meta),
  warnMeta: (message: string, meta: SafeOperationalMeta | unknown) => logMeta("warn", message, meta)
};
