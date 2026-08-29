import { renderProductCard } from "./product-card.js";

export function renderProductList(products = [], cart = new Map()) {
  if (!products.length) {
    return `
      <section class="rp-menu rp-section" id="cardapio">
        <div class="rp-container">
          <div class="rp-menu__head">
            <div>
              <p class="rp-menu__eyebrow">Cardápio</p>
              <h2 class="rp-menu__title">O que tem hoje</h2>
            </div>
          </div>
          <p class="rp-menu__empty">Nenhum doce disponível no momento.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="rp-menu rp-section" id="cardapio" aria-labelledby="rp-menu-title">
      <div class="rp-container">
        <div class="rp-menu__head">
          <div>
            <p class="rp-menu__eyebrow">Cardápio</p>
            <h2 class="rp-menu__title" id="rp-menu-title">O que tem hoje</h2>
          </div>
          <span class="rp-menu__count">${products.length} ${products.length === 1 ? "doce" : "doces"}</span>
        </div>
        <div class="rp-menu__grid">
          ${products.map(product => renderProductCard(product, cart.get(String(product.id)) || 0)).join("")}
        </div>
      </div>
    </section>
  `;
}
