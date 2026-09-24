/// <reference types="@cloudflare/workers-types" />

import type { MpMappedStatus } from "./types";

// Vocabulário de eventos do Mercado Pago (Payments API) -> vocabulário do
// nosso ledger. `null` significa "ainda não é um estado final conhecido"
// (ex.: in_process/authorized/pending) — nesse caso não há nada a aplicar.
export function mapMpStatus(mpStatus: string): MpMappedStatus | null {
  const status = String(mpStatus || "").toLowerCase();
  if (status === "approved") return "PAGO";
  if (status === "rejected" || status === "cancelled") return "CANCELADO";
  if (status === "expired") return "EXPIRADO";
  return null;
}
