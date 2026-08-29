export function renderPartySheet(open = false) {
  if (!open) return "";
  return `
    <div class="rp-party" data-party-root>
      <button class="rp-party__backdrop" type="button" data-close-party aria-label="Fechar pedidos para festa"></button>
      <section class="rp-party__sheet" role="dialog" aria-modal="true" aria-labelledby="rp-party-title">
        <div class="rp-sheet-handle" aria-hidden="true"></div>
        <div class="rp-party__head">
          <div><p class="rp-kicker">Pedidos especiais</p><h2 id="rp-party-title">Vai ter festa? 🎉</h2></div>
          <button class="rp-icon-button" type="button" data-close-party aria-label="Fechar">×</button>
        </div>
        <p>Para quantidades maiores, encomendas e combinações especiais, fale com a R&P Doces para combinar os detalhes.</p>
        <a class="rp-btn rp-btn--primary" href="#cardapio" data-close-party>Ver o cardápio</a>
      </section>
    </div>
  `;
}
