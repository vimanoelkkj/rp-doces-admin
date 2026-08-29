import { productId } from "./utils/product-id.js";
import { clampQuantity, isProductAvailable } from "./utils/stock.js";
import { summarizeCartItems } from "./utils/cart-summary.js";
import { checkoutIsValid } from "./utils/checkout-validity.js";

const listeners = new Set();
let notifyEpoch = 0;

const initialUi = () => ({
  cartOpen: false,
  checkoutOpen: false,
  menuOpen: false,
  partyOpen: false,
  cartAdditionFeedback: false
});
const initialOrder = () => ({
  phase: "idle",
  paymentMethod: "PIX",
  token: null,
  data: null,
  pix: null,
  error: null,
  demoState: "",
  cancelPending: false,
  cancelError: null
});

export const state = {
  products: [],
  productsStatus: "loading",
  cart: new Map(),
  checkout: { name: "", whatsapp: "", note: "", paymentMethod: "PIX" },
  order: initialOrder(),
  ui: initialUi()
};
function paymentInteractionLocked() {
  return state.order.phase === "creating" || state.order.cancelPending;
}
function syncPaymentInteractionLock() {
  if (typeof document === "undefined") return;
  const locked = paymentInteractionLocked();
  document.querySelectorAll("#rp-app > [data-region]").forEach(region => {
    if (region.dataset.region === "payment") return;
    region.inert = locked;
  });
}
function syncCheckoutSubmitAvailability() {
  if (typeof document === "undefined") return;
  const submit = document.querySelector("[data-submit-checkout]");
  if (!submit) return;
  const ready = checkoutIsValid(state.checkout);
  submit.disabled = !ready;
  if (ready) submit.removeAttribute("aria-disabled");
  else submit.setAttribute("aria-disabled", "true");
}
function notifyUnlessSuperseded(epoch) {
  queueMicrotask(() => {
    if (notifyEpoch === epoch) notify();
  });
}
export function resetTransientState() {
  state.ui = initialUi();
  state.order = initialOrder();
  state.productsStatus = "loading";
  syncPaymentInteractionLock();
}
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notify() {
  notifyEpoch += 1;
  listeners.forEach(listener => listener(state));
}
function closeTransientUi() {
  state.ui.menuOpen = false;
  state.ui.partyOpen = false;
}
export function setCartOpen(open) {
  state.ui.cartOpen = Boolean(open);
  if (open) {
    state.ui.checkoutOpen = false;
    closeTransientUi();
  }
  notify();
}
export function setCheckoutOpen(open) {
  state.ui.checkoutOpen = Boolean(open);
  if (open) {
    state.ui.cartOpen = false;
    closeTransientUi();
  }
  notify();
}
export function setMenuOpen(open) {
  state.ui.menuOpen = Boolean(open);
  if (open) {
    state.ui.cartOpen = false;
    state.ui.checkoutOpen = false;
    state.ui.partyOpen = false;
  }
  notify();
}
export function setPartyOpen(open) {
  state.ui.partyOpen = Boolean(open);
  if (open) {
    state.ui.cartOpen = false;
    state.ui.checkoutOpen = false;
    state.ui.menuOpen = false;
  }
  notify();
}
export function updateCheckout(field, value) {
  if (!(field in state.checkout)) return;
  state.checkout[field] = value;
  syncCheckoutSubmitAvailability();
}
export function setOrderState(patch) {
  state.order = { ...state.order, ...patch };
  syncPaymentInteractionLock();
  notify();
}
export function resetOrderState() {
  state.order = initialOrder();
  syncPaymentInteractionLock();
  notifyUnlessSuperseded(notifyEpoch);
}
export function getCartQuantity(id) {
  return Number(state.cart.get(productId(id))) || 0;
}
export function setCartQuantity(id, quantity, { additionFeedback = false } = {}) {
  const key = productId(id);
  const product = state.products.find(item => productId(item) === key);
  if (!product) return;
  const current = getCartQuantity(key);
  const next = clampQuantity(product, quantity);
  state.ui.cartAdditionFeedback = Boolean(additionFeedback && next > current);
  if (next <= 0) state.cart.delete(key);
  else state.cart.set(key, next);
  if (state.cart.size === 0) {
    state.ui.cartOpen = false;
    state.ui.checkoutOpen = false;
  }
  notify();
}
export function changeCartQuantity(id, delta) {
  const amount = Number(delta || 0);
  setCartQuantity(id, getCartQuantity(id) + amount, { additionFeedback: amount > 0 });
}
export function syncCartWithProducts() {
  for (const [id, quantity] of state.cart.entries()) {
    const product = state.products.find(item => productId(item) === id);
    if (!product || !isProductAvailable(product)) {
      state.cart.delete(id);
      continue;
    }
    const capped = clampQuantity(product, quantity);
    if (capped <= 0) state.cart.delete(id);
    else state.cart.set(id, capped);
  }
  if (state.cart.size === 0) {
    state.ui.cartOpen = false;
    state.ui.checkoutOpen = false;
  }
}
export function getCartItems() {
  return [...state.cart.entries()]
    .map(([id, quantity]) => {
      const product = state.products.find(item => productId(item) === id);
      return product ? { product, quantity } : null;
    })
    .filter(Boolean);
}
export function getCartSummary() {
  return {
    ...summarizeCartItems(getCartItems()),
    additionFeedback: state.ui.cartAdditionFeedback
  };
}
