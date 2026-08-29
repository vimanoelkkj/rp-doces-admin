export function productName(product = {}) {
  return String(product.nome || "Doce artesanal").trim();
}
export function productDescription(product = {}) {
  return String(product.descricao || "Feito à mão pela R&P Doces.").trim();
}
export function productEmoji(product = {}) {
  return String(product.emoji || "🍰").trim();
}
