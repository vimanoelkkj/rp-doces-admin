const ALLOWED_PROPERTIES = new Set([
  "pedido_id",
  "mp_order_id",
  "status",
  "mp_status",
  "http_status",
  "reason",
  "attempts",
  "retry_after",
  "reservation_status",
  "quantity",
  "product_id",
  "duration_ms",
  "action",
  "error_message"
]);

const MAX_STRING_LENGTH = 200;

/**
 * Emite logs operacionais estruturados em JSON para o console.
 * Adota abordagem estritamente fail-closed (whitelist de propriedades escalares).
 * Rejeita qualquer objeto aninhado, array ou propriedade desconhecida para prevenir vazamento de dados sensíveis ou PII.
 */
export function logEvent(level, eventName, data = {}) {
  const safeData = {};

  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, val] of Object.entries(data)) {
      if (ALLOWED_PROPERTIES.has(key)) {
        if (typeof val === "number" && Number.isFinite(val)) {
          safeData[key] = val;
        } else if (typeof val === "boolean") {
          safeData[key] = val;
        } else if (typeof val === "string") {
          safeData[key] = val.slice(0, MAX_STRING_LENGTH);
        } else if (val === null) {
          safeData[key] = null;
        }
      }
    }
  }

  const payload = {
    ts: new Date().toISOString(),
    lvl: level,
    event: String(eventName || "unknown"),
    ...safeData
  };

  const json = JSON.stringify(payload);
  if (level === "error") {
    console.error(json);
  } else if (level === "warn") {
    console.warn(json);
  } else {
    console.log(json);
  }

  return payload;
}
