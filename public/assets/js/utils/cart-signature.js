export function cartSignature(items = []) {
  return items
    .map(({ product, quantity }) => `${Number(product?.id)}:${Number(quantity)}`)
    .sort()
    .join("|");
}
