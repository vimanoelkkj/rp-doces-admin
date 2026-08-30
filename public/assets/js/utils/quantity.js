export function normalizeQuantity(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
export function addQuantity(current, delta) {
  return normalizeQuantity(normalizeQuantity(current) + Number(delta || 0));
}
export function pluralizeItems(quantity) {
  const value = normalizeQuantity(quantity);
  return `${value} ${value === 1 ? "item" : "itens"}`;
}
