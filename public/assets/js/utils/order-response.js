import { isPaidStatus } from "./payment-status.js";
export function normalizeOrderResponse(payload = {}) {
  const pedido = payload?.pedido || {};
  const token = pedido.token || null;
  return { pedido, pix: payload?.pix || null, token, paid: isPaidStatus(pedido.status) };
}
