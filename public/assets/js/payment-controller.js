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
const ORDER_PAID_TRANSITION_MS = 220;
let timer = null;
let transitionTimer = null;
let attempts = 0;
let pollingRun = 0;
export function stopOrderPolling() {
  pollingRun += 1;
  if (timer) clearTimeout(timer);
  if (transitionTimer) clearTimeout(transitionTimer);
  timer = null;
  transitionTimer = null;
  attempts = 0;
}
export function startOrderPolling(token) {
  stopOrderPolling();
  if (!token) return;
  const run = pollingRun;
  const active = () => run === pollingRun;
  const schedule = () => {
    if (!active()) return;
    timer = setTimeout(poll, ORDER_POLL_INTERVAL_MS);
  };
  const poll = async () => {
    if (!active()) return;
    if (!pageVisible()) {
      schedule();
      return;
    }
    attempts += 1;
    try {
      const payload = await api.getOrder(token);
      if (!active()) return;
      const pedido = payload.pedido || {};
      const status = normalizeOrderStatus(pedido.status);
      if (isPaidStatus(status)) {
        stopOrderPolling();
        const transitionRun = pollingRun;
        setOrderState({ phase: "confirming-paid", token, data: pedido, error: null });
        transitionTimer = setTimeout(() => {
          transitionTimer = null;
          if (transitionRun !== pollingRun) return;
          setOrderState({ phase: "paid", token, data: pedido, error: null });
        }, ORDER_PAID_TRANSITION_MS);
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
      if (!active()) return;
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
    if (active() && attempts < ORDER_POLL_MAX_ATTEMPTS) schedule();
  };
  schedule();
}
