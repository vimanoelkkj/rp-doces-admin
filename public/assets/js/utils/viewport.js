export function isDesktopViewport() {
  return globalThis.matchMedia?.("(min-width: 900px)")?.matches === true;
}
export function isMobileViewport() {
  return !isDesktopViewport();
}
