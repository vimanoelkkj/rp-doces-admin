export function normalizeCustomerWhatsapp(value = "") {
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.slice(0, 13);
}
export function validCustomerWhatsapp(value = "") {
  const digits = normalizeCustomerWhatsapp(value);
  return digits.length >= 12 && digits.length <= 13;
}
