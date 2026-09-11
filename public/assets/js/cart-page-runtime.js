import { setCartOpen } from "./state.js";

document.addEventListener(
  "click",
  event => {
    const cartPage = event.target.closest?.(".rp-cart-page");
    if (!cartPage) return;

    const navigationTarget = event.target.closest?.(
      "[data-home-top], [data-show-catalog], [data-home-section]"
    );
    if (!navigationTarget) return;

    setCartOpen(false);
  },
  true
);
