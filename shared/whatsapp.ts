export const WHATSAPP_BR_MAX_DIGITS = 11;

export function normalizeWhatsappBr(value: string): string {
  return value.replace(/\D/g, "").slice(0, WHATSAPP_BR_MAX_DIGITS);
}

export function isValidWhatsappBr(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d/.test(digits)) return false;
  if (digits.length === 10) return /^[1-9]\d[2-5]\d{7}$/.test(digits);
  return /^[1-9]\d9\d{8}$/.test(digits);
}

export function formatWhatsappBr(value: string): string {
  const digits = normalizeWhatsappBr(value);
  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const local = digits.slice(2);
  const split = digits.length > 10 ? 5 : 4;
  const first = local.slice(0, split);
  const second = local.slice(split);
  return `(${ddd}) ${first}${second ? `-${second}` : ""}`;
}
