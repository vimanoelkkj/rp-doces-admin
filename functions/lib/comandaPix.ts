/// <reference types="@cloudflare/workers-types" />

// Administrative Pix generation/regeneration uses the same Orders adapter as
// checkout. Standalone cancellation remains outside this UI contract; regeneration
// verifies cancellation of A before creating B and preserves the existing guards.
//
// external_reference: SITE continua usando `token_publico` do pedido
// (checkout.ts intocado). ADMIN usa o `idempotency_key` da própria
// tentativa de pagamento — único por natureza (índice único já existe,
// migration 0008), o que evita a ambiguidade que `token_publico` teria
// assim que dois Pix administrativos coexistirem no mesmo pedido.
// `resolveWebhookPayment` (paymentSync.ts) aprende os dois formatos sem
// alterar o caminho SITE.

export type {
  GerarPixAdminParams,
  GerarPixAdminSucesso,
  GerarPixAdminFalha,
  GerarPixAdminResult,
  PixAdminPendente
} from "./pix/types";

export { getCapacidadeCobravel, getPixAdminPendentesAtivos } from "./pix/queries";

export { createAdminPixCharge } from "./pix/adminCharge";
