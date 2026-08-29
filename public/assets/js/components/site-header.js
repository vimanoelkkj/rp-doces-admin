export function renderSiteHeader(summary = {}) {
  const count = Number(summary.items) || 0;
  return `<header class="rp-site-header"><div class="rp-container rp-site-header__inner"><a class="rp-site-header__brand" href="#inicio" aria-label="R&P Doces, início">R&P Doces</a><div class="rp-site-header__actions">${count > 0 ? `<button class="rp-site-header__cart" type="button" data-open-cart aria-label="Abrir carrinho com ${count} ${count === 1 ? "item" : "itens"}"><span class="rp-site-header__bag" aria-hidden="true"></span><span class="rp-site-header__badge">${count}</span></button>` : ""}<button class="rp-site-header__menu" type="button" data-open-menu aria-label="Abrir menu"><span aria-hidden="true"></span></button></div></div></header>`;
}
