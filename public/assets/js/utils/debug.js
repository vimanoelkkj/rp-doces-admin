const PREFIX = "[R&P storefront]";
export function debug(...args) {
  if (!globalThis.location?.search?.includes("debug=1")) return;
  console.debug(PREFIX, ...args);
}
export function warn(...args) {
  console.warn(PREFIX, ...args);
}
