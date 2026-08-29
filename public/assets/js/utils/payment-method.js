export const PAYMENT_METHODS = Object.freeze({ PIX: "PIX", CARD: "CARD" });
export function normalizePaymentMethod(value) {
  const method = String(value || "")
    .trim()
    .toUpperCase();
  return method === PAYMENT_METHODS.CARD ? PAYMENT_METHODS.CARD : PAYMENT_METHODS.PIX;
}
export function isPixPayment(value) {
  return normalizePaymentMethod(value) === PAYMENT_METHODS.PIX;
}
