export function normalizeCustomerEmail(value = "") {
  return String(value).trim().toLowerCase().slice(0, 160);
}
export function validCustomerEmail(value = "") {
  const email = normalizeCustomerEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
