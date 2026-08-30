export function cleanText(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}
export function truncateText(value = "", max = 120) {
  const text = cleanText(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}
