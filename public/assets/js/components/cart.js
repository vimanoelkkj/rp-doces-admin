import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";
import { renderSiteHeader } from "./site-header.js";
import { renderSiteFooter } from "./site-footer.js";

function thumbMarkup(product) {
  const url = String(product?.image_url || "");
  if (!url) return `<div class="rp-cart-page__thumb rp-cart-page__thumb--empty" aria-hidden="true"></div>`;
  return `<div class="rp-cart-page__thumb"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" /></div>`;
}

function cartItemMarkup({ product, quantity }) {
  const name = escapeHtml(product.nome || product.name || "Produto");
  const description = escapeHtml(product.descricao || product.description || "");
  const id = escapeHtml(product.id);
  const unit = Number(product.preco_centavos) || 0;
  const total = unit * quantity;

  return `<article class="rp-cart-page__item" data-cart-item="${id}">
    ${thumbMarkup(product)}
    <div class="rp-cart-page__item-copy">
      <strong>${name}</strong>
      ${description ? `<p>${description}</p>` : ""}
    </div>
    <div class="rp-cart-page__stepper" aria-label="Quantidade de ${name}">
      <button type="button" data-cart-delta="-1" data-product-id="${id}" aria-label="Remover uma unidade">−</button>
      <strong>${quantity}</strong>
      <button type="button" data-cart-delta="1" data-product-id="${id}" ${quantity >= Number(product.estoque || 0) ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button>
    </div>
    <div class="rp-cart-page__price">
      <strong>${formatMoney(total)}</strong>
      <small>${formatMoney(unit)} cada</small>
    </div>
    <button class="rp-cart-page__remove" type="button" data-cart-remove data-product-id="${id}" aria-label="Remover ${name} da sacola">Remover</button>
  </article>`;
}

function emptyMarkup() {
  return `<main class="rp-cart-page__empty">
    <div>
      <span class="rp-cart-page__eyebrow">Sua seleção</span>
      <h1>Sua sacola está vazia</h1>
      <p>Escolha seus doces no cardápio e eles aparecem aqui.</p>
      <button type="button" data-close-cart>Voltar ao cardápio</button>
    </div>
  </main>`;
}

function filledMarkup(items, summary) {
  return `<main class="rp-cart-page__main">
    <section class="rp-cart-page__items-area">
      <div class="rp-cart-page__title-row">
        <h1>Sua sacola <span>(${items.length} ${items.length === 1 ? "item" : "itens"})</span></h1>
      </div>
      <div class="rp-cart-page__items">
        ${items.map(cartItemMarkup).join("")}
      </div>
    </section>

    <aside class="rp-cart-page__aside">
      <section class="rp-cart-page__coupon" aria-label="Cupom de desconto">
        <strong>Cupom de desconto</strong>
        <div>
          <input type="text" placeholder="Digite o código" aria-label="Cupom de desconto" disabled />
          <button type="button" disabled>Aplicar</button>
        </div>
      </section>

      <section class="rp-cart-page__summary">
        <h2>Resumo do pedido</h2>
        <div class="rp-cart-page__summary-line"><span>Subtotal</span><strong>${formatMoney(summary.totalCents)}</strong></div>
        <div class="rp-cart-page__summary-line"><span>Entrega / frete</span><strong>A combinar</strong></div>
        <div class="rp-cart-page__summary-total"><span>Total</span><strong>${formatMoney(summary.totalCents)}</strong></div>
        <button class="rp-cart-page__checkout" type="button" data-start-checkout>Finalizar pedido <span aria-hidden="true">→</span></button>
      </section>
    </aside>
  </main>`;
}

export function renderCart({ open = false, items = [], summary = {} } = {}) {
  if (!open) return "";

  return `<section class="rp-cart-page" role="dialog" aria-modal="true" aria-label="Sua sacola">
    ${renderSiteHeader(summary)}
    ${items.length ? filledMarkup(items, summary) : emptyMarkup()}
    ${renderSiteFooter()}
  </section>`;
}
