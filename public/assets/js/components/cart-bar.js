const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function renderCartBar(summary) {
  if (!summary || summary.items <= 0) return "";

  return `
    <aside class="rp-cart-bar" aria-label="Resumo do carrinho">
      <div class="rp-cart-bar__info">
        <span class="rp-cart-bar__count">${summary.items} ${summary.items === 1 ? "item" : "itens"}</span>
        <strong class="rp-cart-bar__total">${money.format(summary.totalCents / 100)}</strong>
      </div>
      <button class="rp-cart-bar__cta" type="button" data-open-cart>Ver pedido <span aria-hidden="true">→</span></button>
    </aside>
  `;
}
