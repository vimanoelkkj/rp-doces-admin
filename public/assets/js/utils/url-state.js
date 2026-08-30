export function queryFlag(name) {
  return new URLSearchParams(globalThis.location?.search || "").get(name);
}
export function hasQueryFlag(name, expected = "1") {
  return queryFlag(name) === expected;
}
export function currentHash() {
  return String(globalThis.location?.hash || "").replace(/^#/, "");
}
