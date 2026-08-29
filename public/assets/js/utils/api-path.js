export const API_PATHS = Object.freeze({
  products: "/api/products",
  checkoutPix: "/api/checkout/pix"
});
export function orderPath(token) {
  return `/api/orders/${encodeURIComponent(String(token || ""))}`;
}
