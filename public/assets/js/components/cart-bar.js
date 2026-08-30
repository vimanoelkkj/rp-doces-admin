import { formatMoney } from "../utils/money.js";

let previousItemCount = 0;

function syncCartBar(summary = {}) {
  if (typeof document === "undefined") return;
  const bar = document.querySelector('[data-region="cart-bar"] .rp-cart-bar');
  if (!bar) return;
  const items = Number(summary.items) || 0;
  const totalCents = Number(summary.totalCents) || 0;
  const count = bar.querySelector(".rp-cart-bar__count");
  const total = bar.querySelector(".rp-cart-bar__total");
  const increased = items > previousItemCount;

  if (count) count.textContent = `${items} ${items === 1 ? "item" : "itens"}`;
  if (total) total.textContent = formatMoney(totalCents);

  bar.classList.remove("rp-cart-bar--feedback");
  if (increased && items > 0) {
    void bar.offsetWidth;
    bar.classList.add("rp-cart-bar--feedback");
  }

  previousItemCount = items;
}

export function renderCartBar(summary = {}) {
  const items = Number(summary.items) || 0;
  if (items <= 0) {
    previousItemCount = 0;
    return "";
  }

  queueMicrotask(() => syncCartBar(summary));
  return `<aside class="rp-cart-bar" aria-label="Resumo do carrinho"><div class="rp-cart-bar__info"><span class="rp-cart-bar__count"></span><strong class="rp-cart-bar__total"></strong></div><button class="rp-cart-bar__cta" type="button" data-open-cart>Ver pedido <span aria-hidden="true">→</span></button></aside>`;
}
