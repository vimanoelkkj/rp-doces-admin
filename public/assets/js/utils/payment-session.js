import { sessionGet, sessionSet, sessionRemove } from "./session.js";
import { parseJson, stringifyJson } from "./safe-json.js";
const KEY = "rp_active_order";
export function savePaymentSession(order = {}) {
  if (!order?.token) return false;
  return sessionSet(KEY, stringifyJson({ token: order.token, pix: order.pix || null }));
}
export function loadPaymentSession() {
  const value = parseJson(sessionGet(KEY), null);
  return value?.token ? value : null;
}
export function clearPaymentSession() {
  return sessionRemove(KEY);
}
