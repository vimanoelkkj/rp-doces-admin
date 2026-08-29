import { renderProductCard } from "./product-card.js";
import { storefrontProducts } from "../utils/product-filter.js";
import { sortProducts } from "../utils/product-sort.js";
function visibleProducts(products = []) {
  return sortProducts(storefrontProducts(products));
}
function menuHeading(count = null) {
  return `<div class="rp-menu__head"><div class="rp-menu__heading-copy"><p class="rp-menu__eyebrow">Cardápio artesanal</p><h2 class="rp-menu__title" id="rp-menu-title">Um carinho em forma de doce</h2><p class="rp-menu__lede">Bolo no pote e mini pudim feitos à mão, prontos para adoçar sua pausa.</p></div>${count === null ? "" : `<span class="rp-menu__count">${count} ${count === 1 ? "doce" : "doces"}</span>`}</div>`;
}
function shell(content) {
  return `<section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading()}${content}</div></section>`;
}
export function renderProductList(products = [], cart = new Map(), status = "ready") {
  if (status === "loading")
    return shell(
      `<div class="rp-menu__skeleton" aria-label="Carregando cardápio"><span></span><span></span><span></span></div>`
    );
  if (status === "error")
    return shell(
      `<div class="rp-menu__empty"><strong>Não conseguimos carregar o cardápio agora.</strong><p>Tente novamente em instantes.</p><button class="rp-btn rp-btn--ghost" type="button" data-reload-products>Tentar novamente</button></div>`
    );
  const list = visibleProducts(products);
  if (!list.length)
    return shell(
      `<div class="rp-menu__empty"><strong>Os doces acabaram por enquanto.</strong><p>Quando houver novidades, elas aparecem aqui.</p></div>`
    );
  return `<section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title"><div class="rp-container">${menuHeading(list.length)}<div class="rp-menu__grid">${list.map(product => renderProductCard(product, cart.get(String(product.id)) || 0)).join("")}</div></div></section>`;
}
