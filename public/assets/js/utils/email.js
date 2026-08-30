export function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

export function isValidEmail(value = "") {
  const email = normalizeEmail(value);
  return email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
