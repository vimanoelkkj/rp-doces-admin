export function orderItems(order = {}) {
  return Array.isArray(order?.data?.itens) ? order.data.itens : [];
}
export function orderQuantity(order = {}) {
  return (
    orderItems(order).reduce((sum, item) => sum + Math.max(0, Number(item.quantidade) || 0), 0) ||
    Math.max(0, Number(order?.data?.quantidade_total) || 0)
  );
}
