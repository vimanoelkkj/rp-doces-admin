export function paymentMode() {
  return (
    document.querySelector('meta[name="rp-payment-mode"]')?.content?.trim().toLowerCase() ||
    "enabled"
  );
}
export function paymentCreationAllowed() {
  return ["enabled", "disabled"].includes(paymentMode());
}
export function paymentSimulationEnabled() {
  return paymentMode() === "disabled";
}
export function paymentDisabledMessage() {
  return "Checkout indisponível neste ambiente.";
}
