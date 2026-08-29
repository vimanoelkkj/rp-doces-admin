export function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}
export function scrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}
