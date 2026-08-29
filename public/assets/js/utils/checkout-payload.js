import { normalizeQuantity } from "./quantity.js";

export function checkoutLineItems(items = []) {
  return items
    .map(({ product, quantity }) => ({
      produto_id: Number(product?.id),
      quantidade: normalizeQuantity(quantity)
    }))
    .filter(
      item => Number.isInteger(item.produto_id) && item.produto_id > 0 && item.quantidade > 0
    );
}
