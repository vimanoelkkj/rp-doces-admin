const COPY = Object.freeze({
  limits: "Seu carrinho ultrapassou o limite permitido para um pedido.",
  customer: "Revise nome, e-mail e WhatsApp antes de continuar.",
  payment: "Esta forma de pagamento ainda não está disponível."
});
export function checkoutReadinessMessage(reason) {
  return COPY[reason] || "Revise os dados do pedido antes de continuar.";
}
