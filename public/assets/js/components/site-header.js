let previousCartCount = 0;

function syncHeaderCart(summary = {}) {
  if (typeof document === "undefined") return;
  const count = Number(summary.items) || 0;
  const cart = document.querySelector('[data-region="header"] .rp-site-header__cart');
  if (!cart) return;
  const badge = cart.querySelector(".rp-site-header__badge");
  const increased = count > previousCartCount;

  cart.hidden = count <= 0;
  cart.setAttribute("aria-label", `Abrir carrinho com ${count} ${count === 1 ? "item" : "itens"}`);
  if (badge) badge.textContent = String(count);

  cart.classList.remove("rp-site-header__cart--feedback");
  if (increased && count > 0) {
    void cart.offsetWidth;
    cart.classList.add("rp-site-header__cart--feedback");
  }

  previousCartCount = count;
}

export function renderSiteHeader(summary = {}) {
  queueMicrotask(() => syncHeaderCart(summary));
  return `<header class="rp-site-header"><div class="rp-container rp-site-header__inner"><a class="rp-site-header__brand" href="#inicio" aria-label="R&P Doces, início">R&P Doces</a><div class="rp-site-header__actions"><button class="rp-site-header__cart" type="button" data-open-cart hidden aria-label="Abrir carrinho"><span class="rp-site-header__bag" aria-hidden="true"></span><span class="rp-site-header__badge">0</span></button><button class="rp-site-header__menu rp-site-header__menu--mobile" type="button" data-open-menu aria-label="Abrir menu"><span aria-hidden="true"></span></button><div class="rp-desktop-menu rp-desktop-menu--catalog"><button type="button" class="rp-desktop-menu__trigger" aria-label="Abrir menu" aria-haspopup="menu"><span>Menu</span><span class="rp-desktop-menu__trigger-chevron" aria-hidden="true"></span></button><div class="rp-desktop-menu__popover" role="menu" aria-label="Menu do cardápio"><button type="button" role="menuitem" data-home-section="topo"><strong>Início</strong><small>Voltar para a página inicial</small></button><button type="button" role="menuitem" data-open-party><strong>Pedidos para festa</strong><small>Encomendas especiais · 7 dias</small></button><button type="button" role="menuitem" data-home-section="sobre"><strong>Sobre nós</strong><small>Nossa história e nossos valores</small></button><button type="button" role="menuitem" data-home-section="onde-encontrar"><strong>Localização</strong><small>Veja onde estamos</small></button><button type="button" role="menuitem" data-home-section="contato"><strong>Contato</strong><small>Fale com a gente pelo WhatsApp</small></button></div></div></div></div></header>`;
}
