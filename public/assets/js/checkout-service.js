import { api } from "./api.js";

const REQUEST_KEY = "rp_checkout_request_id";
const CART_KEY = "rp_checkout_cart_signature";

function cartSignature(items = []) {
  return items
    .map(({ product, quantity }) => `${Number(product.id)}:${Number(quantity)}`)
    .sort()
    .join("|");
}

function fallbackRequestId() {
  const random = Math.random().toString(36).slice(2);
  return `rp_${Date.now().toString(36)}_${random}`.slice(0, 64);
}

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || fallbackRequestId();
}

function requestId(items) {
  const signature = cartSignature(items);
  let id = sessionStorage.getItem(REQUEST_KEY);
  const previousSignature = sessionStorage.getItem(CART_KEY);
  if (!id || previousSignature !== signature) {
    id = newRequestId();
    sessionStorage.setItem(REQUEST_KEY, id);
    sessionStorage.setItem(CART_KEY, signature);
  }
  return id;
}

export function resetCheckoutRequestId() {
  sessionStorage.removeItem(REQUEST_KEY);
  sessionStorage.removeItem(CART_KEY);
}

export function buildCheckoutPayload({ checkout, items }) {
  return {
    client_request_id: requestId(items),
    nome: String(checkout?.name || "").trim(),
    email: String(checkout?.email || "")
      .trim()
      .toLowerCase(),
    whatsapp: String(checkout?.whatsapp || "").trim(),
    observacao: String(checkout?.note || "").trim(),
    itens: (items || []).map(({ product, quantity }) => ({
      produto_id: Number(product.id),
      quantidade: Number(quantity)
    }))
  };
}

export async function createPixOrder(context) {
  return api.createPixCheckout(buildCheckoutPayload(context));
}
