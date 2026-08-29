export function parsePixExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function isPixExpired(value, now = Date.now()) {
  const date = parsePixExpiry(value);
  return date ? date.getTime() <= now : false;
}
export function formatPixExpiry(value) {
  const date = parsePixExpiry(value);
  return date ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
}
