let previousCartCount = 0;

function syncHeaderCart(summary = {}) {
  if (typeof document === "undefined") return;
  const count = Number(summary.items) || 0;
  const carts = document.querySelectorAll("#rp-app .rp-site-header__cart");
  const increased = count > previousCartCount;

  carts.forEach(cart => {
    const badge = cart.querySelector(".rp-site-header__badge");
    cart.setAttribute(
      "aria-label",
      `Abrir carrinho com ${count} ${count === 1 ? "item" : "itens"}`
    );
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }

    cart.classList.remove("rp-site-header__cart--feedback");
    if (increased && count > 0) {
      void cart.offsetWidth;
      cart.classList.add("rp-site-header__cart--feedback");
    }
  });

  previousCartCount = count;
}

function bagIcon() {
  return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M13.333 8.333a3.333 3.333 0 0 1-6.666 0M2.585 5.028h14.829M2.833 4.555A1.667 1.667 0 0 0 2.5 5.555v11.112c0 .92.746 1.667 1.667 1.667h11.666c.92 0 1.667-.746 1.667-1.667V5.555c0-.36-.117-.711-.333-1l-1.667-2.222a1.667 1.667 0 0 0-1.333-.667H5.833c-.524 0-1.018.247-1.333.667L2.833 4.555Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function menuIcon() {
  return `<span class="rp-site-header__hamburger" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

export function renderSiteHeader(summary = {}) {
  const count = Number(summary.items) || 0;
  queueMicrotask(() => syncHeaderCart(summary));

  return `<header class="rp-site-header">
    <div class="rp-site-header__inner">
      <button class="rp-site-header__brand" type="button" data-home-top aria-label="R&P Doces, início">
        <strong>R&amp;P</strong> <span>Doces</span>
      </button>

      <nav class="rp-site-header__nav" aria-label="Navegação principal">
        <button type="button" class="is-active" data-home-top>Início</button>
        <button type="button" data-show-catalog>Cardápio</button>
        <button type="button" data-show-catalog>Combos</button>
        <button type="button" data-show-catalog>Presentes</button>
        <button type="button" data-home-section="sobre">Sobre nós</button>
      </nav>

      <div class="rp-site-header__actions">
        <button class="rp-site-header__cart" type="button" data-open-cart aria-label="Abrir carrinho">
          ${bagIcon()}
          <span class="rp-site-header__badge"${count <= 0 ? " hidden" : ""}>${count}</span>
        </button>
        <button class="rp-site-header__menu rp-site-header__menu--mobile" type="button" data-open-menu aria-label="Abrir menu">
          ${menuIcon()}
        </button>
      </div>
    </div>
  </header>`;
}
