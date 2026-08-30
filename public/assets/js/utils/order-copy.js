const COPY = Object.freeze({
  EXPIRADO: "O prazo para pagar este Pix expirou.",
  REEMBOLSADO: "O pagamento deste pedido foi reembolsado.",
  CANCELADO: "Este pedido foi cancelado.",
  REJEITADO: "O pagamento não foi aprovado.",
  ERRO: "Não conseguimos confirmar o pagamento."
});
export function orderStatusCopy(status = "") {
  return COPY[String(status).trim().toUpperCase()] || "O pagamento não foi concluído.";
}
