const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderCart({ open, items, summary }) {
  if (!open || !items.length) return "";

  return `
    <div class="rp-cart-overlay" data-close-cart aria-hidden="false">
      <section class="rp-cart-sheet" role="dialog" aria-modal="true" aria-labelledby="rp-cart-title" data-cart-sheet>
        <div class="rp-cart-sheet__handle" aria-hidden="true"></div>
        <header class="rp-cart-sheet__head">
          <div>
            <p class="rp-cart-sheet__eyebrow">Pedido</p>
            <h2 id="rp-cart-title">Seu pedido</h2>
          </div>
          <button type="button" class="rp-cart-sheet__close" data-close-cart aria-label="Fechar pedido">×</button>
        </header>

        <div class="rp-cart-sheet__items">
          ${items
            .map(
              ({ product, quantity }) => `
            <article class="rp-cart-item">
              <div class="rp-cart-item__copy">
                <strong>${esc(product.nome || "Produto")}</strong>
                <span>${money.format(((Number(product.preco_centavos) || 0) * quantity) / 100)}</span>
              </div>
              <div class="rp-cart-item__stepper" aria-label="Quantidade de ${esc(product.nome || "produto")}">
                <button type="button" data-cart-delta="-1" data-product-id="${esc(product.id)}" aria-label="Remover uma unidade">−</button>
                <strong>${quantity}</strong>
                <button type="button" data-cart-delta="1" data-product-id="${esc(product.id)}" ${quantity >= Number(product.estoque || 0) ? "disabled" : ""} aria-label="Adicionar uma unidade">+</button>
              </div>
            </article>
          `
            )
            .join("")}
        </div>

        <div class="rp-cart-total">
          <span>Total</span>
          <strong>${money.format(summary.totalCents / 100)}</strong>
        </div>

        <div class="rp-cart-sheet__actions">
          <button class="rp-btn rp-btn--primary rp-cart-sheet__primary" type="button" data-start-checkout>Continuar pedido <span aria-hidden="true">→</span></button>
          <button class="rp-btn rp-btn--ghost" type="button" data-close-cart>Escolher mais um</button>
        </div>
      </section>
    </div>
  `;
}
