const money = cents =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function renderCheckout({ open = false, items = [], summary = {}, checkout = {} } = {}) {
  const hidden = open ? "" : " hidden";
  const rows = items
    .map(
      ({ product, quantity }) => `
    <li class="rp-checkout__item">
      <span>${product.nome || product.name || "Produto"} × ${quantity}</span>
      <strong>${money((Number(product.preco_centavos) || 0) * quantity)}</strong>
    </li>
  `
    )
    .join("");

  return `
    <div class="rp-checkout${hidden}" data-checkout-root aria-hidden="${!open}">
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
          <label>Nome<input name="name" autocomplete="name" value="${checkout.name || ""}" required></label>
          <label>WhatsApp<input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" value="${checkout.whatsapp || ""}" required></label>
          <fieldset>
            <legend>Pagamento</legend>
            <label class="rp-payment-option"><input type="radio" name="paymentMethod" value="PIX" ${checkout.paymentMethod !== "CARD" ? "checked" : ""}> Pix</label>
            <label class="rp-payment-option"><input type="radio" name="paymentMethod" value="CARD" ${checkout.paymentMethod === "CARD" ? "checked" : ""}> Cartão</label>
          </fieldset>
          <label>Observação <span>(opcional)</span><textarea name="note" rows="2">${checkout.note || ""}</textarea></label>
          <button class="rp-btn rp-btn--primary rp-checkout__submit" type="submit">Continuar para pagamento</button>
        </form>
      </section>
    </div>
  `;
}
