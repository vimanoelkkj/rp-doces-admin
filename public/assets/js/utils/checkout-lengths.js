export const CHECKOUT_LIMITS = Object.freeze({ name: 100, email: 160, whatsapp: 13, note: 500 });
export function truncateCheckoutField(field, value = "") {
  const limit = CHECKOUT_LIMITS[field];
  return limit ? String(value).slice(0, limit) : String(value);
}
