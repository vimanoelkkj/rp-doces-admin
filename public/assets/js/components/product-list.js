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

function shell(content) {
  return `<section class="rp-menu rp-section" id="cardapio"><div class="rp-container"><div class="rp-menu__head"><div><p class="rp-menu__eyebrow">Cardápio</p><h2 class="rp-menu__title">O que tem hoje</h2></div></div>${content}</div></section>`;
}

export function renderProductList(products = [], cart = new Map(), status = "ready") {
  if (status === "loading") {
    return shell(
      `<div class="rp-menu__skeleton" aria-label="Carregando cardápio"><span></span><span></span><span></span></div>`
    );
  }

  if (status === "error") {
    return shell(
      `<div class="rp-menu__empty"><strong>Não conseguimos carregar o cardápio agora.</strong><p>Tente novamente em instantes.</p><button class="rp-btn rp-btn--ghost" type="button" data-reload-products>Tentar novamente</button></div>`
    );
  }

  const list = visibleProducts(products);
  if (!list.length) {
    return shell(
      `<div class="rp-menu__empty"><strong>Os doces acabaram por enquanto.</strong><p>Quando houver novidades, elas aparecem aqui.</p></div>`
    );
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
