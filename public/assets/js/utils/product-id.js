export function productId(value) {
  return String(value?.id ?? value ?? "").trim();
}
export function sameProductId(a, b) {
  const left = productId(a);
  const right = productId(b);
  return Boolean(left && right && left === right);
}
