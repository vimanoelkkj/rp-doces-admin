import { adminApi } from "./api.js";
import { getCachedPage, setCachedPage, invalidatePageCache } from "./page-cache.js";

const DASHBOARD_CACHE_KEY = "dashboard";
const DASHBOARD_TTL = 15_000;
const DASHBOARD_REFRESH_MS = 15_000;
let refreshTimer = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDay(date, reference = new Date()) {
  return Boolean(
    date &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function money(cents = 0) {
  return (Number(cents) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function time(value) {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function paymentTone(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAGO") return "success";
  if (["PENDENTE", "PARCIAL"].includes(normalized)) return "warning";
  if (["CANCELADO", "FALHA", "REEMBOLSADO"].includes(normalized)) return "danger";
  return "neutral";
}

function orderTone(status) {
  const normalized = String(status || "").toUpperCase();
  if (["PRONTO", "CONCLUIDO", "CONCLUÍDO"].includes(normalized)) return "success";
  if (normalized === "NOVO") return "brand";
  if (["EM_PREPARO", "EM PREPARO", "PREPARANDO"].includes(normalized)) return "warning";
  return "neutral";
}

function humanOrderStatus(status) {
  const normalized = String(status || "NOVO").toUpperCase();
  const labels = { NOVO: "Novo", EM_PREPARO: "Em preparo", "EM PREPARO": "Em preparo", PREPARANDO: "Em preparo", PRONTO: "Pronto", ENTREGUE: "Entregue", CONCLUIDO: "Concluído", CONCLUÍDO: "Concluído", CANCELADO: "Cancelado", ARQUIVADO: "Arquivado" };
  return labels[normalized] || status || "Novo";
}

function humanPaymentStatus(status) {
  const normalized = String(status || "PENDENTE").toUpperCase();
  const labels = { PAGO: "Pago", PARCIAL: "Pagamento parcial", PENDENTE: "Aguardando pagamento", CANCELADO: "Cancelado", FALHA: "Falha", REEMBOLSADO: "Reembolsado" };
  return labels[normalized] || status || "Pendente";
}

function metric(label, value, detail, tone = "default", featured = false) {
  return `<article class="dashboard-metric${featured ? " dashboard-metric--featured" : ""}" data-tone="${tone}"><span class="dashboard-metric__label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function orderItemsCount(order) {
  if (Array.isArray(order.itens) && order.itens.length) return order.itens.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  return Number(order.quantidade || 0);
}

function itemStateIcon(status) {
  if (status === "PAGO") return "✓";
  if (status === "PARCIAL") return "◐";
  return "○";
}

function itemPaymentCopy(item) {
  const paid = Number(item.valor_pago_centavos || 0);
  const remaining = Number(item.saldo_centavos || 0);
  if (item.status_financeiro === "PAGO") return `${money(paid)} pagos`;
  if (item.status_financeiro === "PARCIAL") return `${money(paid)} pagos · ${money(remaining)} pendentes`;
  return `${money(remaining)} pendentes`;
}

function receivablesMarkup(orders) {
  const pending = orders.filter(order => Number(order.saldo_centavos || 0) > 0 && String(order.status_pedido || "").toUpperCase() !== "CANCELADO");
  const total = pending.reduce((sum, order) => sum + Number(order.saldo_centavos || 0), 0);

  const body = pending.length
    ? `<div class="dashboard-financial">${pending.map(order => {
        const items = Array.isArray(order.itens) ? order.itens : [];
        const itemCount = orderItemsCount(order);
        return `<article class="dashboard-financial__row" data-financial-row>
          <button class="dashboard-financial__trigger" type="button" aria-expanded="false" data-financial-toggle>
            <span class="dashboard-financial__customer"><strong>${escapeHtml(order.cliente_nome || "Cliente não informado")}</strong><small>Pedido #${order.id} · ${itemCount} ${itemCount === 1 ? "item" : "itens"}</small></span>
            <strong class="dashboard-financial__balance">${money(order.saldo_centavos)} pendentes</strong>
            <span class="dashboard-financial__chevron" aria-hidden="true">⌄</span>
          </button>
          <div class="dashboard-financial__details" data-financial-details hidden>
            <div class="dashboard-financial__items">
              ${items.map(item => `<div class="dashboard-financial__item" data-state="${escapeHtml(item.status_financeiro || "PENDENTE")}">
                <span class="dashboard-financial__item-state" aria-hidden="true">${itemStateIcon(item.status_financeiro)}</span>
                <span class="dashboard-financial__item-copy"><strong>${Number(item.quantidade || 0)}× ${escapeHtml(item.produto_nome || "Produto")}</strong><small>${escapeHtml(itemPaymentCopy(item))} · ${escapeHtml(humanPaymentStatus(item.status_financeiro))}</small></span>
                <strong>${money(item.valor_total_centavos)}</strong>
              </div>`).join("")}
            </div>
            <div class="dashboard-financial__summary">
              <div><span>Total</span><strong>${money(order.valor_total_centavos)}</strong></div>
              <div><span>Pago</span><strong>${money(order.valor_pago_centavos)}</strong></div>
              <div class="dashboard-financial__remaining"><span>Restante</span><strong>${money(order.saldo_centavos)}</strong></div>
            </div>
            <div class="dashboard-financial__actions"><button type="button" class="dashboard-financial__open" data-open-command>Ver comanda</button></div>
          </div>
        </article>`;
      }).join("")}</div>`
    : `<div class="dashboard-financial-empty"><strong>Nenhum saldo pendente.</strong><span>Os pagamentos em aberto aparecerão aqui.</span></div>`;

  return `<section class="admin-panel dashboard-section dashboard-section--financial"><header class="dashboard-section__head"><div><strong>Pagamentos pendentes</strong><span>${pending.length} cliente${pending.length === 1 ? "" : "s"} · ${money(total)} a receber</span></div><button type="button" class="dashboard-link" data-go-page="pedidos">Ver pedidos</button></header>${body}</section>`;
}

function recentOrdersMarkup(orders) {
  if (!orders.length) return `<div class="dashboard-empty"><strong>Nenhum pedido por aqui ainda.</strong><span>Os pedidos mais recentes aparecerão nesta área.</span></div>`;
  return `<div class="dashboard-orders"><div class="dashboard-orders__head" aria-hidden="true"><span>Pedido</span><span>Cliente</span><span>Itens</span><span>Pagamento</span><span>Andamento</span><span>Total</span></div>${orders.map(order => {
    const reference = `RP-${order.id}`;
    const itemCount = orderItemsCount(order);
    return `<article class="dashboard-order"><div class="dashboard-order__id" data-label="Pedido"><strong>${reference}</strong><span>${time(order.criado_em)}</span></div><div class="dashboard-order__customer" data-label="Cliente"><span class="dashboard-customer-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.1"></circle><path d="M6.2 18.6c.9-2.9 3-4.5 5.8-4.5s4.9 1.6 5.8 4.5"></path></svg></span><span><strong>${escapeHtml(order.cliente_nome || "Cliente")}</strong><small>${escapeHtml(order.cliente_whatsapp || order.cliente_email || "")}</small></span></div><div data-label="Itens">${itemCount} ${itemCount === 1 ? "item" : "itens"}</div><div data-label="Pagamento"><span class="status-pill" data-tone="${paymentTone(order.status_financeiro)}">${escapeHtml(humanPaymentStatus(order.status_financeiro))}</span></div><div data-label="Andamento"><span class="status-pill" data-tone="${orderTone(order.status_pedido)}">${escapeHtml(humanOrderStatus(order.status_pedido))}</span></div><div class="dashboard-order__total" data-label="Total">${money(order.valor_total_centavos)}</div></article>`;
  }).join("")}</div>`;
}

function dashboardMarkup({ orders, products }) {
  const now = new Date();
  const paymentsPaidToday = orders.flatMap(order => (order.pagamentos || []).filter(payment => payment.status === "PAGO" && sameLocalDay(parseDate(payment.pago_em || payment.atualizado_em), now)));
  const receivables = orders.filter(order => Number(order.saldo_centavos || 0) > 0 && String(order.status_pedido || "").toUpperCase() !== "CANCELADO");
  const openCommands = orders.filter(order => !["ENTREGUE", "CANCELADO"].includes(String(order.status_pedido || "").toUpperCase()));
  const waitingPreparation = orders.filter(order => String(order.status_pedido || "NOVO").toUpperCase() === "NOVO" && order.status_financeiro === "PAGO");
  const soldOut = products.filter(product => Number(product.estoque || 0) - Number(product.estoque_reservado || 0) <= 0);
  const lowStock = products.filter(product => { const available = Number(product.estoque || 0) - Number(product.estoque_reservado || 0); return available > 0 && available <= 2 && Number(product.ativo) !== 0; });
  const receivedToday = paymentsPaidToday.reduce((sum, payment) => sum + Number(payment.valor_centavos || 0), 0);
  const receivableTotal = receivables.reduce((sum, order) => sum + Number(order.saldo_centavos || 0), 0);
  const recent = orders.slice(0, 6);
  const attention = [];
  if (receivables.length) attention.push(`${receivables.length} cliente${receivables.length === 1 ? "" : "s"} com saldo pendente`);
  if (waitingPreparation.length) attention.push(`${waitingPreparation.length} pedido${waitingPreparation.length === 1 ? "" : "s"} aguardando preparação`);
  if (soldOut.length) attention.push(`${soldOut.length} produto${soldOut.length === 1 ? "" : "s"} sem estoque disponível`);
  if (lowStock.length) attention.push(`${lowStock.length} produto${lowStock.length === 1 ? "" : "s"} com estoque baixo`);

  return `<section class="dashboard" aria-label="Resumo da operação">
    <div class="dashboard-metrics">
      ${metric("Recebido hoje", money(receivedToday), `${paymentsPaidToday.length} pagamento${paymentsPaidToday.length === 1 ? " confirmado" : "s confirmados"}`, "brand", true)}
      ${metric("A receber", money(receivableTotal), `${receivables.length} cliente${receivables.length === 1 ? "" : "s"} com saldo pendente`, receivables.length ? "warning" : "success")}
      ${metric("Comandas abertas", String(openCommands.length), "Clientes ainda em atendimento", "default")}
      ${metric("Aguardando preparo", String(waitingPreparation.length), "Pedidos pagos que ainda estão novos", waitingPreparation.length ? "warning" : "success")}
      ${metric("Catálogo", String(products.length), `${soldOut.length} esgotado${soldOut.length === 1 ? "" : "s"} · ${lowStock.length} estoque baixo`, soldOut.length || lowStock.length ? "warning" : "success")}
    </div>
    ${receivablesMarkup(orders)}
    <div class="dashboard-grid">
      <section class="admin-panel dashboard-section dashboard-section--orders"><header class="dashboard-section__head"><div><strong>Pedidos recentes</strong><span>Últimas movimentações da loja</span></div><button type="button" class="dashboard-link" data-go-page="pedidos">Ver pedidos</button></header>${recentOrdersMarkup(recent)}</section>
      <aside class="admin-panel dashboard-section dashboard-attention"><header class="dashboard-section__head"><div><strong>Precisa de atenção</strong><span>Pontos que podem exigir uma ação</span></div></header>${attention.length ? `<ul>${attention.map(item => `<li><span class="dashboard-attention__dot"></span>${escapeHtml(item)}</li>`).join("")}</ul>` : `<div class="dashboard-attention__ok"><span>✓</span><div><strong>Tudo tranquilo por aqui</strong><small>Nenhuma pendência operacional detectada.</small></div></div>`}</aside>
    </div>
  </section>`;
}

function loadingMarkup() {
  return `<section class="dashboard dashboard-loading" aria-label="Carregando dashboard"><div class="dashboard-metrics">${Array.from({ length: 5 }, () => '<span class="dashboard-skeleton"></span>').join("")}</div><div class="admin-panel dashboard-skeleton dashboard-skeleton--large"></div></section>`;
}

function errorMarkup(message) {
  return `<section class="admin-panel dashboard-error"><strong>Não conseguimos carregar o dashboard.</strong><span>${escapeHtml(message || "Tente novamente em instantes.")}</span><button type="button" class="dashboard-retry" data-dashboard-retry>Tentar novamente</button></section>`;
}

function bindDashboard(container, onNavigate) {
  container.querySelectorAll('[data-go-page="pedidos"], [data-open-command]').forEach(button => {
    button.addEventListener("click", () => onNavigate?.("pedidos"));
  });

  container.querySelectorAll("[data-financial-toggle]").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const row = toggle.closest("[data-financial-row]");
      const details = row?.querySelector("[data-financial-details]");
      if (!row || !details) return;
      const opening = toggle.getAttribute("aria-expanded") !== "true";

      container.querySelectorAll("[data-financial-toggle][aria-expanded='true']").forEach(openToggle => {
        if (openToggle === toggle) return;
        openToggle.setAttribute("aria-expanded", "false");
        const openRow = openToggle.closest("[data-financial-row]");
        const openDetails = openRow?.querySelector("[data-financial-details]");
        if (openDetails) openDetails.hidden = true;
      });

      toggle.setAttribute("aria-expanded", String(opening));
      details.hidden = !opening;
    });
  });
}

function scheduleRefresh(container, options) {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (document.visibilityState === "visible" && options.isActive?.()) {
      invalidateDashboardCache();
      renderDashboard(container, { ...options, force: true });
      return;
    }
    scheduleRefresh(container, options);
  }, DASHBOARD_REFRESH_MS);
}

export function invalidateDashboardCache() {
  invalidatePageCache(DASHBOARD_CACHE_KEY);
}

export async function renderDashboard(container, { onUnauthorized, onNavigate, isActive = () => true, force = false } = {}) {
  if (!container) return;
  const options = { onUnauthorized, onNavigate, isActive };
  const cached = getCachedPage(DASHBOARD_CACHE_KEY);

  if (cached.hasData && !force) {
    container.innerHTML = dashboardMarkup(cached.data);
    bindDashboard(container, onNavigate);
    if (cached.fresh) {
      scheduleRefresh(container, options);
      return;
    }
  } else {
    container.innerHTML = loadingMarkup();
  }

  try {
    await adminApi.orders();
    const [financialPayload, productsPayload] = await Promise.all([adminApi.financialOrders(), adminApi.products()]);
    const data = { orders: financialPayload?.pedidos || [], products: productsPayload?.produtos || [] };
    setCachedPage(DASHBOARD_CACHE_KEY, data, DASHBOARD_TTL);
    if (!isActive()) return;
    container.innerHTML = dashboardMarkup(data);
    bindDashboard(container, onNavigate);
    scheduleRefresh(container, options);
  } catch (error) {
    if (error?.status === 401) { onUnauthorized?.(); return; }
    if (cached.hasData) {
      scheduleRefresh(container, options);
      return;
    }
    if (!isActive()) return;
    container.innerHTML = errorMarkup(error?.message);
    container.querySelector("[data-dashboard-retry]")?.addEventListener("click", () => {
      invalidateDashboardCache();
      renderDashboard(container, { onUnauthorized, onNavigate, isActive, force: true });
    });
  }
}
