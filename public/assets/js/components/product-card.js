const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderProductCard(product) {
  const stock = Number(product.estoque) || 0;
  const soldOut = !product.disponivel || stock <= 0;
  const price = money.format((Number(product.preco_centavos) || 0) / 100);
  const badge = product.destaque ? '<span class="rp-product-card__badge">Mais pedido</span>' : "";
  const stockLabel =
    stock === 1 && !soldOut ? '<span class="rp-product-card__stock">Última unidade</span>' : "";

  return `
    <article class="rp-product-card" data-product-id="${esc(product.id)}">
      <div class="rp-product-card__media" aria-hidden="true">
        ${badge}
        <span class="rp-product-card__media-copy">FOTO DO PRODUTO</span>
      </div>
      <div class="rp-product-card__body">
        <h3 class="rp-product-card__title">${esc(product.nome || "Produto")}</h3>
        <p class="rp-product-card__description">${esc(product.descricao || "")}</p>
        <div class="rp-product-card__footer">
          <div>
            <strong class="rp-product-card__price">${soldOut ? "Esgotado" : price}</strong>
            ${stockLabel}
          </div>
          <button class="rp-product-card__add" type="button" data-add-product="${esc(product.id)}" ${soldOut ? "disabled" : ""} aria-label="Adicionar ${esc(product.nome || "produto")} ao carrinho">+</button>
        </div>
      </div>
    </article>
  `;
}
