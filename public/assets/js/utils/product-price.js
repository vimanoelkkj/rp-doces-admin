export function productPriceCents(product = {}) {
  return Math.max(0, Number(product.preco_centavos) || 0);
}
export function productOriginalPriceCents(product = {}) {
  return Math.max(0, Number(product.preco_original_centavos) || 0);
}
export function lineTotalCents(product = {}, quantity = 0) {
  return productPriceCents(product) * Math.max(0, Number(quantity) || 0);
}
