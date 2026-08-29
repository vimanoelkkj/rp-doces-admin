import { api } from "./api.js";
import { newIdempotencyId, validIdempotencyId } from "./utils/idempotency.js";
import { sessionGet, sessionSet, sessionRemove } from "./utils/session.js";
import { normalizeCustomerName } from "./utils/customer-name.js";
import { normalizeCustomerEmail } from "./utils/customer-email.js";
import { normalizeCustomerWhatsapp } from "./utils/customer-whatsapp.js";
import { normalizeOrderNote } from "./utils/order-note.js";

const REQUEST_KEY = "rp_checkout_request_id";
const CART_KEY = "rp_checkout_cart_signature";

function cartSignature(items = []) {
  return items
    .map(({ product, quantity }) => `${Number(product.id)}:${Number(quantity)}`)
    .sort()
    .join("|");
}

function requestId(items) {
  const signature = cartSignature(items);
  let id = sessionGet(REQUEST_KEY);
  const previousSignature = sessionGet(CART_KEY);
  if (!validIdempotencyId(id) || previousSignature !== signature) {
    id = newIdempotencyId();
    sessionSet(REQUEST_KEY, id);
    sessionSet(CART_KEY, signature);
  }
  return id;
}

export function resetCheckoutRequestId() {
  sessionRemove(REQUEST_KEY);
  sessionRemove(CART_KEY);
}

export function buildCheckoutPayload({ checkout, items }) {
  return {
    client_request_id: requestId(items),
    nome: normalizeCustomerName(checkout?.name),
    email: normalizeCustomerEmail(checkout?.email),
    whatsapp: normalizeCustomerWhatsapp(checkout?.whatsapp),
    observacao: normalizeOrderNote(checkout?.note),
    itens: (items || []).map(({ product, quantity }) => ({
      produto_id: Number(product.id),
      quantidade: Number(quantity)
    }))
  };
}

export async function createPixOrder(context) {
  return api.createPixCheckout(buildCheckoutPayload(context));
}
