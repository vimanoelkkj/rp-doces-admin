export function fallbackIdempotencyId() {
  return `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`.slice(0, 64);
}
export function newIdempotencyId() {
  return globalThis.crypto?.randomUUID?.() || fallbackIdempotencyId();
}
export function validIdempotencyId(value = "") {
  return /^[A-Za-z0-9_-]{16,64}$/.test(String(value));
}
