export function compareProducts(a = {}, b = {}) {
  const featured = Number(Boolean(b.destaque)) - Number(Boolean(a.destaque));
  if (featured) return featured;
  return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" });
}
export function sortProducts(products = []) {
  return [...products].sort(compareProducts);
}
