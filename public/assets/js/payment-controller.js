import { api } from "./api.js";
import { setOrderState } from "./state.js";
import {
  ORDER_POLL_INTERVAL_MS,
  ORDER_POLL_MAX_ATTEMPTS,
  pollingExhausted
} from "./utils/polling-policy.js";
import { isPaidStatus, isFailedStatus, normalizeOrderStatus } from "./utils/payment-status.js";
import { orderStatusCopy } from "./utils/order-copy.js";
import { pageVisible } from "./utils/visibility.js";
let timer = null;
let attempts = 0;
export function stopOrderPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
  attempts = 0;
}
export function startOrderPolling(token) {
  stopOrderPolling();
  if (!token) return;
  const schedule = () => {
    timer = setTimeout(poll, ORDER_POLL_INTERVAL_MS);
  };
  const poll = async () => {
    if (!pageVisible()) {
      schedule();
      return;
    }
    attempts += 1;
    try {
      const payload = await api.getOrder(token);
      const pedido = payload.pedido || {};
      const status = normalizeOrderStatus(pedido.status);
      if (isPaidStatus(status)) {
        setOrderState({ phase: "paid", token, data: pedido, error: null });
        stopOrderPolling();
        return;
      }
      if (isFailedStatus(status)) {
        setOrderState({ phase: "error", token, data: pedido, error: orderStatusCopy(status) });
        stopOrderPolling();
        return;
      }
      if (pollingExhausted(attempts)) {
        setOrderState({
          phase: "error",
          token,
          data: pedido,
          error:
            "A confirmação está demorando mais que o esperado. Você pode tentar consultar novamente."
        });
        stopOrderPolling();
        return;
      }
      setOrderState({ phase: "pending", token, data: pedido, error: null });
    } catch {
      if (pollingExhausted(attempts)) {
        setOrderState({
          phase: "error",
          token,
          error: "Não conseguimos confirmar o pagamento agora."
        });
        stopOrderPolling();
        return;
      }
    }
    if (attempts < ORDER_POLL_MAX_ATTEMPTS) schedule();
  };
  schedule();
}
