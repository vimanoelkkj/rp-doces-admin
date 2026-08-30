export function closest(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

export function setBodyLocked(locked) {
  document.body.classList.toggle("rp-cart-open", Boolean(locked));
}

export function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
