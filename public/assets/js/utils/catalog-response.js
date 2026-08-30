export function catalogProducts(payload = {}) {
  return Array.isArray(payload?.produtos) ? payload.produtos.filter(Boolean) : [];
}
