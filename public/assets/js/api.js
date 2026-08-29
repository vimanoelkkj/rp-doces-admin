import { API_PATHS, orderCancelPath, orderPath } from "./utils/api-path.js";
import { timeoutSignal } from "./utils/fetch-timeout.js";
async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    signal: options.signal || timeoutSignal(),
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.erro || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
export const api = {
  getConfig: () => request("/api/config", { cache: "no-store" }),
  getProducts: () => request(API_PATHS.products, { cache: "no-store" }),
  createPixCheckout: payload => postJson(API_PATHS.checkoutPix, payload),
  getOrder: token => request(orderPath(token), { cache: "no-store" }),
  cancelOrder: token => request(orderCancelPath(token), { method: "POST" })
};
