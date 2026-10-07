// Compatibility exports; only the Orders GET creates verified financial authority.
export {
  fetchMpOrder as fetchMpPayment,
  isVerifiedMpOrder as isVerifiedMpResponse,
  MP_ORDER_GET_TIMEOUT_MS as MP_PAYMENT_GET_TIMEOUT_MS
} from "../mp/orders/client";
export type { VerifiedMpOrder as MpPaymentResponse } from "../mp/orders/client";
