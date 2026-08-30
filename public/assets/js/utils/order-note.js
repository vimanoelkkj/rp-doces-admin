export function normalizeOrderNote(value = "") {
  return String(value).trim().replace(/\r\n?/g, "\n").slice(0, 500);
}
export function orderNoteRemaining(value = "") {
  return Math.max(0, 500 - normalizeOrderNote(value).length);
}
