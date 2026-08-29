export function stockCount(product = {}) {
  return Math.max(0, Number(product.estoque) || 0);
}
export function isProductAvailable(product = {}) {
  return product.disponivel !== false && stockCount(product) > 0;
}
export function clampQuantity(product = {}, quantity = 0) {
  return isProductAvailable(product)
    ? Math.min(stockCount(product), Math.max(0, Number(quantity) || 0))
    : 0;
}
