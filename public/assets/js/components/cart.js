import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";
export function renderCart({ open, items, summary }) {
  if (!open || !items.length) return "";
  return `<div class="rp-cart-overlay" aria-hidden="false"><button class="rp-cart-overlay__backdrop" type="button" data-close-cart aria-label="Fechar pedido"></button><section class="rp-cart-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-cart-title" data-cart-sheet><div class="rp-cart-sheet__handle" aria-hidden="true"></div><header class="rp-cart-sheet__head"><h2 id="rp-cart-title">Seu pedido</h2><button type="button" class="rp-cart-sheet__close" data-close-cart aria-label="Fechar pedido">×</button></header><div class="rp-cart-sheet__items">${items
    .map(({ product, quantity }) => {
      const name = escapeHtml(product.nome || "Produto"),
        id = escapeHtml(product.id),
        unit = Number(product.preco_centavos) || 0;
      return `<article class="rp-cart-item"><div class="rp-cart-item__thumb" aria-hidden="true"></div><div class="rp-cart-item__main"><strong class="rp-cart-item__name">${name}</strong><span class="rp-cart-item__unit">${formatMoney(unit)} cada</span><div class="rp-cart-item__controls"><div class="rp-cart-item__stepper" aria-label="Quantidade de ${name}"><button type="button" data-cart-delta="-1" data-product-id="${id}" aria-label="Remover uma unidade">−</button><strong>${quantity}</strong><button type="button" data-cart-delta="1" data-product-id="${id}" ${quantity >= Number(product.estoque || 0) ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button></div><button class="rp-cart-item__trash" type="button" data-cart-remove data-product-id="${id}" aria-label="Remover ${name} do pedido"><span class="rp-cart-item__trash-can" aria-hidden="true"></span><span class="rp-cart-item__trash-lid" aria-hidden="true"></span><span class="rp-cart-item__trash-grip" aria-hidden="true"></span></button></div></div><strong class="rp-cart-item__price">${formatMoney(unit * quantity)}</strong></article>`;
    })
    .join(
      ""
    )}</div><div class="rp-cart-total"><span>Total</span><strong>${formatMoney(summary.totalCents)}</strong></div><p class="rp-cart-sheet__note">Os itens ficam sujeitos à disponibilidade até a confirmação do pedido.</p><div class="rp-cart-sheet__actions"><button class="rp-btn rp-btn--primary rp-cart-sheet__primary" type="button" data-start-checkout>Continuar para pagamento <span aria-hidden="true">›</span></button><button class="rp-cart-sheet__continue" type="button" data-close-cart>Continuar comprando</button></div></section></div>`;
}
