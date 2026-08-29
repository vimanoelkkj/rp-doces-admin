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
let pixCopiedTimer = null;
let previewPaymentTimers = [];

function clearPreviewPaymentTimers() {
  previewPaymentTimers.forEach(timer => clearTimeout(timer));
  previewPaymentTimers = [];
}
function schedulePreviewPaymentTimer(callback, delay) {
  const timer = setTimeout(callback, delay);
  previewPaymentTimers.push(timer);
  return timer;
}
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
  const demos = [
    "pix-pending",
    "pix-pending-to-paid",
    "card-pending",
    "payment-confirmed",
    "payment-error",
    "pix-error",
    "card-declined",
    "cancel-confirm",
    "cancelled",
    "pix-copied"
  ];
  if (!previewDisabled || !demos.includes(mode)) return false;
  clearPreviewPaymentTimers();
  storefrontRoute = "catalog";
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  if (mode === "payment-confirmed") {
    state.order = {
      phase: "paid",
      paymentMethod: "PIX",
      token: "demo-payment-confirmed",
      data: { referencia: "RP-DEMO-2408", valor_total_centavos: 3100, status: "PAGO" },
      pix: null,
      error: null,
      demoState: ""
    };
    return true;
  }
  if (mode === "payment-error") {
    state.order = {
      phase: "error",
      paymentMethod: "PIX",
      token: "demo-payment-error",
      data: { referencia: "RP-DEMO-ERRO", valor_total_centavos: 3100, status: "FALHA" },
      pix: null,
      error: "O pagamento não foi confirmado. Você pode tentar novamente.",
      demoState: ""
    };
    return true;
  }
  if (mode === "pix-error") {
    state.order = {
      phase: "pending",
      paymentMethod: "PIX",
      token: "demo-pix-error",
      data: { referencia: "RP-DEMO-PIX-ERRO", valor_total_centavos: 3100, status: "FALHA" },
      pix: null,
      error: null,
      demoState: "pix-error"
    };
    return true;
  }
  if (mode === "card-declined") {
    state.order = {
      phase: "pending",
      paymentMethod: "CARD",
      token: "demo-card-declined",
      data: { referencia: "RP-DEMO-CARD-ERRO", valor_total_centavos: 3100, status: "FALHA" },
      pix: null,
      error: null,
      demoState: "card-declined"
    };
    return true;
  }
  if (mode === "cancel-confirm" || mode === "cancelled") {
    state.order = {
      phase: "pending",
      paymentMethod: "PIX",
      token: `demo-${mode}`,
      data: {
        referencia: "RP-DEMO-CANCEL",
        valor_total_centavos: 3100,
        status: mode === "cancelled" ? "CANCELADO" : "PENDENTE"
      },
      pix: null,
      error: null,
      demoState: mode
    };
    return true;
  }
  const card = mode === "card-pending";
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
    error: null,
    demoState: mode === "pix-copied" ? "pix-copied" : ""
  };
  if (mode === "pix-pending-to-paid") {
    schedulePreviewPaymentTimer(() => {
      if (state.order.token !== "demo-pix-pending") return;
      const paidData = {
        ...state.order.data,
        referencia: "RP-DEMO-2408",
        status: "PAGO"
      };
      setOrderState({
        phase: "confirming-paid",
        paymentMethod: "PIX",
        token: "demo-pix-pending-to-paid",
        data: paidData,
        error: null,
        demoState: ""
      });
      schedulePreviewPaymentTimer(() => {
        if (
          state.order.phase !== "confirming-paid" ||
          state.order.token !== "demo-pix-pending-to-paid"
        )
          return;
        setOrderState({
          phase: "paid",
          paymentMethod: "PIX",
          token: "demo-pix-pending-to-paid",
          data: paidData,
          pix: null,
          error: null,
          demoState: ""
        });
      }, 220);
    }, 2400);
  }
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
  setOrderState({
    phase: "creating",
    token: null,
    data: null,
    pix: null,
    error: null,
    demoState: ""
  });
  try {
    const result = normalizeOrderResponse(
      await createPixOrder({ checkout: state.checkout, items })
    );
    setOrderState({
      phase: result.paid ? "paid" : "pending",
      token: result.token,
      data: result.pedido,
      pix: result.pix,
      error: null,
      demoState: ""
    });
    if (!result.paid && result.token) startOrderPolling(result.token);
  } catch (error) {
    setOrderState({ phase: "error", error: checkoutErrorMessage(error), demoState: "" });
  }
}
function returnToCheckout({ resetRequest = false } = {}) {
  clearPreviewPaymentTimers();
  stopOrderPolling();
  if (resetRequest) resetCheckoutRequestId();
  resetOrderState();
  setCheckoutOpen(true);
}
function finishOrder() {
  clearPreviewPaymentTimers();
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
    if (
      event.target.closest("[data-confirm-demo-cancel]") &&
      state.order.demoState === "cancel-confirm"
    )
      return setOrderState({
        demoState: "cancelled",
        data: { ...state.order.data, status: "CANCELADO" }
      });
    if (
      event.target.closest("[data-keep-demo-order]") &&
      state.order.demoState === "cancel-confirm"
    )
      return setOrderState({
        demoState: "",
        pix: {
          qr_code: "00020101021226840014BR.GOV.BCB.PIX0136demo-rp-doces-pix-pending-animation"
        },
        data: {
          ...state.order.data,
          status: "PENDENTE",
          pix_expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }
      });
    if (event.target.closest("[data-close-payment]")) return returnToCheckout();
    if (event.target.closest("[data-finish-order]")) return finishOrder();
    if (event.target.closest("[data-retry-payment]"))
      return returnToCheckout({ resetRequest: true });
    if (event.target.closest("[data-copy-pix]")) {
      const copied = await copyText(state.order.pix?.qr_code);
      const button = event.target.closest("[data-copy-pix]");
      if (copied && button) {
        let message = button.parentElement?.querySelector(".rp-payment__copied");
        if (!message) {
          message = document.createElement("div");
          message.className = "rp-payment__copied";
          message.setAttribute("role", "status");
          button.insertAdjacentElement("afterend", message);
        }
        message.textContent = "✓ Código Pix copiado. Agora é só colar no app do seu banco.";
        message.style.animation = "none";
        void message.offsetWidth;
        message.style.animation = "";
        if (pixCopiedTimer) clearTimeout(pixCopiedTimer);
        pixCopiedTimer = setTimeout(() => {
          if (message?.isConnected) message.remove();
          pixCopiedTimer = null;
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