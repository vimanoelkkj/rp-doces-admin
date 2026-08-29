const CART_STORAGE_KEY = "rp-storefront-cart-v1";

function storageAvailable() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadStoredCart() {
  if (!storageAvailable()) return new Map();

  try {
    const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return new Map();

    return new Map(
      stored
        .map(([id, quantity]) => [String(id), Math.max(0, Math.trunc(Number(quantity) || 0))])
        .filter(([id, quantity]) => id && quantity > 0)
    );
  } catch {
    return new Map();
  }
}

export function saveStoredCart(cart) {
  if (!storageAvailable()) return;

  try {
    const entries = [...cart.entries()].filter(([, quantity]) => Number(quantity) > 0);
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable in private/restricted browsing contexts.
  }
}
