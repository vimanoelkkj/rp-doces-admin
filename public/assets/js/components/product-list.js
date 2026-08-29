import { renderProductCard } from "./product-card.js";

function visibleProducts(products = []) {
  return [...products]
    .filter(product => product && product.ativo !== false)
    .sort((a, b) => {
      const highlight = Number(Boolean(b.destaque)) - Number(Boolean(a.destaque));
      if (highlight) return highlight;
      return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
    });
}

export function renderProductList(products = [], cart = new Map()) {
  const list = visibleProducts(products);
  if (!list.length) {
    return `<section class="rp-menu rp-section" id="cardapio"><div class="rp-container"><div class="rp-menu__head"><div><p class="rp-menu__eyebrow">Cardápio</p><h2 class="rp-menu__title">O que tem hoje</h2></div></div><p class="rp-menu__empty">Nenhum doce disponível no momento.</p></div></section>`;
  }

  return `
    <section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title">
      <div class="rp-container">
        <div class="rp-menu__head">
          <div><p class="rp-menu__eyebrow">Cardápio</p><h2 class="rp-menu__title" id="rp-menu-title">O que tem hoje</h2></div>
          <span class="rp-menu__count">${list.length} ${list.length === 1 ? "doce" : "doces"}</span>
        </div>
        <div class="rp-menu__grid">${list.map(product => renderProductCard(product, cart.get(String(product.id)) || 0)).join("")}</div>
      </div>
    </section>
  `;
}
