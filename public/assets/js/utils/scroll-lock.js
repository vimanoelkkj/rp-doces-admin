const CLASS_NAME = "rp-cart-open";
export function setPageScrollLocked(locked) {
  document.body.classList.toggle(CLASS_NAME, Boolean(locked));
}
export function isPageScrollLocked() {
  return document.body.classList.contains(CLASS_NAME);
}
