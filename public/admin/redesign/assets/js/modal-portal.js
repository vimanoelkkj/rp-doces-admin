const MODAL_SELECTOR = "[data-product-dialog], [data-orders-dialog]";

function portalModal(modal) {
  if (!(modal instanceof HTMLElement)) return;
  if (modal.parentElement === document.body) return;

  modal._rpModalHome = modal.parentElement;
  modal._rpModalNextSibling = modal.nextSibling;
  document.body.appendChild(modal);
}

function restoreModal(modal) {
  if (!(modal instanceof HTMLElement)) return;
  const home = modal._rpModalHome;
  if (!(home instanceof HTMLElement) || !home.isConnected) return;

  const next = modal._rpModalNextSibling;
  if (next && next.parentNode === home) home.insertBefore(modal, next);
  else home.appendChild(modal);

  delete modal._rpModalHome;
  delete modal._rpModalNextSibling;
}

// Captura antes dos handlers das telas. Assim, quando o botão abre o modal,
// ele já está fora de .admin-content e position: fixed usa a viewport do browser.
document.addEventListener(
  "click",
  event => {
    if (event.target.closest("[data-new-product]")) {
      const modal = document.querySelector("[data-product-dialog]");
      if (modal) portalModal(modal);
      return;
    }

    const close = event.target.closest("[data-product-dialog-close]");
    if (close) {
      const modal = close.closest("[data-product-dialog]");
      if (modal) requestAnimationFrame(() => restoreModal(modal));
    }
  },
  true
);

// Segurança: se uma troca de aba esconder/remover a tela enquanto um modal foi
// portalizado, não deixamos backdrop órfão preso no body.
const observer = new MutationObserver(() => {
  document.querySelectorAll(MODAL_SELECTOR).forEach(modal => {
    if (modal.parentElement !== document.body || !modal.hidden) return;
    restoreModal(modal);
  });
});

observer.observe(document.body, { childList: true, subtree: true });
