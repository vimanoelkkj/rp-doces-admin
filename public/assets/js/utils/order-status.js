const FAILURE = new Set(["CANCELADO", "REJEITADO", "EXPIRADO", "ERRO", "REEMBOLSADO"]);

export function normalizeOrderStatus(value = "") {
  return String(value).trim().toUpperCase();
}

export function orderPhase(status) {
  const value = normalizeOrderStatus(status);
  if (value === "PAGO") return "paid";
  if (FAILURE.has(value)) return "error";
  return "pending";
}
