import { lineTotalCents } from "./product-price.js";
export function summarizeCartItems(items = []) {
  return items.reduce(
    (summary, item) => {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      summary.items += quantity;
      summary.totalCents += lineTotalCents(item.product, quantity);
      return summary;
    },
    { items: 0, totalCents: 0 }
  );
}
