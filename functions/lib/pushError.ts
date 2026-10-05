interface SafePushError {
  category: string;
  code: string;
  status?: number;
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT"
]);

/** Only controlled labels leave this boundary; never copy external error details. */
export function sanitizePushError(error: unknown): SafePushError {
  const details =
    error !== null && typeof error === "object"
      ? (error as {
          statusCode?: unknown;
          status?: unknown;
          code?: unknown;
          name?: unknown;
          message?: unknown;
        })
      : {};
  const status = details.statusCode ?? details.status;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    const category =
      status === 404 || status === 410
        ? "SUBSCRIPTION_EXPIRED"
        : status === 429
          ? "RATE_LIMIT"
          : status >= 500
            ? "HTTP_TRANSIENT"
            : "HTTP_ERROR";
    return { category, code: `HTTP_${status}`, status };
  }

  const message = typeof details.message === "string" ? details.message : "";
  if (message.startsWith("VAPID ")) {
    return { category: "CONFIGURATION", code: "VAPID_INVALID" };
  }
  if (message.startsWith("Invalid subscription ")) {
    return { category: "CONFIGURATION", code: "SUBSCRIPTION_INVALID" };
  }
  if (details.name === "AbortError" || details.name === "TimeoutError") {
    return { category: "NETWORK", code: "TIMEOUT" };
  }
  for (const code of NETWORK_CODES) {
    if (details.code === code || new RegExp(`\\b${code}\\b`).test(message)) {
      return { category: "NETWORK", code };
    }
  }
  if (/failed to fetch|fetch failed|network|load failed/i.test(message)) {
    return { category: "NETWORK", code: "NETWORK_ERROR" };
  }
  return { category: "UNKNOWN", code: "UNKNOWN_ERROR" };
}
