import { clearCart } from "./state.js";

function finishOrderAction(target) {
  return target instanceof Element ? target.closest("[data-finish-order]") : null;
}

document.addEventListener(
  "click",
  event => {
    if (!finishOrderAction(event.target)) return;
    clearCart();
  },
  true
);
