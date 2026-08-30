const formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(cents = 0) {
  return formatter.format((Number(cents) || 0) / 100);
}
