import { api } from "../api.js";
import { loadPaymentSession, clearPaymentSession } from "./payment-session.js";
import { normalizeOrderStatus, isFailedStatus, isPaidStatus } from "./payment-status.js";
export async function resumePaymentSession() {
  const saved = loadPaymentSession();
  if (!saved) return null;
  try {
    const payload = await api.getOrder(saved.token);
    const pedido = payload?.pedido || {};
    const status = normalizeOrderStatus(pedido.status);
    if (isFailedStatus(status)) {
      clearPaymentSession();
      return null;
    }
    return { token: saved.token, pix: saved.pix || null, pedido, paid: isPaidStatus(status) };
  } catch {
    return null;
  }
}
