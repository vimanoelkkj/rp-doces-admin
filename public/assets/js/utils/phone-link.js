export function whatsappDigits(value = "") {
  return String(value).replace(/\D/g, "").slice(0, 13);
}
export function whatsappUrl(value, message = "") {
  const digits = whatsappDigits(value);
  if (!digits) return "";
  const text = String(message || "").trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
