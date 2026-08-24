(function () {
  let ultimoSyncAdmin = 0;
  async function sincronizarAdmin() {
    if (document.hidden || typeof me === "undefined" || !me) return;
    const agora = Date.now();
    if (agora - ultimoSyncAdmin < 700) return;
    ultimoSyncAdmin = agora;
    try {
      if (typeof loadProducts === "function") await loadProducts();
      // Pedidos ficam sincronizados mesmo quando outra aba do admin está aberta.
      // Assim o badge de novos pedidos muda sozinho sem depender do botão Atualizar.
      if (typeof loadOrders === "function" && !document.querySelector(".order-status-select.open"))
        await loadOrders();
      const tabUsuarios = document.querySelector('[data-tab="usuarios"]');
      if (
        tabUsuarios &&
        tabUsuarios.classList.contains("active") &&
        typeof loadUsers === "function"
      ) {
        await loadUsers();
      }
    } catch (_) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sincronizarAdmin();
  });
  window.addEventListener("focus", sincronizarAdmin);
  setInterval(() => {
    if (!document.hidden) sincronizarAdmin();
  }, 3000);
})();
