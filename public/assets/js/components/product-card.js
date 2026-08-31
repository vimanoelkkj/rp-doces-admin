import { escapeHtml as esc } from "../utils/html.js";
import { formatBrlCents } from "../utils/currency.js";
import { productName, productDescription } from "../utils/product-copy.js";
import { productPriceCents, productOriginalPriceCents } from "../utils/product-price.js";
import { hasActivePromotion } from "../utils/promotion.js";
import { stockCopy } from "../utils/stock-copy.js";
import { stockCount, isProductAvailable, clampQuantity } from "../utils/stock.js";

export function renderProductCard(product, quantity = 0) {
  const stock = stockCount(product);
  const soldOut = !isProductAvailable(product);
  const currentCents = productPriceCents(product);
  const originalCents = productOriginalPriceCents(product);
  const originalPrice = hasActivePromotion(product)
    ? `<del class="rp-product-card__old-price">${formatBrlCents(originalCents)}</del>`
    : "";
  const badge = product.destaque ? '<span class="rp-product-card__badge">Mais pedido</span>' : "";
  const availability =
    stock <= 3 ? `<span class="rp-product-card__stock">${esc(stockCopy(product))}</span>` : "";
  const safeQuantity = clampQuantity(product, quantity);
  const name = productName(product);
  const imageUrl = typeof product.image_url === "string" ? product.image_url.trim() : "";
  const media = imageUrl
    ? `<img class="rp-product-card__image" src="${esc(imageUrl)}" alt="${esc(name)}" loading="lazy" decoding="async" />`
    : `<span class="rp-product-card__media-label">FOTO DO PRODUTO</span><span class="rp-product-card__media-name">${esc(name)}</span>`;
  const cartControl =
    safeQuantity > 0
      ? `<div class="rp-product-card__stepper" aria-label="Quantidade de ${esc(name)}"><button type="button" data-cart-delta="-1" data-product-id="${esc(product.id)}" aria-label="Remover uma unidade">−</button><strong>${safeQuantity}</strong><button type="button" data-cart-delta="1" data-product-id="${esc(product.id)}" ${safeQuantity >= stock ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button></div>`
      : `<button class="rp-product-card__add" type="button" data-cart-delta="1" data-product-id="${esc(product.id)}" ${soldOut ? "disabled" : ""} aria-label="Adicionar ${esc(name)} ao carrinho">+</button>`;
  return `<article class="rp-product-card" data-product-card="${esc(product.id)}"><div class="rp-product-card__media" role="img" aria-label="${esc(name)}">${media}${badge}</div><div class="rp-product-card__body"><h3 class="rp-product-card__title">${esc(name)}</h3><p class="rp-product-card__description">${esc(productDescription(product))}</p><div class="rp-product-card__footer"><div class="rp-product-card__pricing">${originalPrice}<strong class="rp-product-card__price">${soldOut ? "Esgotado" : formatBrlCents(currentCents)}</strong>${availability}</div>${cartControl}</div></div></article>`;
}
