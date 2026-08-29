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
      state.ui.cartOpen = true;
      state.ui.checkoutOpen = false;
      notify();
      return;
    }

    if (event.target.closest("[data-close-cart]")) {
      setCartOpen(false);
      return;
    }

    if (event.target.closest("[data-start-checkout]")) {
      state.ui.cartOpen = false;
      state.ui.checkoutOpen = true;
      notify();
      return;
    }

    if (event.target.closest("[data-close-checkout]")) {
      state.ui.checkoutOpen = false;
      notify();
    }
  });

  root.addEventListener("change", event => {
    if (event.target.name === "paymentMethod") {
      state.checkout.paymentMethod = event.target.value;
    }
  });

  root.addEventListener("submit", event => {
    const form = event.target.closest("[data-checkout-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    state.checkout.name = String(data.get("name") || "").trim();
    state.checkout.whatsapp = String(data.get("whatsapp") || "").trim();
    state.checkout.note = String(data.get("note") || "").trim();
    state.checkout.paymentMethod = String(data.get("paymentMethod") || "PIX");
    window.dispatchEvent(
      new CustomEvent("rp:checkout-ready", {
        detail: {
          checkout: { ...state.checkout },
          items: getCartItems(),
          summary: getCartSummary()
        }
      })
    );
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
