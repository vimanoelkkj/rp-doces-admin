import { checkoutIsValid } from "./checkout-validity.js";
import { cartWithinCheckoutLimits } from "./cart-limits.js";
import { isPixPayment } from "./payment-method.js";

export function checkoutReadiness(checkout = {}, items = []) {
  if (!items.length) return { ok: false, reason: "empty" };
  if (!cartWithinCheckoutLimits(items)) return { ok: false, reason: "limits" };
  if (!checkoutIsValid(checkout)) return { ok: false, reason: "customer" };
  if (!isPixPayment(checkout.paymentMethod)) return { ok: false, reason: "payment" };
  return { ok: true, reason: null };
}
