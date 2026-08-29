const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderProductCard(product, quantity = 0) {
  const stock = Number(product.estoque) || 0;
  const soldOut = !product.disponivel || stock <= 0;
  const currentCents = Number(product.preco_centavos) || 0;
  const originalCents = Number(product.preco_original_centavos) || 0;
  const price = money.format(currentCents / 100);
  const originalPrice =
    product.promocao_vigente && originalCents > currentCents
      ? `<del class="rp-product-card__old-price">${money.format(originalCents / 100)}</del>`
      : "";
  const badge = product.destaque ? '<span class="rp-product-card__badge">Mais pedido</span>' : "";
  const stockLabel =
    stock === 1 && !soldOut ? '<span class="rp-product-card__stock">Última unidade</span>' : "";
  const safeQuantity = Math.min(Math.max(0, Number(quantity) || 0), stock);

  const cartControl =
    safeQuantity > 0
      ? `<div class="rp-product-card__stepper" aria-label="Quantidade de ${esc(product.nome || "produto")}"><button type="button" data-cart-delta="-1" data-product-id="${esc(product.id)}" aria-label="Remover uma unidade">−</button><strong>${safeQuantity}</strong><button type="button" data-cart-delta="1" data-product-id="${esc(product.id)}" ${safeQuantity >= stock ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button></div>`
      : `<button class="rp-product-card__add" type="button" data-cart-delta="1" data-product-id="${esc(product.id)}" ${soldOut ? "disabled" : ""} aria-label="Adicionar ${esc(product.nome || "produto")} ao carrinho">+</button>`;

  return `
    <article class="rp-product-card" data-product-card="${esc(product.id)}">
      <div class="rp-product-card__media" aria-hidden="true">${badge}<span class="rp-product-card__media-copy">FOTO DO PRODUTO</span></div>
      <div class="rp-product-card__body">
        <h3 class="rp-product-card__title">${esc(product.nome || "Produto")}</h3>
        <p class="rp-product-card__description">${esc(product.descricao || "")}</p>
        <div class="rp-product-card__footer">
          <div class="rp-product-card__pricing">${originalPrice}<strong class="rp-product-card__price">${soldOut ? "Esgotado" : price}</strong>${stockLabel}</div>
          ${cartControl}
        </div>
      </div>
    </article>
  `;
}
