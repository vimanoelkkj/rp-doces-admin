const CLOSE_TRANSITION_MS = 220;

const CLOSE_BINDINGS = [
  ["[data-close-payment]", ".rp-payment"],
  ["[data-close-checkout]", ".rp-checkout"],
  ["[data-close-cart]", ".rp-cart-overlay"],
  ["[data-close-party]", ".rp-party"],
  ["[data-close-menu]", ".rp-mobile-menu"]
];

const ESCAPE_ROOTS = [
  ".rp-payment",
  ".rp-checkout:not([hidden])",
  ".rp-cart-overlay",
  ".rp-party",
  ".rp-mobile-menu"
];

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function replayClick(trigger) {
  const replay = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  });
  Object.defineProperty(replay, "rpSkipCloseTransition", { value: true });
  trigger.dispatchEvent(replay);
}

function replayEscape() {
  const replay = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true
  });
  Object.defineProperty(replay, "rpSkipCloseTransition", { value: true });
  document.dispatchEvent(replay);
}

function closeAfterAnimation(root, callback) {
  if (!root || reducedMotion()) return callback();
  if (root.classList.contains("is-closing")) return;
  root.classList.add("is-closing");
  window.setTimeout(callback, CLOSE_TRANSITION_MS);
}

document.addEventListener(
  "click",
  event => {
    if (event.rpSkipCloseTransition) return;

    for (const [triggerSelector, rootSelector] of CLOSE_BINDINGS) {
      const trigger = event.target.closest?.(triggerSelector);
      if (!trigger || trigger.disabled) continue;
      const root = trigger.closest(rootSelector) || document.querySelector(rootSelector);
      if (!root) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      closeAfterAnimation(root, () => replayClick(trigger));
      return;
    }
  },
  true
);

document.addEventListener(
  "keydown",
  event => {
    if (event.rpSkipCloseTransition || event.key !== "Escape" || reducedMotion()) return;
    const root = ESCAPE_ROOTS.map(selector => document.querySelector(selector)).find(Boolean);
    if (!root) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    closeAfterAnimation(root, replayEscape);
  },
  true
);
