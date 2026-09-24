/// <reference types="@cloudflare/workers-types" />

import type { LedgerStatus } from "../comandaLedger";

export type MpMappedStatus = "PAGO" | "CANCELADO" | "EXPIRADO";

export interface SyncPaymentResult {
  ok: boolean;
  status: LedgerStatus | null;
  transicionou: boolean;
}

export type ResolveWebhookPaymentResult =
  | { kind: "found"; pagamentoId: number }
  | { kind: "not_found" }
  | { kind: "ambiguous" };
