export const ORDER_PHASES = Object.freeze({
  IDLE: "idle",
  CREATING: "creating",
  PENDING: "pending",
  PAID: "paid",
  ERROR: "error"
});
export function isOrderOverlayOpen(order = {}) {
  return Boolean(order && order.phase && order.phase !== ORDER_PHASES.IDLE);
}
export function isOrderBusy(order = {}) {
  return order?.phase === ORDER_PHASES.CREATING || order?.phase === ORDER_PHASES.PENDING;
}
