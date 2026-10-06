import { getRequestContext } from "./requestContext";

const SEVERITY = {
  FINANCIAL_INTEGRITY_MISMATCH: "CRITICAL",
  PAID_ORDER_STOCK_INCONSISTENT: "CRITICAL",
  PUSH_RETRY_EXHAUSTED: "WARNING",
  FINANCIAL_INTEGRITY_RESOLVED: "INFO",
  PUSH_RETRY_RECOVERED: "INFO"
} as const;
interface OperationalAlert {
  code: keyof typeof SEVERITY;
  pedidoId?: number;
  pagamentoId?: number;
  tentativas?: number;
}

// Log-only sink. Severity is policy, never supplied by callers or inferred from
// HTTP status. Explicit projection drops raw errors, tokens and extra fields.
export function operationalAlert(input: OperationalAlert): void {
  if (!Object.hasOwn(SEVERITY, input.code)) return;
  const severity = SEVERITY[input.code];
  const requestId = getRequestContext()?.requestId;
  const safeId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  const record = {
    kind: "OPERATIONAL_ALERT",
    severity,
    code: input.code,
    ...(requestId ? { requestId } : {}),
    ...(safeId(input.pedidoId) ? { pedidoId: input.pedidoId } : {}),
    ...(safeId(input.pagamentoId) ? { pagamentoId: input.pagamentoId } : {}),
    ...(Number.isSafeInteger(input.tentativas) && Number(input.tentativas) >= 0
      ? { tentativas: input.tentativas }
      : {})
  };
  try {
    console[severity === "CRITICAL" ? "error" : severity === "WARNING" ? "warn" : "info"](
      "OPERATIONAL_ALERT",
      record
    );
  } catch {
    // Telemetry failure must never interrupt financial or delivery processing.
  }
}
