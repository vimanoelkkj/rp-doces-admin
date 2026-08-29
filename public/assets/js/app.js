import { api } from "./api.js";
import { state, notify } from "./state.js";
import { renderHero } from "./components/hero.js";
import { renderProductList } from "./components/product-list.js";

function renderStorefront() {
  const root = document.getElementById("rp-app");
  if (!root) return;
  root.innerHTML = `${renderHero()}${renderProductList(state.products)}`;
}

function bindStorefrontEvents() {
  const root = document.getElementById("rp-app");
  if (!root || root.dataset.eventsBound === "true") return;
  root.dataset.eventsBound = "true";

  root.addEventListener("click", event => {
    const button = event.target.closest("[data-add-product]");
    if (!button) return;
    const product = state.products.find(item => String(item.id) === button.dataset.addProduct);
    if (!product) return;
    window.dispatchEvent(new CustomEvent("rp:add-product", { detail: { product } }));
  });
}

export async function bootstrapStorefront() {
  renderStorefront();
  bindStorefrontEvents();

  try {
    const payload = await api.getProducts();
    state.products = Array.isArray(payload.produtos) ? payload.produtos : [];
  } catch (error) {
    console.warn("R&P: não foi possível carregar produtos no bootstrap modular.", error);
  }

  renderStorefront();
  notify();
}

bootstrapStorefront();
