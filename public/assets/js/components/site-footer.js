export function renderSiteFooter() {
  const year = new Date().getFullYear();
  return `
    <footer class="rp-site-footer">
      <div class="rp-container rp-site-footer__inner">
        <div>
          <strong>R&P Doces</strong>
          <p>Bolo no pote e mini pudim, feitos à mão.</p>
        </div>
        <a href="#inicio">Voltar ao topo ↑</a>
        <small>© ${year} R&P Doces</small>
      </div>
    </footer>
  `;
}
