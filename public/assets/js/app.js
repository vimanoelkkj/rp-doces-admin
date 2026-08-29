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
  setOrderState,
  resetOrderState,
  notify
} from "./state.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";
import { renderCartBar } from "./components/cart-bar.js";
import { renderCart } from "./components/cart.js";
import { renderCheckout } from "./components/checkout.js";
import { renderPaymentStatus } from "./components/payment-status.js";
import { copyText } from "./clipboard.js";
import { resetCheckoutRequestId } from "./checkout-service.js";
import { stopOrderPolling } from "./payment-controller.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  const summary = getCartSummary();
  root.innerHTML = `${renderHero()}${renderProductList(state.products, state.cart)}${renderCartBar(summary)}${renderCart({ open: state.ui.cartOpen, items: getCartItems(), summary })}${renderCheckout({ open: state.ui.checkoutOpen, items: getCartItems(), summary, checkout: state.checkout })}${renderPaymentStatus(state.order)}`;
  document.body.classList.toggle(
    "rp-cart-open",
    state.ui.cartOpen || state.ui.checkoutOpen || state.order.phase !== "idle"
  );
}

function dispatchCheckoutSubmit() {
  window.dispatchEvent(
    new CustomEvent("rp:submit-checkout", {
      detail: { checkout: { ...state.checkout }, items: getCartItems(), summary: getCartSummary() }
    })
  );
}

function closePayment() {
  stopOrderPolling();
  resetOrderState();
  setCheckoutOpen(true);
}

function finishOrder() {
  stopOrderPolling();
  resetCheckoutRequestId();
  resetOrderState();
  state.cart.clear();
  state.ui.cartOpen = false;
  state.ui.checkoutOpen = false;
  notify();
  document.getElementById("cardapio")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindStorefrontEvents() {
  const root = document.getElementById("rp-app");
  if (!root || root.dataset.eventsBound === "true") return;
  root.dataset.eventsBound = "true";

  root.addEventListener("click", async event => {
    const quantityButton = event.target.closest("[data-cart-delta]");
    if (quantityButton) {
      changeCartQuantity(
        quantityButton.dataset.productId,
        Number(quantityButton.dataset.cartDelta)
      );
      return;
    }
    if (event.target.closest("[data-open-cart]")) return setCartOpen(true);
    if (event.target.closest("[data-close-cart]")) return setCartOpen(false);
    if (event.target.closest("[data-start-checkout]")) return setCheckoutOpen(true);
    if (event.target.closest("[data-close-checkout]")) return setCheckoutOpen(false);
    if (event.target.closest("[data-back-to-cart]")) return setCartOpen(true);
    if (event.target.closest("[data-close-payment]")) return closePayment();
    if (event.target.closest("[data-finish-order]")) return finishOrder();
    if (event.target.closest("[data-retry-payment]")) return setCheckoutOpen(true);

    if (event.target.closest("[data-copy-pix]")) {
      const copied = await copyText(state.order.pix?.qr_code);
      const button = event.target.closest("[data-copy-pix]");
      if (copied && button) {
        button.textContent = "Código copiado ✓";
        setTimeout(() => {
          if (button.isConnected) button.textContent = "Copiar código Pix";
        }, 1800);
      }
    }
  });

  root.addEventListener("submit", event => {
    if (!event.target.matches("[data-checkout-form]")) return;
    event.preventDefault();
    if (state.order.phase === "creating") return;
    dispatchCheckoutSubmit();
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
  setOrderState({ phase: "idle", token: null, data: null, pix: null, error: null });

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
