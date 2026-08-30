export function checkoutFromForm(form) {
  const data = new FormData(form);
  return {
    name: String(data.get("name") || ""),
    email: String(data.get("email") || ""),
    whatsapp: String(data.get("whatsapp") || ""),
    note: String(data.get("note") || ""),
    paymentMethod: String(data.get("paymentMethod") || "PIX")
  };
}
