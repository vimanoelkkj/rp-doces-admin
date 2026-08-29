const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatBrlCents(cents = 0) {
  return BRL.format(Math.max(0, Number(cents) || 0) / 100);
}
