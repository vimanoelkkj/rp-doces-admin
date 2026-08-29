import { renderProductCard } from "./product-card.js";
import { storefrontProducts } from "../utils/product-filter.js";
import { sortProducts } from "../utils/product-sort.js";

const CATEGORIES = [
  ["ALL", "Todos"],
  ["BOLO_NO_POTE", "Bolos no pote"],
  ["MINI_PUDIM", "Mini pudins"]
];

function visibleProducts(products = []) {
  return sortProducts(storefrontProducts(products));
}
function categoryFilters(active = "ALL") {
  return `<div class="rp-menu__filters" role="group" aria-label="Filtrar cardápio por categoria">${CATEGORIES.map(([value, label]) => `<button type="button" class="rp-menu__filter${active === value ? " is-active" : ""}" data-catalog-category="${value}" aria-pressed="${active === value}">${label}</button>`).join("")}</div>`;
}
function menuHeading(count = null) {
  return `<div class="rp-menu__head"><div class="rp-menu__heading-copy"><h2 class="rp-menu__title" id="rp-menu-title">Cardápio</h2></div>${count === null ? "" : `<span class="rp-menu__count">${count} ${count === 1 ? "sabor hoje" : "sabores hoje"}</span>`}</div>`;
}
function shell(content, activeCategory = "ALL") {
  return `<section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading()}${categoryFilters(activeCategory)}${content}</div></section>`;
}
export function renderProductList(
  products = [],
  cart = new Map(),
  status = "ready",
  activeCategory = "ALL"
) {
  if (status === "loading")
    return shell(
      `<div class="rp-menu__skeleton" aria-label="Carregando cardápio"><span></span><span></span><span></span></div>`,
      activeCategory
    );
  if (status === "error")
    return shell(
      `<div class="rp-menu__empty"><strong>Não conseguimos carregar o cardápio agora.</strong><p>Tente novamente em instantes.</p><button class="rp-btn rp-btn--ghost" type="button" data-reload-products>Tentar novamente</button></div>`,
      activeCategory
    );
  const all = visibleProducts(products);
  if (!all.length)
    return shell(
      `<div class="rp-menu__empty"><strong>Os doces acabaram por enquanto.</strong><p>Quando houver novidades, elas aparecem aqui.</p></div>`,
      activeCategory
    );
  const list =
    activeCategory === "ALL" ? all : all.filter(product => product.categoria === activeCategory);
  const emptyCategory = `<div class="rp-menu__empty"><strong>Nenhum doce desta categoria disponível agora.</strong><p>Você pode conferir as outras opções do cardápio.</p></div>`;
  return `<section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading(list.length)}${categoryFilters(activeCategory)}${list.length ? `<div class="rp-menu__grid">${list.map(product => renderProductCard(product, cart.get(String(product.id)) || 0)).join("")}</div>` : emptyCategory}</div></section>`;
}
