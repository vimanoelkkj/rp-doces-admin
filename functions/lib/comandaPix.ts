/// <reference types="@cloudflare/workers-types" />

// Pix administrativo (geração e regeneração pelo admin, fora do checkout do
// cliente) — Payments API, não Orders API (produção usa Orders API; decisão
// deliberada de não copiar de carona, documentada no README). Cancelamento
// autônomo (sem substituto) fica fora de escopo: a Payments API não tem
// cancelamento real de Pix pendente, então essa ação só faria sentido como
// "esconder da UI sem substituir" — semanticamente estranho sem um Pix novo.
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
  PixAdminPendente,
} from "./pix/types";

export {
  getCapacidadeCobravel,
  getPixAdminPendentesAtivos,
} from "./pix/queries";

export {
  createAdminPixCharge,
} from "./pix/adminCharge";
