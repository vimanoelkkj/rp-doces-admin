export function sessionGet(key) {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export function sessionSet(key, value) {
  try {
    globalThis.sessionStorage?.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}
export function sessionRemove(key) {
  try {
    globalThis.sessionStorage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
