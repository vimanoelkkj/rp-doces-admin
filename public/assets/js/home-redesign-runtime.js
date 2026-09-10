import { state, subscribe } from "./state.js";
import { renderProductCard } from "./components/product-card.js";
import { storefrontProducts } from "./utils/product-filter.js";
import { sortProducts } from "./utils/product-sort.js";

function cartQuantity(product) {
  return Number(state.cart.get(String(product.id))) || 0;
}

function renderHomeCatalog() {
  const grid = document.querySelector(".rp-home--redesign .rp-home-catalog__grid");
  if (!grid) return false;

  if (state.productsStatus === "loading" && state.products.length === 0) {
    grid.innerHTML = '<div class="rp-home-catalog__empty">Carregando os sabores de hoje…</div>';
    return true;
  }

  if (state.productsStatus === "error" && state.products.length === 0) {
    grid.innerHTML = '<div class="rp-home-catalog__empty">Não conseguimos carregar o cardápio agora.</div>';
    return true;
  }

  const products = sortProducts(storefrontProducts(state.products)).slice(0, 5);
  grid.innerHTML = products.length
    ? products.map(product => renderProductCard(product, cartQuantity(product))).join("")
    : '<div class="rp-home-catalog__empty">Nenhum sabor disponível no momento.</div>';
  return true;
}

// A home é montada por app.js. Observamos apenas até o grid existir e então
// desligamos o observer para não reagir às nossas próprias alterações de innerHTML.
const observer = new MutationObserver(() => {
  if (!document.querySelector(".rp-home--redesign .rp-home-catalog__grid")) return;
  observer.disconnect();
  renderHomeCatalog();
});
observer.observe(document.body, { childList: true, subtree: true });

subscribe(renderHomeCatalog);
renderHomeCatalog();
