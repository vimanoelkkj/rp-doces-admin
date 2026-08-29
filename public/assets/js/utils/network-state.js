export function isBrowserOffline() {
  return globalThis.navigator?.onLine === false;
}
export function networkHint() {
  return isBrowserOffline() ? "Você parece estar sem conexão com a internet." : "";
}
