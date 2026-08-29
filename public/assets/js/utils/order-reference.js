export function shortOrderReference(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}
