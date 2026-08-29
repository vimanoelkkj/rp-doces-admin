export function renderSiteFooter() {
  const year = new Date().getFullYear();
  return `<footer class="rp-site-footer"><div class="rp-container rp-site-footer__inner"><div class="rp-site-footer__brand"><strong>R&P Doces</strong><p>Bolo no pote e mini pudim, feitos à mão.</p><span>Dentro da Temponi Concept</span></div><a class="rp-site-footer__top" href="#inicio">Voltar ao topo <span aria-hidden="true">↑</span></a><small>© ${year} R&P Doces</small></div></footer>`;
}
