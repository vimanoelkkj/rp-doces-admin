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
export function pixQrImageSrc(order = {}) {
  const raw = String(order?.pix?.qr_code_base64 || "").trim();
  if (!raw) return "";
  if (/^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(raw)) {
    return raw.replace(/\s/g, "");
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return "";
  return `data:image/png;base64,${raw.replace(/\s/g, "")}`;
}
export function paymentTotalCents(order = {}) {
  return Math.max(0, Number(order?.data?.valor_total_centavos) || 0);
}
