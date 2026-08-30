import { renderProductCard } from "./product-card.js";
import { storefrontProducts } from "../utils/product-filter.js";
import { sortProducts } from "../utils/product-sort.js";

let renderedProducts = null;
let renderedStatus = null;
let renderedCategory = null;
let renderedQuantities = new Map();
let stableMarkup = "";

function visibleProducts(products = []) {
  return sortProducts(storefrontProducts(products));
}
function categoryLabel(product) {
  return product.categoria_nome || String(product.categoria || "").replaceAll("_", " ");
}
function categoriesFromProducts(products = []) {
  const seen = new Set();
  const categories = [["ALL", "Todos"]];
  [...products]
    .sort(
      (a, b) =>
        Number(a.categoria_ordem ?? 9999) - Number(b.categoria_ordem ?? 9999) ||
        categoryLabel(a).localeCompare(categoryLabel(b), "pt-BR")
    )
    .forEach(product => {
      const id = String(product.categoria || "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      categories.push([id, categoryLabel(product)]);
    });
  return categories;
}
function categoryFilters(products, active = "ALL") {
  const categories = categoriesFromProducts(products);
  return `<div class="rp-menu__filters" role="group" aria-label="Filtrar cardápio por categoria">${categories.map(([value, label]) => `<button type="button" class="rp-menu__filter${active === value ? " is-active" : ""}" data-catalog-category="${value}" aria-pressed="${active === value}">${label}</button>`).join("")}</div>`;
}
function menuHeading(count = null) {
  return `<div class="rp-menu__head"><div class="rp-menu__heading-copy"><h2 class="rp-menu__title" id="rp-menu-title">Cardápio</h2></div>${count === null ? "" : `<span class="rp-menu__count">${count} ${count === 1 ? "sabor hoje" : "sabores hoje"}</span>`}</div>`;
}
function shell(content, products = [], activeCategory = "ALL") {
  return `<section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading()}${categoryFilters(products, activeCategory)}${content}</div></section>`;
}
function cartQuantity(cart, product) {
  return Number(cart.get(String(product.id))) || 0;
}
function rememberQuantities(list, cart) {
  renderedQuantities = new Map(
    list.map(product => [String(product.id), cartQuantity(cart, product)])
  );
}
function productsRegion() {
  if (typeof document === "undefined") return null;
  return document.querySelector('#rp-app [data-region="products"]');
}
function findProductCard(region, productId) {
  return [...region.querySelectorAll("[data-product-card]")].find(
    card => card.dataset.productCard === productId
  );
}
function patchChangedCards(list, cart) {
  const region = productsRegion();
  if (!region?.firstElementChild) return false;

  list.forEach(product => {
    const id = String(product.id);
    const quantity = cartQuantity(cart, product);
    if (renderedQuantities.get(id) === quantity) return;

    const card = findProductCard(region, id);
    if (card) card.outerHTML = renderProductCard(product, quantity);
    renderedQuantities.set(id, quantity);
  });

  return true;
}
function rememberRender(products, status, activeCategory, list, cart, markup) {
  renderedProducts = products;
  renderedStatus = status;
  renderedCategory = activeCategory;
  rememberQuantities(list, cart);
  stableMarkup = markup;
  return markup;
}
export function renderProductList(
  products = [],
  cart = new Map(),
  status = "ready",
  activeCategory = "ALL"
) {
  const all = visibleProducts(products);
  const validCategories = new Set(categoriesFromProducts(all).map(([id]) => id));
  const resolvedCategory = validCategories.has(activeCategory) ? activeCategory : "ALL";

  if (status === "loading") {
    const markup = shell(
      `<div class="rp-menu__skeleton" aria-label="Carregando cardápio"><span></span><span></span><span></span></div>`,
      all,
      resolvedCategory
    );
    return rememberRender(products, status, resolvedCategory, [], cart, markup);
  }
  if (status === "error") {
    const markup = shell(
      `<div class="rp-menu__empty"><strong>Não conseguimos carregar o cardápio agora.</strong><p>Tente novamente em instantes.</p><button class="rp-btn rp-btn--ghost" type="button" data-reload-products>Tentar novamente</button></div>`,
      all,
      resolvedCategory
    );
    return rememberRender(products, status, resolvedCategory, [], cart, markup);
  }

  if (!all.length) {
    const markup = shell(
      `<div class="rp-menu__empty"><strong>Os doces acabaram por enquanto.</strong><p>Quando houver novidades, elas aparecem aqui.</p></div>`,
      all,
      resolvedCategory
    );
    return rememberRender(products, status, resolvedCategory, [], cart, markup);
  }

  const list =
    resolvedCategory === "ALL"
      ? all
      : all.filter(product => product.categoria === resolvedCategory);
  const sameStructure =
    renderedProducts === products &&
    renderedStatus === status &&
    renderedCategory === resolvedCategory;

  if (sameStructure && stableMarkup && patchChangedCards(list, cart)) return stableMarkup;

  const categoryChanged = renderedCategory !== null && renderedCategory !== resolvedCategory;
  const menuClass = `rp-menu rp-section${categoryChanged ? " rp-menu--category-update" : ""}`;
  const emptyCategory = `<div class="rp-menu__empty"><strong>Nenhum doce desta categoria disponível agora.</strong><p>Você pode conferir as outras opções do cardápio.</p></div>`;
  const markup = `<section class="${menuClass}" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading(list.length)}${categoryFilters(all, resolvedCategory)}${list.length ? `<div class="rp-menu__grid">${list.map(product => renderProductCard(product, cartQuantity(cart, product))).join("")}</div>` : emptyCategory}</div></section>`;

  return rememberRender(products, status, resolvedCategory, list, cart, markup);
}
