export function paymentStatus(order = {}) {
  return String(order?.data?.status || "")
    .trim()
    .toUpperCase();
}
export function paymentReference(order = {}) {
  return order?.data?.referencia || order?.data?.token || order?.token || "";
}
export function pixCode(order = {}) {
  return String(order?.pix?.qr_code || "").trim();
}
export function paymentTotalCents(order = {}) {
  return Math.max(0, Number(order?.data?.valor_total_centavos) || 0);
}
