import { AsyncLocalStorage } from "node:async_hooks";
import { sanitizePushError } from "./pushError";

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
export const requestLogger = {
  error: (message: string, ...args: unknown[]) => log("error", message, args),
  warn: (message: string, ...args: unknown[]) => log("warn", message, args)
};
