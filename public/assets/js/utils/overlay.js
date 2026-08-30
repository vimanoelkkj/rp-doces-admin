export function hasOpenUiOverlay(ui = {}) {
  return Boolean(ui.cartOpen || ui.checkoutOpen || ui.menuOpen || ui.partyOpen);
}
export function hasOpenOverlay(state = {}) {
  return hasOpenUiOverlay(state.ui) || (state.order?.phase && state.order.phase !== "idle");
}
