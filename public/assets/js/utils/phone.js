export function normalizeWhatsapp(value = "") {
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

export function isValidWhatsapp(value = "") {
  const digits = normalizeWhatsapp(value);
  return digits.length >= 12 && digits.length <= 13;
}
