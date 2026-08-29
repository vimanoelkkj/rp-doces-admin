import { api } from "./api.js";
import {
  state,
  subscribe,
  changeCartQuantity,
  setCartQuantity,
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
import { renderHomeLanding } from "./components/home-landing.js";
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

const regionMarkup = new Map();
let storefrontRoute = "home";
let catalogCategory = "ALL";

function catalogMarkup() {
  return `<section data-catalog-route><div data-region="header"></div><div data-region="products"></div>${renderSiteFooter()}</section>`;
}
function mountStorefront() {
  const root = document.getElementById("rp-app");
  if (!root || root.dataset.mounted === "true") return;
  root.innerHTML = `<div data-region="route"></div><div data-region="cart-bar"></div><div data-region="cart"></div><div data-region="checkout"></div><div data-region="payment"></div><div data-region="menu"></div><div data-region="party"></div>`;
  root.dataset.mounted = "true";
}
function updateRegion(name, markup) {
  const root = document.getElementById("rp-app");
  const region = root?.querySelector(`[data-region="${name}"]`);
  if (!region || regionMarkup.get(name) === markup) return;
  region.innerHTML = markup;
  regionMarkup.set(name, markup);
}
function ensureRouteMarkup() {
  const markup = storefrontRoute === "home" ? renderHomeLanding() : catalogMarkup();
  updateRegion("route", markup);
  if (storefrontRoute === "catalog") {
    regionMarkup.delete("header");
    regionMarkup.delete("products");
  }
}
function renderStorefront() {
  mountStorefront();
  ensureRouteMarkup();
  const summary = getCartSummary();
  const items = getCartItems();
  if (storefrontRoute === "catalog") {
    updateRegion("header", renderSiteHeader(summary));
    updateRegion(
      "products",
      renderProductList(state.products, state.cart, state.productsStatus, catalogCategory)
    );
  }
  updateRegion("cart-bar", storefrontRoute === "catalog" ? renderCartBar(summary) : "");
  updateRegion("cart", renderCart({ open: state.ui.cartOpen, items, summary }));
  updateRegion(
    "checkout",
    renderCheckout({ open: state.ui.checkoutOpen, items, summary, checkout: state.checkout })
  );
  updateRegion("payment", renderPaymentStatus(state.order));
  updateRegion("menu", renderMobileMenu(state.ui.menuOpen));
  updateRegion("party", renderPartySheet(state.ui.partyOpen));
  setPageScrollLocked(hasOpenOverlay(state));
}
function showCatalog() {
  storefrontRoute = "catalog";
  regionMarkup.delete("route");
  renderStorefront();
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
function showHome() {
  storefrontRoute = "home";
  regionMarkup.delete("route");
  renderStorefront();
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
function showHomeSection(sectionId) {
  setMenuOpen(false);
  storefrontRoute = "home";
  regionMarkup.delete("route");
  renderStorefront();
  requestAnimationFrame(() => {
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    else window.scrollTo({ top: 0, behavior: scrollBehavior() });
  });
}
function applyPreviewDemo() {
  const mode = new URLSearchParams(location.search).get("demo");
  const previewDisabled =
    document.querySelector('meta[name="rp-payment-mode"]')?.content === "disabled";
  if (!previewDisabled || !["pix-pending", "card-pending"].includes(mode)) return false;
  storefrontRoute = "catalog";
  const card = mode === "card-pending";
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  state.order = {
    phase: "pending",
    paymentMethod: card ? "CARD" : "PIX",
    token: card ? "demo-card-pending" : "demo-pix-pending",
    data: {
      referencia: card ? "DEMO-CARD" : "DEMO-PIX",
      valor_total_centavos: 3100,
      status: "PENDENTE",
      pix_expira_em: card ? null : expires
    },
    pix: card
      ? null
      : { qr_code: "00020101021226840014BR.GOV.BCB.PIX0136demo-rp-doces-pix-pending-animation" },
    error: null
  };
  return true;
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
    const homeSectionButton = event.target.closest("[data-home-section]");
    if (homeSectionButton) return showHomeSection(homeSectionButton.dataset.homeSection);
    if (event.target.closest("[data-show-catalog]")) return showCatalog();
    if (event.target.closest("[data-home-top]")) return showHome();
    const categoryButton = event.target.closest("[data-catalog-category]");
    if (categoryButton) {
      catalogCategory = categoryButton.dataset.catalogCategory || "ALL";
      regionMarkup.delete("products");
      return renderStorefront();
    }
    const removeButton = event.target.closest("[data-cart-remove]");
    if (removeButton) return setCartQuantity(removeButton.dataset.productId, 0);
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
  mountStorefront();
  subscribe(renderStorefront);
  bindStorefrontEvents();
  resetTransientState();
  applyPreviewDemo();
  renderStorefront();
  await loadProducts();
}
bootstrapStorefront();
