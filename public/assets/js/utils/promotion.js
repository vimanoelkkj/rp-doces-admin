export function hasActivePromotion(product = {}) {
  const current = Number(product.preco_centavos) || 0;
  const original = Number(product.preco_original_centavos) || 0;
  return product.promocao_vigente === true && original > current && current > 0;
}
export function promotionSavingsCents(product = {}) {
  return hasActivePromotion(product)
    ? Number(product.preco_original_centavos) - Number(product.preco_centavos)
    : 0;
}
