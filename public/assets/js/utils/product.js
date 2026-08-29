export function productStock(product = {}) {
  return Math.max(0, Number(product.estoque) || 0);
}

export function productAvailable(product = {}) {
  return product.disponivel !== false && productStock(product) > 0;
}

export function clampProductQuantity(product, quantity) {
  if (!productAvailable(product)) return 0;
  return Math.min(Math.max(0, Number(quantity) || 0), productStock(product));
}
