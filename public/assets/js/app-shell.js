(() => {
  const root = document.documentElement;
  const body = document.body;
  if (!body) return;

  body.classList.add('rp-app-shell');

  const syncCartBar = () => {
    const cart = document.getElementById('rpMobileCart');
    const count = document.getElementById('rpMobileCartCount');
    const total = document.getElementById('rpMobileCartValue');
    if (!cart || !count) return;

    const qty = Number(String(count.textContent || '').replace(/\D/g, '')) || 0;
    body.classList.toggle('rp-has-cart', qty > 0);
    cart.setAttribute('aria-label', qty > 0 ? `Ver pedido, ${qty} item${qty === 1 ? '' : 's'}` : 'Carrinho vazio');

    const label = Array.from(cart.children).find(el => el.tagName === 'SPAN' && !el.classList.contains('rp-mobile-cart-badge'));
    if (label) label.textContent = qty > 0 ? 'Ver pedido →' : 'Carrinho';

    if (total && qty > 0) total.hidden = false;
  };

  const cartObserver = new MutationObserver(syncCartBar);
  const startCartObserver = () => {
    const count = document.getElementById('rpMobileCartCount');
    const total = document.getElementById('rpMobileCartValue');
    if (count) cartObserver.observe(count, { childList: true, characterData: true, subtree: true });
    if (total) cartObserver.observe(total, { childList: true, characterData: true, subtree: true, attributes: true });
    syncCartBar();
  };

  const syncModalState = () => {
    const overlay = document.getElementById('pedidoOverlay');
    if (!overlay) return;
    body.classList.toggle('rp-order-open', overlay.classList.contains('open'));
  };

  const startModalObserver = () => {
    const overlay = document.getElementById('pedidoOverlay');
    if (!overlay) return;
    new MutationObserver(syncModalState).observe(overlay, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    syncModalState();
  };

  const start = () => {
    startCartObserver();
    startModalObserver();
    addEventListener('rp-cart-updated', syncCartBar);
    addEventListener('rp-mobile-nav-refresh', syncCartBar);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
