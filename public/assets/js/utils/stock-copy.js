export function stockCopy(product = {}) {
  const stock = Math.max(0, Number(product.estoque) || 0);
  if (product.disponivel === false || stock === 0) return "Indisponível";
  if (stock === 1) return "Última unidade";
  if (stock <= 3) return `Só ${stock} unidades`;
  return "Disponível";
}
