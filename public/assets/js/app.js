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
  resetTransientState,
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
import { checkoutErrorMessage } from "./utils/checkout-errors.js";
import { storefrontProducts } from "./utils/product-filter.js";
import { sortProducts } from "./utils/product-sort.js";
import { hasOpenOverlay } from "./utils/overlay.js";
import { setPageScrollLocked } from "./utils/scroll-lock.js";
import { isEscapeKey } from "./utils/keyboard.js";
import { scrollBehavior } from "./utils/reduced-motion.js";
import { checkoutReadiness } from "./utils/checkout-readiness.js";
import { checkoutReadinessMessage } from "./utils/checkout-readiness-copy.js";
import { normalizeOrderResponse } from "./utils/order-response.js";
import { catalogProducts } from "./utils/catalog-response.js";
function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  const summary = getCartSummary();
  root.innerHTML = `${renderSiteHeader(summary)}${renderHero()}${renderProductList(state.products, state.cart, state.productsStatus)}${renderSiteFooter()}${renderCartBar(summary)}${renderCart({ open: state.ui.cartOpen, items: getCartItems(), summary })}${renderCheckout({ open: state.ui.checkoutOpen, items: getCartItems(), summary, checkout: state.checkout })}${renderPaymentStatus(state.order)}${renderMobileMenu(state.ui.menuOpen)}${renderPartySheet(state.ui.partyOpen)}`;
  setPageScrollLocked(hasOpenOverlay(state));
}
async function loadProducts() {
  state.productsStatus = "loading";
  notify();
  try {
    state.products = sortProducts(storefrontProducts(catalogProducts(await api.getProducts())));
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
  const readiness = checkoutReadiness(state.checkout, items);
  if (!readiness.ok) {
    if (readiness.reason === "empty") return setCartOpen(true);
    setOrderState({ phase: "error", error: checkoutReadinessMessage(readiness.reason) });
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
    const result = normalizeOrderResponse(
      await createPixOrder({ checkout: state.checkout, items })
    );
    setOrderState({
      phase: result.paid ? "paid" : "pending",
      token: result.token,
      data: result.pedido,
      pix: result.pix,
      error: null
    });
    if (!result.paid && result.token) startOrderPolling(result.token);
  } catch (error) {
    setOrderState({ phase: "error", error: checkoutErrorMessage(error) });
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
  document
    .getElementById("cardapio")
    ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}
function closeTopOverlay() {
  if (state.order.phase !== "idle") return returnToCheckout();
  if (state.ui.checkoutOpen) return setCheckoutOpen(false);
  if (state.ui.cartOpen) return setCartOpen(false);
  if (state.ui.partyOpen) return setPartyOpen(false);
  if (state.ui.menuOpen) return setMenuOpen(false);
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
  document.addEventListener("keydown", event => {
    if (isEscapeKey(event) && hasOpenOverlay(state)) {
      event.preventDefault();
      closeTopOverlay();
    }
  });
}
export async function bootstrapStorefront() {
  subscribe(renderStorefront);
  bindStorefrontEvents();
  resetTransientState();
  renderStorefront();
  await loadProducts();
}
bootstrapStorefront();
