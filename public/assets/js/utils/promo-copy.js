import { promotionSavingsCents } from "./promotion.js";
import { formatBrlCents } from "./currency.js";
export function promotionBadge(product = {}) {
  const savings = promotionSavingsCents(product);
  return savings > 0 ? `Economize ${formatBrlCents(savings)}` : "";
}
