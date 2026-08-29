const FALLBACK = "Não foi possível concluir esta etapa. Tente novamente.";
export function checkoutErrorMessage(error) {
  const message = String(error?.message || "").trim();
  if (!message) return FALLBACK;
  if (/network|fetch|conex/i.test(message))
    return "Não conseguimos falar com o servidor. Confira sua conexão e tente novamente.";
  return message.slice(0, 240);
}
