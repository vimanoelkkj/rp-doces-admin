import { api } from "./api.js";
import {
  state,
  subscribe,
  changeCartQuantity,
  getCartSummary,
  syncCartWithProducts,
  notify
} from "./state.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";
import { renderCartBar } from "./components/cart-bar.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  root.innerHTML = `${renderHero()}${renderProductList(state.products, state.cart)}${renderCartBar(getCartSummary())}`;
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
      window.dispatchEvent(new CustomEvent("rp:open-cart", { detail: getCartSummary() }));
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
