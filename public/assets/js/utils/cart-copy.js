export function cartSummaryCopy(items = 0) {
  const count = Math.max(0, Number(items) || 0);
  if (!count) return "Seu carrinho está vazio";
  return count === 1 ? "1 item no pedido" : `${count} itens no pedido`;
}
