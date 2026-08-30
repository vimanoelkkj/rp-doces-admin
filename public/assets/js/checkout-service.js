import { api } from "./api.js";
import { paymentSimulationEnabled } from "./runtime-policy.js";
import { newIdempotencyId, validIdempotencyId } from "./utils/idempotency.js";
import { sessionGet, sessionSet, sessionRemove } from "./utils/session.js";
import { normalizeCustomerName } from "./utils/customer-name.js";
import { normalizeCustomerWhatsapp } from "./utils/customer-whatsapp.js";
import { normalizeOrderNote } from "./utils/order-note.js";
import { checkoutLineItems } from "./utils/checkout-payload.js";

const REQUEST_KEY = "rp_checkout_request_id";
const CART_KEY = "rp_checkout_cart_signature";
function cartSignature(items = []) {
  return checkoutLineItems(items)
    .map(item => `${item.produto_id}:${item.quantidade}`)
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
function internalPayerEmail(id) {
  return `checkout+${String(id)
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 48)}@example.com`;
}
function previewTotal(items = []) {
  return items.reduce(
    (total, { product, quantity }) =>
      total + (Number(product?.preco_centavos) || 0) * (Number(quantity) || 0),
    0
  );
}
async function simulatePixOrder(context = {}) {
  const id = requestId(context.items || []);
  const token = `demo-checkout-${id}`;
  const total = previewTotal(context.items || []);
  await new Promise(resolve => setTimeout(resolve, 650));
  return {
    pedido: {
      token,
      referencia: "RP-DEMO-CHECKOUT",
      status: "PENDENTE",
      valor_total_centavos: total,
      pix_expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    },
    pix: {
      qr_code: "00020101021226840014BR.GOV.BCB.PIX0136demo-rp-doces-checkout-preview"
    }
  };
}
export function resetCheckoutRequestId() {
  sessionRemove(REQUEST_KEY);
  sessionRemove(CART_KEY);
}
export function buildCheckoutPayload({ checkout, items }) {
  const id = requestId(items);
  return {
    client_request_id: id,
    nome: normalizeCustomerName(checkout?.name),
    email: internalPayerEmail(id),
    whatsapp: normalizeCustomerWhatsapp(checkout?.whatsapp),
    observacao: normalizeOrderNote(checkout?.note),
    itens: checkoutLineItems(items)
  };
}
export async function createPixOrder(context) {
  if (paymentSimulationEnabled()) return simulatePixOrder(context);
  return api.createPixCheckout(buildCheckoutPayload(context));
}
