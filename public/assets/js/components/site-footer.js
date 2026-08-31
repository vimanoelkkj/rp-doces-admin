export function renderSiteFooter() {
  const year = new Date().getFullYear();
  return `<footer class="rp-site-footer"><div class="rp-container rp-site-footer__inner"><div class="rp-site-footer__brand"><strong>R&P Doces</strong><p>Bolo no pote e mini pudim, feitos à mão.</p><span>Dentro da Temponi Concept</span></div><div class="rp-site-footer__links"><a class="rp-site-footer__top" href="/admin/">Painel Admin <span aria-hidden="true">↗</span></a><a class="rp-site-footer__top" href="#inicio">Voltar ao topo <span aria-hidden="true">↑</span></a></div><small>© ${year} R&P Doces</small></div></footer>`;
}
