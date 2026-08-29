export function paymentMode() {
  return (
    document.querySelector('meta[name="rp-payment-mode"]')?.content?.trim().toLowerCase() ||
    "enabled"
  );
}
export function paymentCreationAllowed() {
  return paymentMode() === "enabled";
}
export function paymentDisabledMessage() {
  return "Checkout real desativado nesta prévia para não criar pedidos ou cobranças reais.";
}
