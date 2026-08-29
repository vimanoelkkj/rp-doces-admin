const listeners = new Set();

export const state = {
  products: [],
  cart: new Map(),
  checkout: { name: "", whatsapp: "", note: "", paymentMethod: "PIX" },
  ui: { cartOpen: false }
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach(listener => listener(state));
}

export function setCartOpen(open) {
  state.ui.cartOpen = Boolean(open);
  notify();
}

export function getCartQuantity(productId) {
  return Number(state.cart.get(String(productId))) || 0;
}

export function setCartQuantity(productId, quantity) {
  const id = String(productId);
  const product = state.products.find(item => String(item.id) === id);
  if (!product) return;

  const stock = Math.max(0, Number(product.estoque) || 0);
  const available = product.disponivel !== false && stock > 0;
  const next = available ? Math.min(Math.max(0, Number(quantity) || 0), stock) : 0;

  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  if (state.cart.size === 0) state.ui.cartOpen = false;
  notify();
}

export function changeCartQuantity(productId, delta) {
  setCartQuantity(productId, getCartQuantity(productId) + Number(delta || 0));
}

export function syncCartWithProducts() {
  for (const [productId, quantity] of state.cart.entries()) {
    const product = state.products.find(item => String(item.id) === productId);
    if (!product || product.disponivel === false || Number(product.estoque) <= 0) {
      state.cart.delete(productId);
      continue;
    }
    const capped = Math.min(quantity, Number(product.estoque) || 0);
    if (capped <= 0) state.cart.delete(productId);
    else state.cart.set(productId, capped);
  }
  if (state.cart.size === 0) state.ui.cartOpen = false;
}

export function getCartItems() {
  return [...state.cart.entries()]
    .map(([productId, quantity]) => {
      const product = state.products.find(item => String(item.id) === productId);
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
