import { adminApi } from "./api.js";

const REFRESH_INTERVAL_MS = 30000;

function availableStock(product) {
  return Number(product?.estoque || 0) - Number(product?.estoque_reservado || 0);
}

function setBadge(element, count, title, tooltip) {
  if (!element) return;
  const value = Math.max(0, Number(count || 0));
  element.hidden = value === 0;
  element.textContent = value > 99 ? "99+" : String(value);
  element.title = value ? `${value} ${title}` : "";
  element.setAttribute("aria-label", value ? `${value} ${title}` : "Sem pendências");
  const item = element.closest(".admin-nav__item");
  if (!item) return;
  if (value) item.dataset.badgeTooltip = `${value} ${tooltip}`;
  else delete item.dataset.badgeTooltip;
}

export function setupSidebarBadges({ onUnauthorized } = {}) {
  const productsBadge = document.querySelector('[data-nav-badge="produtos"]');
  const ordersBadge = document.querySelector('[data-nav-badge="pedidos"]');
  if (!productsBadge && !ordersBadge) return null;

  let loading = false;
  let stopped = false;

  const refresh = async () => {
    if (loading || stopped || document.hidden) return;
    loading = true;
    try {
      const [ordersPayload, productsPayload] = await Promise.all([
        adminApi.orders(),
        adminApi.products()
      ]);
      const orders = Array.isArray(ordersPayload?.pedidos) ? ordersPayload.pedidos : [];
      const products = Array.isArray(productsPayload?.produtos) ? productsPayload.produtos : [];

      const productAttention = products.filter(product => {
        if (Number(product.ativo) === 0) return false;
        return availableStock(product) <= 2;
      }).length;

      const orderAttention = orders.filter(order => {
        const payment = String(order.status_pagamento || "").toUpperCase();
        const status = String(order.status_pedido || "NOVO").toUpperCase();
        return payment === "PENDENTE" || (payment === "PAGO" && status === "NOVO");
      }).length;

      setBadge(productsBadge, productAttention, "produtos precisam de atenção", "produto(s) com estoque disponível de 2 ou menos");
      setBadge(ordersBadge, orderAttention, "pedidos precisam de atenção", "pedido(s) aguardando pagamento ou início do atendimento");
    } catch (error) {
      if (error?.status === 401) onUnauthorized?.();
      else console.warn("R&P Admin: não foi possível atualizar os contadores.", error);
    } finally {
      loading = false;
    }
  };

  const onVisibility = () => {
    if (!document.hidden) refresh();
  };
  const onDataChanged = () => refresh();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("rp-admin-data-changed", onDataChanged);
  const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
  refresh();

  return {
    refresh,
    destroy() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("rp-admin-data-changed", onDataChanged);
    }
  };
}
