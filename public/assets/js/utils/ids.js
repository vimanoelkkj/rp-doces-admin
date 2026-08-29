export function createClientId(prefix = "rp") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const random = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 64);
}
