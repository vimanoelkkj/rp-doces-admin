import { api } from "./api.js";
import {
  state,
  subscribe,
  changeCartQuantity,
  getCartItems,
  getCartSummary,
  setCartOpen,
  setCheckoutOpen,
  setMenuOpen,
  setPartyOpen,
  updateCheckout,
  syncCartWithProducts,
  setOrderState,
  resetOrderState,
  notify
} from "./state.js";
import { renderSiteHeader } from "./components/site-header.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";
import { renderCartBar } from "./components/cart-bar.js";
import { renderCart } from "./components/cart.js";
import { renderCheckout } from "./components/checkout.js";
import { renderPaymentStatus } from "./components/payment-status.js";
import { renderMobileMenu } from "./components/mobile-menu.js";
import { renderPartySheet } from "./components/party-sheet.js";
import { renderSiteFooter } from "./components/site-footer.js";
import { copyText } from "./clipboard.js";
import { createPixOrder, resetCheckoutRequestId } from "./checkout-service.js";
import { startOrderPolling, stopOrderPolling } from "./payment-controller.js";
import { paymentCreationAllowed, paymentDisabledMessage } from "./runtime-policy.js";
import { checkoutIsValid } from "./utils/checkout-validity.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  const summary = getCartSummary();
  root.innerHTML = `${renderSiteHeader(summary)}${renderHero()}${renderProductList(state.products, state.cart, state.productsStatus)}${renderSiteFooter()}${renderCartBar(summary)}${renderCart({ open: state.ui.cartOpen, items: getCartItems(), summary })}${renderCheckout({ open: state.ui.checkoutOpen, items: getCartItems(), summary, checkout: state.checkout })}${renderPaymentStatus(state.order)}${renderMobileMenu(state.ui.menuOpen)}${renderPartySheet(state.ui.partyOpen)}`;
  const overlayOpen =
    state.ui.cartOpen ||
    state.ui.checkoutOpen ||
    state.ui.menuOpen ||
    state.ui.partyOpen ||
    state.order.phase !== "idle";
  document.body.classList.toggle("rp-cart-open", overlayOpen);
}

async function loadProducts() {
  state.productsStatus = "loading";
  notify();
  try {
    const payload = await api.getProducts();
    state.products = Array.isArray(payload.produtos) ? payload.produtos : [];
    state.productsStatus = "ready";
    syncCartWithProducts();
  } catch (error) {
    state.productsStatus = "error";
    console.warn("R&P: não foi possível carregar produtos no bootstrap modular.", error);
  }
  notify();
}

async function submitCheckout() {
  if (state.order.phase === "creating") return;
  const items = getCartItems();
  if (!items.length) return setCartOpen(true);
  if (!checkoutIsValid(state.checkout)) {
    setOrderState({ phase: "error", error: "Revise nome, e-mail e WhatsApp antes de continuar." });
    setCheckoutOpen(false);
    return;
  }
  if (state.checkout.paymentMethod !== "PIX") {
    setOrderState({
      phase: "error",
      error: "Pagamento com cartão ainda não está disponível nesta versão."
    });
    setCheckoutOpen(false);
    return;
  }
  if (!paymentCreationAllowed()) {
    setOrderState({ phase: "error", error: paymentDisabledMessage() });
    setCheckoutOpen(false);
    return;
  }
  setCheckoutOpen(false);
  setOrderState({ phase: "creating", token: null, data: null, pix: null, error: null });
  try {
    const payload = await createPixOrder({ checkout: state.checkout, items });
    const pedido = payload.pedido || {};
    const token = pedido.token || null;
    const paid = String(pedido.status || "").toUpperCase() === "PAGO";
    setOrderState({
      phase: paid ? "paid" : "pending",
      token,
      data: pedido,
      pix: payload.pix || null,
      error: null
    });
    if (!paid && token) startOrderPolling(token);
  } catch (error) {
    setOrderState({
      phase: "error",
      error: error.message || "Não foi possível iniciar o pagamento."
    });
  }
}

function returnToCheckout({ resetRequest = false } = {}) {
  stopOrderPolling();
  if (resetRequest) resetCheckoutRequestId();
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
    if (quantityButton)
      return changeCartQuantity(
        quantityButton.dataset.productId,
        Number(quantityButton.dataset.cartDelta)
      );
    if (event.target.closest("[data-open-cart]")) return setCartOpen(true);
    if (event.target.closest("[data-close-cart]")) return setCartOpen(false);
    if (event.target.closest("[data-start-checkout]")) return setCheckoutOpen(true);
    if (event.target.closest("[data-close-checkout]")) return setCheckoutOpen(false);
    if (event.target.closest("[data-back-to-cart]")) return setCartOpen(true);
    if (event.target.closest("[data-open-menu]")) return setMenuOpen(true);
    if (event.target.closest("[data-close-menu]")) return setMenuOpen(false);
    if (event.target.closest("[data-open-party]")) return setPartyOpen(true);
    if (event.target.closest("[data-close-party]")) return setPartyOpen(false);
    if (event.target.closest("[data-reload-products]")) return loadProducts();
    if (event.target.closest("[data-close-payment]")) return returnToCheckout();
    if (event.target.closest("[data-finish-order]")) return finishOrder();
    if (event.target.closest("[data-retry-payment]"))
      return returnToCheckout({ resetRequest: true });
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
    submitCheckout();
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
  state.ui = { cartOpen: false, checkoutOpen: false, menuOpen: false, partyOpen: false };
  state.order = { phase: "idle", token: null, data: null, pix: null, error: null };
  state.productsStatus = "loading";
  renderStorefront();
  await loadProducts();
}
bootstrapStorefront();
