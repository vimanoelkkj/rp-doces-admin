import { api } from "./api.js";

const REQUEST_KEY = "rp_checkout_request_id";

function requestId() {
  let id = sessionStorage.getItem(REQUEST_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(REQUEST_KEY, id);
  }
  return id;
}

export function resetCheckoutRequestId() {
  sessionStorage.removeItem(REQUEST_KEY);
}

export function buildCheckoutPayload({ checkout, items }) {
  return {
    client_request_id: requestId(),
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
