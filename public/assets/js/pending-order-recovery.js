import { api } from "./api.js";
import { state, setOrderState, subscribe } from "./state.js";
import { startOrderPolling } from "./payment-controller.js";
import { paymentSimulationEnabled } from "./runtime-policy.js";
import { sessionGet, sessionSet, sessionRemove } from "./utils/session.js";
import { isPaidStatus, isFailedStatus, normalizeOrderStatus } from "./utils/payment-status.js";
import { syncRouteLocation } from "./utils/storefront-route.js";

const PENDING_ORDER_KEY = "rp_pending_order_token";

function validOrderToken(token) {
  return /^[0-9a-f-]{36}$/i.test(String(token || ""));
}

function clearPendingOrder() {
  sessionRemove(PENDING_ORDER_KEY);
}

function rememberCurrentOrder(currentState) {
  const order = currentState?.order || {};
  const token = String(order.token || "");

  if (order.demoState === "cancelled" || order.phase === "paid" || order.phase === "idle") {
    clearPendingOrder();
    return;
  }

  if (validOrderToken(token) && ["creating", "pending", "confirming-paid", "error"].includes(order.phase)) {
    sessionSet(PENDING_ORDER_KEY, token);
  }
}

function showCatalogRoute() {
  syncRouteLocation("catalog", { replace: true });
  const trigger = document.querySelector("[data-show-catalog]");
  if (trigger) trigger.click();
}

async function recoverPendingOrder() {
  if (paymentSimulationEnabled()) return;

  const token = sessionGet(PENDING_ORDER_KEY);
  if (!validOrderToken(token)) {
    clearPendingOrder();
    return;
  }

  try {
    const payload = await api.getOrder(token);
    const pedido = payload?.pedido || {};
    const status = normalizeOrderStatus(pedido.status);

    if (isPaidStatus(status)) {
      clearPendingOrder();
      showCatalogRoute();
      setOrderState({
        phase: "paid",
        paymentMethod: "PIX",
        token,
        data: pedido,
        pix: null,
        error: null,
        demoState: "",
        cancelPending: false,
        cancelError: null
      });
      return;
    }

    if (isFailedStatus(status) || status === "CANCELADO") {
      clearPendingOrder();
      return;
    }

    if (status !== "PENDENTE") return;

    showCatalogRoute();
    setOrderState({
      phase: "pending",
      paymentMethod: "PIX",
      token,
      data: pedido,
      pix: payload?.pix || null,
      error: null,
      demoState: "",
      cancelPending: false,
      cancelError: null
    });
    startOrderPolling(token);
  } catch (error) {
    if (error?.status === 404 || error?.status === 400) clearPendingOrder();
  }
}

subscribe(rememberCurrentOrder);
queueMicrotask(recoverPendingOrder);
