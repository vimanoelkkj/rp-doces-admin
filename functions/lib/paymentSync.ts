/// <reference types="@cloudflare/workers-types" />

// Fachada pública pura do subsistema paymentSync.
// Reexporta nominalmente os símbolos públicos do subsistema.

export type {
  MpMappedStatus,
  SyncPaymentResult,
  ResolveWebhookPaymentResult,
} from "./paymentSync/types";

export {
  mapMpStatus,
} from "./paymentSync/status";

export type {
  MpPaymentResponse,
} from "./paymentSync/client";

export {
  MP_PAYMENT_GET_TIMEOUT_MS,
  fetchMpPayment,
} from "./paymentSync/client";

export {
  syncPaymentFromMp,
  expireLocalPayment,
} from "./paymentSync/ledgerSync";

export {
  resolveWebhookPayment,
  validateMpWebhookSignature,
} from "./paymentSync/webhook";

export {
  reconcilePendingPixPayments,
  liberarReservasVencidasLocalmente,
  claimPendingPixPaymentReconciliation,
} from "./paymentSync/sweeps";

export {
  recuperarOperacoesInconclusivas,
} from "./paymentSync/inconclusiveRecovery";
