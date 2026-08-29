import { api } from "./api.js";
import {
  state,
  subscribe,
  changeCartQuantity,
  getCartItems,
  getCartSummary,
  setCartOpen,
  syncCartWithProducts,
  notify
} from "./state.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";
import { renderCartBar } from "./components/cart-bar.js";
import { renderCart } from "./components/cart.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  const summary = getCartSummary();
  root.innerHTML = `${renderHero()}${renderProductList(state.products, state.cart)}${renderCartBar(summary)}${renderCart({ open: state.ui.cartOpen, items: getCartItems(), summary })}`;
  document.body.classList.toggle("rp-cart-open", state.ui.cartOpen);
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

    const cartButton = event.target.closest("[data-open-cart]");
    if (cartButton) {
      setCartOpen(true);
      return;
    }

    const closeButton = event.target.closest("[data-close-cart]");
    if (
      (closeButton && !event.target.closest("[data-cart-sheet]")) ||
      event.target.closest("button[data-close-cart]")
    ) {
      setCartOpen(false);
      return;
    }

    const checkoutButton = event.target.closest("[data-start-checkout]");
    if (checkoutButton) {
      window.dispatchEvent(
        new CustomEvent("rp:start-checkout", {
          detail: { items: getCartItems(), summary: getCartSummary() }
        })
      );
    }
  });
}

export async function bootstrapStorefront() {
  subscribe(renderStorefront);
  renderStorefront();
  bindStorefrontEvents();

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
