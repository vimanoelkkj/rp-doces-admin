import { formatMoney } from "../utils/money.js";
export function renderSiteHeader(summary = {}) {
  const count = Number(summary.items) || 0;
  const label = formatMoney(Number(summary.totalCents) || 0);
  return `<header class="rp-site-header"><div class="rp-container rp-site-header__inner"><a class="rp-site-header__brand" href="#inicio" aria-label="R&P Doces, início"><span class="rp-site-header__mark">R&P</span><span class="rp-site-header__name">Doces</span></a><nav class="rp-site-header__nav" aria-label="Navegação principal"><a href="#cardapio">Cardápio</a><button class="rp-site-header__menu" type="button" data-open-menu>Menu</button></nav>${count > 0 ? `<button class="rp-site-header__cart" type="button" data-open-cart><span>${count} ${count === 1 ? "item" : "itens"}</span><strong>${label}</strong></button>` : ""}</div></header>`;
}
