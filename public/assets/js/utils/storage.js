export function readStorage(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(storage, key) {
  try {
    storage.removeItem(key);
  } catch {}
}
