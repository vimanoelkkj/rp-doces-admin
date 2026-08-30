export function normalizeCustomerName(value = "") {
  return String(value).trim().replace(/\s+/g, " ").slice(0, 100);
}
export function validCustomerName(value = "") {
  const name = normalizeCustomerName(value);
  return name.length >= 2 && name.length <= 100;
}
