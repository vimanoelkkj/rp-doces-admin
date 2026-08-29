export function renderMobileMenu(open = false) {
  if (!open) return "";
  return `
    <div class="rp-mobile-menu" data-menu-root>
      <button class="rp-mobile-menu__backdrop" type="button" data-close-menu aria-label="Fechar menu"></button>
      <section class="rp-mobile-menu__sheet" role="dialog" aria-modal="true" aria-labelledby="rp-mobile-menu-title">
        <div class="rp-sheet-handle" aria-hidden="true"></div>
        <div class="rp-mobile-menu__head">
          <p class="rp-kicker">R&P Doces</p>
          <button class="rp-icon-button" type="button" data-close-menu aria-label="Fechar menu">×</button>
        </div>
        <h2 id="rp-mobile-menu-title">O que você procura?</h2>
        <nav class="rp-mobile-menu__links" aria-label="Menu do site">
          <a href="#inicio" data-close-menu>Início <span>→</span></a>
          <a href="#cardapio" data-close-menu>Cardápio <span>→</span></a>
          <button type="button" data-open-party>Pedidos para festa <span>→</span></button>
        </nav>
      </section>
    </div>
  `;
}
