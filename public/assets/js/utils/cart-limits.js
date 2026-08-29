export const MAX_DISTINCT_PRODUCTS = 20;
export const MAX_TOTAL_UNITS = 50;
export function cartUnitCount(items = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
}
export function cartWithinCheckoutLimits(items = []) {
  return items.length <= MAX_DISTINCT_PRODUCTS && cartUnitCount(items) <= MAX_TOTAL_UNITS;
}
