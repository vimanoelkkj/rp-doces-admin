import { api } from "./api.js";
import {
  state,
  subscribe,
  changeCartQuantity,
  getCartItems,
  getCartSummary,
  setCartOpen,
  setCheckoutOpen,
  updateCheckout,
  syncCartWithProducts,
  notify
} from "./state.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";
import { renderCartBar } from "./components/cart-bar.js";
import { renderCart } from "./components/cart.js";
import { renderCheckout } from "./components/checkout.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  const summary = getCartSummary();
  root.innerHTML = `${renderHero()}${renderProductList(state.products, state.cart)}${renderCartBar(summary)}${renderCart({ open: state.ui.cartOpen, items: getCartItems(), summary })}${renderCheckout({ open: state.ui.checkoutOpen, items: getCartItems(), summary, checkout: state.checkout })}`;
  document.body.classList.toggle("rp-cart-open", state.ui.cartOpen || state.ui.checkoutOpen);
}

function bindStorefrontEvents() {
  const root = document.getElementById("rp-app");
  if (!root || root.dataset.eventsBound === "true") return;
  root.dataset.eventsBound = "true";

  root.addEventListener("click", event => {
    const quantityButton = event.target.closest("[data-cart-delta]");
    if (quantityButton) {
      changeCartQuantity(
        quantityButton.dataset.productId,
        Number(quantityButton.dataset.cartDelta)
      );
      return;
    }

    if (event.target.closest("[data-open-cart]")) {
      setCartOpen(true);
      return;
    }

    if (event.target.closest("[data-close-cart]")) {
      setCartOpen(false);
      return;
    }

    if (event.target.closest("[data-start-checkout]")) {
      setCheckoutOpen(true);
      return;
    }

    if (event.target.closest("[data-close-checkout]")) {
      setCheckoutOpen(false);
      return;
    }

    if (event.target.closest("[data-back-to-cart]")) {
      setCartOpen(true);
      return;
    }

    if (event.target.closest("[data-submit-checkout]")) {
      window.dispatchEvent(
        new CustomEvent("rp:submit-checkout", {
          detail: {
            checkout: { ...state.checkout },
            items: getCartItems(),
            summary: getCartSummary()
          }
        })
      );
    }
  });

  root.addEventListener("input", event => {
    const field = event.target.dataset.checkoutField;
    if (field) updateCheckout(field, event.target.value);
  });

  root.addEventListener("change", event => {
    const field = event.target.dataset.checkoutField;
    if (field) updateCheckout(field, event.target.value);
  });
}

export async function bootstrapStorefront() {
  subscribe(renderStorefront);
  bindStorefrontEvents();

  state.ui.cartOpen = false;
  state.ui.checkoutOpen = false;
  renderStorefront();

  try {
    const payload = await api.getProducts();
    state.products = Array.isArray(payload.produtos) ? payload.produtos : [];
    syncCartWithProducts();
  } catch (error) {
    console.warn("R&P: não foi possível carregar produtos no bootstrap modular.", error);
  }

  notify();
}

bootstrapStorefront();
