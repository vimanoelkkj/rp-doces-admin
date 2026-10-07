export type OrderLedgerStatus = "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "REEMBOLSADO";

export function mapOrderStatus(status: string, detail?: string | null): OrderLedgerStatus | null {
  if (status === "action_required" && detail === "waiting_transfer") return "PENDENTE";
  if (status === "processed" && (detail === "accredited" || detail === "partially_refunded"))
    return "PAGO";
  if (status === "canceled") return "CANCELADO";
  if (status === "expired") return "EXPIRADO";
  if (status === "refunded" || (status === "processed" && detail === "refunded"))
    return "REEMBOLSADO";
  return null;
}

// Keep the existing persisted/provider-facing vocabulary and all its SQL guards.
// Unknown Orders states cannot acquire a legacy approval label.
export function compatiblePaymentStatus(status: string, detail?: string | null): string {
  const mapped = mapOrderStatus(status, detail);
  return mapped === "PENDENTE"
    ? "pending"
    : mapped === "PAGO"
      ? "approved"
      : mapped === "CANCELADO"
        ? "cancelled"
        : mapped === "EXPIRADO"
          ? "expired"
          : mapped === "REEMBOLSADO"
            ? "refunded"
            : `unknown:${status}`;
}
