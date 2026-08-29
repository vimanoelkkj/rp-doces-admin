import { productId } from "./utils/product-id.js";
import { clampQuantity, isProductAvailable } from "./utils/stock.js";

const listeners = new Set();

export const state = {
  products: [],
  productsStatus: "loading",
  cart: new Map(),
  checkout: { name: "", email: "", whatsapp: "", note: "", paymentMethod: "PIX" },
  order: { phase: "idle", token: null, data: null, pix: null, error: null },
  ui: { cartOpen: false, checkoutOpen: false, menuOpen: false, partyOpen: false }
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notify() {
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
}
export function setOrderState(patch) {
  state.order = { ...state.order, ...patch };
  notify();
}
export function resetOrderState() {
  state.order = { phase: "idle", token: null, data: null, pix: null, error: null };
  notify();
}
export function getCartQuantity(id) {
  return Number(state.cart.get(productId(id))) || 0;
}
export function setCartQuantity(id, quantity) {
  const key = productId(id);
  const product = state.products.find(item => productId(item) === key);
  if (!product) return;
  const next = clampQuantity(product, quantity);
  if (next <= 0) state.cart.delete(key);
  else state.cart.set(key, next);
  if (state.cart.size === 0) {
    state.ui.cartOpen = false;
    state.ui.checkoutOpen = false;
  }
  notify();
}
export function changeCartQuantity(id, delta) {
  setCartQuantity(id, getCartQuantity(id) + Number(delta || 0));
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
  let items = 0;
  let totalCents = 0;
  for (const { product, quantity } of getCartItems()) {
    items += quantity;
    totalCents += (Number(product.preco_centavos) || 0) * quantity;
  }
  return { items, totalCents };
}
