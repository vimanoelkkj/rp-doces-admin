import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";

let cartMounted = false;
let stableMarkup = "";

function thumbMarkup(product) {
  const url = String(product?.image_url || "");
  if (!url) return "";
  return `<div class="rp-cart-item__thumb"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" /></div>`;
}

function cartItemMarkup({ product, quantity }) {
  const name = escapeHtml(product.nome || "Produto");
  const id = escapeHtml(product.id);
  const unit = Number(product.preco_centavos) || 0;
  const hasThumb = Boolean(product.image_url);
  return `<article class="rp-cart-item${hasThumb ? "" : " rp-cart-item--no-thumb"}" data-cart-item="${id}">${thumbMarkup(product)}<div class="rp-cart-item__main"><strong class="rp-cart-item__name">${name}</strong><span class="rp-cart-item__unit">${formatMoney(unit)} cada</span><div class="rp-cart-item__controls"><div class="rp-cart-item__stepper" aria-label="Quantidade de ${name}"><button type="button" data-cart-delta="-1" data-product-id="${id}" aria-label="Remover uma unidade">−</button><strong data-cart-item-quantity>${quantity}</strong><button type="button" data-cart-delta="1" data-product-id="${id}" ${quantity >= Number(product.estoque || 0) ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button></div><button class="rp-cart-item__trash" type="button" data-cart-remove data-product-id="${id}" aria-label="Remover ${name} do pedido"><span class="rp-cart-item__trash-can" aria-hidden="true"></span><span class="rp-cart-item__trash-lid" aria-hidden="true"></span><span class="rp-cart-item__trash-grip" aria-hidden="true"></span></button></div></div><strong class="rp-cart-item__price" data-cart-item-price>${formatMoney(unit * quantity)}</strong></article>`;
}

function syncThumb(row, product) {
  const url = String(product?.image_url || "");
  let thumb = row.querySelector(".rp-cart-item__thumb");

  if (!url) {
    thumb?.remove();
    row.classList.add("rp-cart-item--no-thumb");
    return;
  }

  row.classList.remove("rp-cart-item--no-thumb");
  if (!thumb) {
    thumb = document.createElement("div");
    thumb.className = "rp-cart-item__thumb";
    row.prepend(thumb);
  }

  let image = thumb.querySelector("img");
  if (!image) {
    image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    thumb.appendChild(image);
  }
  if (image.getAttribute("src") !== url) image.src = url;
}

function cartMarkup(items, summary) {
  return `<div class="rp-cart-overlay" aria-hidden="false"><button class="rp-cart-overlay__backdrop" type="button" data-close-cart aria-label="Fechar pedido"></button><section class="rp-cart-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-cart-title" data-cart-sheet><div class="rp-cart-sheet__handle" aria-hidden="true"></div><header class="rp-cart-sheet__head"><h2 id="rp-cart-title">Seu pedido</h2><button type="button" class="rp-cart-sheet__close" data-close-cart aria-label="Fechar pedido">×</button></header><div class="rp-cart-sheet__items">${items.map(cartItemMarkup).join("")}</div><div class="rp-cart-total"><span>Total</span><strong data-cart-total>${formatMoney(summary.totalCents)}</strong></div><p class="rp-cart-sheet__note">Os itens ficam sujeitos à disponibilidade até a confirmação do pedido.</p><div class="rp-cart-sheet__actions"><button class="rp-btn rp-btn--primary rp-cart-sheet__primary" type="button" data-start-checkout>Continuar para pagamento <span aria-hidden="true">›</span></button><button class="rp-cart-sheet__continue" type="button" data-close-cart>Continuar comprando</button></div></section></div>`;
}

function patchOpenCart(items, summary) {
  if (typeof document === "undefined") return false;
  const sheet = document.querySelector("#rp-app [data-cart-sheet]");
  if (!sheet) return false;

  const itemsRoot = sheet.querySelector(".rp-cart-sheet__items");
  if (!itemsRoot) return false;

  const nextIds = new Set(items.map(({ product }) => String(product.id)));
  itemsRoot.querySelectorAll("[data-cart-item]").forEach(item => {
    if (!nextIds.has(item.dataset.cartItem)) item.remove();
  });

  items.forEach(item => {
    const id = String(item.product.id);
    let row = [...itemsRoot.querySelectorAll("[data-cart-item]")].find(
      element => element.dataset.cartItem === id
    );
    if (!row) {
      itemsRoot.insertAdjacentHTML("beforeend", cartItemMarkup(item));
      return;
    }

    syncThumb(row, item.product);
    const quantity = row.querySelector("[data-cart-item-quantity]");
    const price = row.querySelector("[data-cart-item-price]");
    const addButton = row.querySelector('[data-cart-delta="1"]');
    if (quantity) quantity.textContent = String(item.quantity);
    if (price)
      price.textContent = formatMoney((Number(item.product.preco_centavos) || 0) * item.quantity);
    if (addButton) addButton.disabled = item.quantity >= Number(item.product.estoque || 0);
  });

  const total = sheet.querySelector("[data-cart-total]");
  if (total) total.textContent = formatMoney(summary.totalCents);
  return true;
}

export function renderCart({ open, items, summary }) {
  if (!open || !items.length) {
    cartMounted = false;
    stableMarkup = "";
    return "";
  }

  if (cartMounted && stableMarkup && patchOpenCart(items, summary)) return stableMarkup;

  stableMarkup = cartMarkup(items, summary);
  cartMounted = true;
  return stableMarkup;
}
