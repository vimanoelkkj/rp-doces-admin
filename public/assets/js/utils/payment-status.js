export const PAID_STATUSES = new Set(["PAGO"]);
export const FAILED_STATUSES = new Set([
  "CANCELADO",
  "REJEITADO",
  "EXPIRADO",
  "ERRO",
  "REEMBOLSADO"
]);
export function normalizeOrderStatus(value = "") {
  return String(value).trim().toUpperCase();
}
export function isPaidStatus(value) {
  return PAID_STATUSES.has(normalizeOrderStatus(value));
}
export function isFailedStatus(value) {
  return FAILED_STATUSES.has(normalizeOrderStatus(value));
}
