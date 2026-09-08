const CLASS_NAME = "rp-cart-open";
let previousInlinePaddingRight = "";

function getScrollbarWidth() {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

export function setPageScrollLocked(locked) {
  const body = document.body;
  const shouldLock = Boolean(locked);
  const isLocked = body.classList.contains(CLASS_NAME);

  if (shouldLock === isLocked) return;

  if (shouldLock) {
    previousInlinePaddingRight = body.style.paddingRight;
    const scrollbarWidth = getScrollbarWidth();
    const currentPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }

    body.classList.add(CLASS_NAME);
    return;
  }

  body.classList.remove(CLASS_NAME);
  body.style.paddingRight = previousInlinePaddingRight;
  previousInlinePaddingRight = "";
}

export function isPageScrollLocked() {
  return document.body.classList.contains(CLASS_NAME);
}
