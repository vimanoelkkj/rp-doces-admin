const listeners = new Set();

export const state = {
  products: [],
  cart: new Map(),
  checkout: { name: "", whatsapp: "", note: "", paymentMethod: "PIX" }
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  listeners.forEach(listener => listener(state));
}
