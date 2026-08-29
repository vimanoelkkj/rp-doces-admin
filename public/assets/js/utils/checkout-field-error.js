const MESSAGES = Object.freeze({
  name: "Informe seu nome.",
  email: "Informe um e-mail válido.",
  whatsapp: "Informe um WhatsApp válido."
});
export function checkoutFieldError(field, valid) {
  return valid ? "" : MESSAGES[field] || "Revise este campo.";
}
