const CLOSE_TRANSITION_MS = 220;
const CHECKOUT_HANDOFF_MS = 200;
const PAYMENT_HANDOFF_MS = 190;
const PAYMENT_RETURN_MS = 200;

const CLOSE_BINDINGS = [
  ["[data-close-checkout]", ".rp-checkout"],
  ["[data-close-cart]", ".rp-cart-overlay"],
  ["[data-close-party]", ".rp-party"],
  ["[data-close-menu]", ".rp-mobile-menu"]
];

const PAYMENT_RETURN_SELECTOR = "[data-close-payment], [data-retry-payment]";

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

function replaySubmit(form) {
  const replay = new SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter: form.querySelector("[data-submit-checkout]") || undefined
  });
  Object.defineProperty(replay, "rpSkipPaymentTransition", { value: true });
  form.dispatchEvent(replay);
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

function finishAfterAnimation(root, className, callback, duration) {
  if (!root || reducedMotion()) return callback();
  if (root.classList.contains(className)) return;
  root.classList.add(className);
  window.setTimeout(callback, duration);
}

function closeAfterAnimation(root, callback) {
  finishAfterAnimation(root, "is-closing", callback, CLOSE_TRANSITION_MS);
}

function handoffCartToCheckout(trigger) {
  const root = trigger.closest(".rp-cart-overlay") || document.querySelector(".rp-cart-overlay");
  finishAfterAnimation(root, "is-checkout-handoff", () => replayClick(trigger), CHECKOUT_HANDOFF_MS);
}

function handoffCheckoutToPayment(form) {
  const root = form.closest(".rp-checkout") || document.querySelector(".rp-checkout:not([hidden])");
  finishAfterAnimation(root, "is-payment-handoff", () => replaySubmit(form), PAYMENT_HANDOFF_MS);
}

function handoffPaymentToCheckout(root, callback) {
  finishAfterAnimation(root, "is-checkout-return", callback, PAYMENT_RETURN_MS);
}

document.addEventListener(
  "click",
  event => {
    if (event.rpSkipCloseTransition) return;

    const checkoutTrigger = event.target.closest?.("[data-start-checkout]");
    if (checkoutTrigger && !checkoutTrigger.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handoffCartToCheckout(checkoutTrigger);
      return;
    }

    const paymentReturnTrigger = event.target.closest?.(PAYMENT_RETURN_SELECTOR);
    if (paymentReturnTrigger && !paymentReturnTrigger.disabled) {
      const root =
        paymentReturnTrigger.closest(".rp-payment") || document.querySelector(".rp-payment");
      if (!root) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      handoffPaymentToCheckout(root, () => replayClick(paymentReturnTrigger));
      return;
    }

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
  "submit",
  event => {
    if (event.rpSkipPaymentTransition) return;
    const form = event.target.closest?.("[data-checkout-form]");
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    handoffCheckoutToPayment(form);
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
    if (root.matches(".rp-payment")) {
      handoffPaymentToCheckout(root, replayEscape);
      return;
    }
    closeAfterAnimation(root, replayEscape);
  },
  true
);
