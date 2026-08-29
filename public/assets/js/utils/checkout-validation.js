import { isValidEmail } from "./email.js";
import { isValidWhatsapp } from "./phone.js";

export function validateCheckout(checkout = {}, items = []) {
  const errors = {};
  const name = String(checkout.name || "").trim();
  if (name.length < 2 || name.length > 100) errors.name = "Informe seu nome.";
  if (!isValidEmail(checkout.email)) errors.email = "Informe um e-mail válido.";
  if (!isValidWhatsapp(checkout.whatsapp)) errors.whatsapp = "Informe um WhatsApp válido.";
  if (String(checkout.note || "").length > 500) errors.note = "A observação está muito longa.";
  if (!items.length) errors.items = "Seu pedido está vazio.";
  return { valid: Object.keys(errors).length === 0, errors };
}
