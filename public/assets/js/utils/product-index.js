export function indexProducts(products = []) {
  return new Map(products.filter(Boolean).map(product => [String(product.id), product]));
}
export function findIndexedProduct(index, id) {
  return index instanceof Map ? index.get(String(id)) || null : null;
}
