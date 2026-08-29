const money = cents =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderCheckout({ open = false, items = [], summary = {}, checkout = {} } = {}) {
  const hiddenAttribute = open ? "" : " hidden";
  const rows = items
    .map(
      ({ product, quantity }) => `
    <li class="rp-checkout__item">
      <span>${esc(product.nome || product.name || "Produto")} × ${quantity}</span>
      <strong>${money((Number(product.preco_centavos) || 0) * quantity)}</strong>
    </li>
  `
    )
    .join("");

  return `
    <div class="rp-checkout"${hiddenAttribute} data-checkout-root aria-hidden="${!open}">
      <button class="rp-checkout__backdrop" type="button" data-close-checkout aria-label="Fechar checkout"></button>
      <section class="rp-checkout__sheet" role="dialog" aria-modal="true" aria-labelledby="rp-checkout-title">
        <div class="rp-sheet-handle" aria-hidden="true"></div>
        <button class="rp-icon-button" type="button" data-close-checkout aria-label="Voltar">×</button>
        <header class="rp-checkout__header">
          <p class="rp-kicker">Finalizar pedido</p>
          <h2 id="rp-checkout-title">Quase lá 🍰</h2>
          <p>Preencha seus dados e escolha como deseja pagar.</p>
        </header>
        <div class="rp-checkout__summary">
          <ul>${rows || "<li>Seu pedido está vazio.</li>"}</ul>
          <div class="rp-checkout__total"><span>Total</span><strong>${money(summary.totalCents)}</strong></div>
        </div>
        <form class="rp-checkout__form" data-checkout-form>
          <label>Nome<input name="name" autocomplete="name" value="${esc(checkout.name || "")}" required minlength="2" maxlength="100" data-checkout-field="name"></label>
          <label>E-mail<input name="email" type="email" autocomplete="email" value="${esc(checkout.email || "")}" required maxlength="160" data-checkout-field="email"></label>
          <label>WhatsApp<input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" value="${esc(checkout.whatsapp || "")}" required maxlength="13" data-checkout-field="whatsapp"></label>
          <fieldset>
            <legend>Pagamento</legend>
            <label class="rp-payment-option"><input type="radio" name="paymentMethod" value="PIX" checked data-checkout-field="paymentMethod"> Pix</label>
            <label class="rp-payment-option" aria-disabled="true"><input type="radio" name="paymentMethod" value="CARD" disabled> Cartão <small>em breve</small></label>
          </fieldset>
          <label>Observação <span>(opcional)</span><textarea name="note" rows="2" maxlength="500" data-checkout-field="note">${esc(checkout.note || "")}</textarea></label>
          <button class="rp-btn rp-btn--primary rp-checkout__submit" type="submit" data-submit-checkout>Continuar para pagamento</button>
        </form>
      </section>
    </div>
  `;
}
