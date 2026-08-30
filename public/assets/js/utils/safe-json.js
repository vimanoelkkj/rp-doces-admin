export function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
export function stringifyJson(value, fallback = "") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}
