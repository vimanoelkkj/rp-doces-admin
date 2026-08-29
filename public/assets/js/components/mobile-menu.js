const icon = path =>
  `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${path}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const homeIcon = icon("M3.5 10.5 12 3.5l8.5 7v9a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-9Z");
const partyIcon = icon(
  "M5 10h14v8.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V10Zm-1 0h16M8 10V7.5M12 10V6M16 10V7.5M7.3 5.3c.8-.8 1.8-.7 2.5 0 .6.7.6 1.7 0 2.3M11 3.8c.7-.7 1.7-.7 2.4 0 .7.7.7 1.7 0 2.4M15 5.3c.7-.7 1.7-.8 2.5 0 .6.6.6 1.6 0 2.3"
);
const aboutIcon = icon(
  "M12 20.3s-7-4.4-7-10.2A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7 2.9c0 5.8-7 10.2-7 10.2Z"
);
const locationIcon = icon(
  "M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
);
const whatsappIcon = icon(
  "M20 11.5a8 8 0 0 1-11.8 7l-4.2 1 1.1-4.1A8 8 0 1 1 20 11.5Zm-10.7-4c.2-.4.4-.4.7-.4h.4c.2 0 .4.1.5.4l.8 1.8c.1.3 0 .5-.1.7l-.7.9c-.2.2-.2.4-.1.6.4.8 1 1.6 1.7 2.1.8.6 1.5.9 2.2 1.1.3.1.5 0 .7-.2l.9-1c.2-.2.4-.3.7-.2l1.7.8c.3.1.5.3.5.5 0 .5-.2 1.4-.8 2-.6.7-1.6 1-2.7 1-1.6 0-3.5-.8-5.3-2.3-2-1.7-3.4-3.8-3.6-5.6-.1-1 .2-1.7.6-2.2Z"
);
const shieldIcon = icon("M12 3 5.5 5.4v5.2c0 4.3 2.7 7.9 6.5 9.4 3.8-1.5 6.5-5.1 6.5-9.4V5.4L12 3Zm-3 8 2 2 4-4");

export function renderMobileMenu(open = false) {
  if (!open) return "";
  return `<div class="rp-mobile-menu" data-menu-root><button class="rp-mobile-menu__backdrop" type="button" data-close-menu aria-label="Fechar menu"></button><section class="rp-mobile-menu__sheet" role="dialog" aria-modal="true" aria-labelledby="rp-mobile-menu-title"><div class="rp-sheet-handle rp-mobile-menu__handle" aria-hidden="true"></div><header class="rp-mobile-menu__head"><div><h2 id="rp-mobile-menu-title">Menu</h2><p>Tudo da R&P em um só lugar.</p></div><button class="rp-icon-button rp-mobile-menu__close" type="button" data-close-menu aria-label="Fechar menu">×</button></header><div class="rp-mobile-menu__group"><p class="rp-mobile-menu__label">Início</p><nav class="rp-mobile-menu__links" aria-label="Início"><button type="button" data-home-section="topo"><span class="rp-mobile-menu__icon" aria-hidden="true">${homeIcon}</span><span class="rp-mobile-menu__copy"><strong>Início</strong><small>Voltar para a página inicial</small></span><span class="rp-mobile-menu__chevron" aria-hidden="true">›</span></button></nav></div><div class="rp-mobile-menu__group"><p class="rp-mobile-menu__label">Pedidos</p><nav class="rp-mobile-menu__links" aria-label="Pedidos"><button type="button" data-open-party><span class="rp-mobile-menu__icon" aria-hidden="true">${partyIcon}</span><span class="rp-mobile-menu__copy"><span class="rp-mobile-menu__title-row"><strong>Pedidos para festa</strong><span class="rp-mobile-menu__badge">7 dias</span></span><small>Encomendas especiais para comemorações</small></span><span class="rp-mobile-menu__chevron" aria-hidden="true">›</span></button></nav></div><div class="rp-mobile-menu__group"><p class="rp-mobile-menu__label">R&P Doces</p><div class="rp-mobile-menu__links"><button type="button" data-home-section="sobre"><span class="rp-mobile-menu__icon" aria-hidden="true">${aboutIcon}</span><span class="rp-mobile-menu__copy"><strong>Sobre nós</strong><small>Nossa história e nossos valores</small></span><span class="rp-mobile-menu__chevron" aria-hidden="true">›</span></button><button type="button" data-home-section="onde-encontrar"><span class="rp-mobile-menu__icon" aria-hidden="true">${locationIcon}</span><span class="rp-mobile-menu__copy"><strong>Localização</strong><small>Veja onde estamos</small></span><span class="rp-mobile-menu__chevron" aria-hidden="true">›</span></button><button type="button" data-home-section="contato"><span class="rp-mobile-menu__icon" aria-hidden="true">${whatsappIcon}</span><span class="rp-mobile-menu__copy"><strong>Contato</strong><small>Fale com a gente pelo WhatsApp</small></span><span class="rp-mobile-menu__chevron" aria-hidden="true">›</span></button></div></div><div class="rp-mobile-menu__trust"><span aria-hidden="true">${shieldIcon}</span><p>Seus dados estão protegidos e seguros.</p></div></section></div>`;
}
