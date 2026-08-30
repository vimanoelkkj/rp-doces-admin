import { adminApi } from "./api.js";

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
  return date
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

function paymentTone(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAGO") return "success";
  if (normalized === "PENDENTE") return "warning";
  if (["CANCELADO", "FALHA", "REEMBOLSADO"].includes(normalized)) return "danger";
  return "neutral";
}

function orderTone(status) {
  const normalized = String(status || "").toUpperCase();
  if (["PRONTO", "CONCLUIDO", "CONCLUÍDO"].includes(normalized)) return "success";
  if (["NOVO"].includes(normalized)) return "brand";
  if (["EM_PREPARO", "EM PREPARO", "PREPARANDO"].includes(normalized)) return "warning";
  if (["CANCELADO", "ARQUIVADO"].includes(normalized)) return "neutral";
  return "neutral";
}

function humanOrderStatus(status) {
  const normalized = String(status || "NOVO").toUpperCase();
  const labels = {
    NOVO: "Novo",
    EM_PREPARO: "Em preparo",
    "EM PREPARO": "Em preparo",
    PREPARANDO: "Em preparo",
    PRONTO: "Pronto",
    CONCLUIDO: "Concluído",
    "CONCLUÍDO": "Concluído",
    CANCELADO: "Cancelado",
    ARQUIVADO: "Arquivado"
  };
  return labels[normalized] || status || "Novo";
}

function humanPaymentStatus(status) {
  const normalized = String(status || "PENDENTE").toUpperCase();
  const labels = {
    PAGO: "Pago",
    PENDENTE: "Aguardando pagamento",
    CANCELADO: "Cancelado",
    FALHA: "Falha",
    REEMBOLSADO: "Reembolsado"
  };
  return labels[normalized] || status || "Pendente";
}

function metric(label, value, detail, tone = "default", featured = false) {
  return `
    <article class="dashboard-metric${featured ? " dashboard-metric--featured" : ""}" data-tone="${tone}">
      <span class="dashboard-metric__label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>`;
}

function orderItemsCount(order) {
  if (Array.isArray(order.itens) && order.itens.length) {
    return order.itens.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  }
  return Number(order.quantidade || 0);
}

function recentOrdersMarkup(orders) {
  if (!orders.length) {
    return `<div class="dashboard-empty"><strong>Nenhum pedido por aqui ainda.</strong><span>Os pedidos mais recentes aparecerão nesta área.</span></div>`;
  }

  return `
    <div class="dashboard-orders">
      <div class="dashboard-orders__head" aria-hidden="true">
        <span>Pedido</span><span>Cliente</span><span>Itens</span><span>Pagamento</span><span>Andamento</span><span>Total</span>
      </div>
      ${orders
        .map(order => {
          const reference = `RP-${order.id}`;
          const itemCount = orderItemsCount(order);
          return `
            <article class="dashboard-order">
              <div class="dashboard-order__id" data-label="Pedido"><strong>${reference}</strong><span>${time(order.criado_em)}</span></div>
              <div class="dashboard-order__customer" data-label="Cliente">
                <span class="dashboard-customer-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.1"></circle><path d="M6.2 18.6c.9-2.9 3-4.5 5.8-4.5s4.9 1.6 5.8 4.5"></path></svg>
                </span>
                <span><strong>${escapeHtml(order.cliente_nome || "Cliente")}</strong><small>${escapeHtml(order.cliente_whatsapp || order.cliente_email || "")}</small></span>
              </div>
              <div data-label="Itens">${itemCount} ${itemCount === 1 ? "item" : "itens"}</div>
              <div data-label="Pagamento"><span class="status-pill" data-tone="${paymentTone(order.status_pagamento)}">${escapeHtml(humanPaymentStatus(order.status_pagamento))}</span></div>
              <div data-label="Andamento"><span class="status-pill" data-tone="${orderTone(order.status_pedido)}">${escapeHtml(humanOrderStatus(order.status_pedido))}</span></div>
              <div class="dashboard-order__total" data-label="Total">${money(order.valor_total_centavos)}</div>
            </article>`;
        })
        .join("")}
    </div>`;
}

function dashboardMarkup({ orders, products }) {
  const now = new Date();
  const today = orders.filter(order => sameLocalDay(parseDate(order.criado_em), now));
  const paidToday = orders.filter(
    order => String(order.status_pagamento).toUpperCase() === "PAGO" && sameLocalDay(parseDate(order.pago_em || order.atualizado_em), now)
  );
  const pendingPayment = orders.filter(order => String(order.status_pagamento).toUpperCase() === "PENDENTE");
  const waitingPreparation = orders.filter(order => {
    const operational = String(order.status_pedido || "NOVO").toUpperCase();
    const payment = String(order.status_pagamento || "").toUpperCase();
    return operational === "NOVO" && payment === "PAGO";
  });
  const soldOut = products.filter(product => Number(product.estoque || 0) - Number(product.estoque_reservado || 0) <= 0);
  const lowStock = products.filter(product => {
    const available = Number(product.estoque || 0) - Number(product.estoque_reservado || 0);
    return available > 0 && available <= 2 && Number(product.ativo) !== 0;
  });
  const paidRevenue = paidToday.reduce((total, order) => total + Number(order.valor_total_centavos || 0), 0);
  const recent = orders.slice(0, 6);

  const attention = [];
  if (pendingPayment.length) attention.push(`${pendingPayment.length} pedido${pendingPayment.length === 1 ? "" : "s"} aguardando pagamento`);
  if (waitingPreparation.length) attention.push(`${waitingPreparation.length} pedido${waitingPreparation.length === 1 ? "" : "s"} aguardando preparação`);
  if (soldOut.length) attention.push(`${soldOut.length} produto${soldOut.length === 1 ? "" : "s"} sem estoque disponível`);
  if (lowStock.length) attention.push(`${lowStock.length} produto${lowStock.length === 1 ? "" : "s"} com estoque baixo`);

  return `
    <section class="dashboard" aria-label="Resumo da operação">
      <div class="dashboard-metrics">
        ${metric("Faturamento pago hoje", money(paidRevenue), `${paidToday.length} pedido${paidToday.length === 1 ? " pago" : "s pagos"}`, "brand", true)}
        ${metric("Aguardando preparação", String(waitingPreparation.length), "Pedidos pagos que ainda estão novos", "warning")}
        ${metric("Aguardando pagamento", String(pendingPayment.length), "Pix ainda não confirmado", "warning")}
        ${metric("Catálogo", String(products.length), `${soldOut.length} esgotado${soldOut.length === 1 ? "" : "s"} · ${lowStock.length} estoque baixo`, soldOut.length || lowStock.length ? "warning" : "success")}
        ${metric("Pedidos hoje", String(today.length), "Criados desde 00:00", "default")}
      </div>

      <div class="dashboard-grid">
        <section class="admin-panel dashboard-section dashboard-section--orders">
          <header class="dashboard-section__head"><div><strong>Pedidos recentes</strong><span>Últimas movimentações da loja</span></div><button type="button" class="dashboard-link" data-go-page="pedidos">Ver pedidos</button></header>
          ${recentOrdersMarkup(recent)}
        </section>

        <aside class="admin-panel dashboard-section dashboard-attention">
          <header class="dashboard-section__head"><div><strong>Precisa de atenção</strong><span>Pontos que podem exigir uma ação</span></div></header>
          ${attention.length
            ? `<ul>${attention.map(item => `<li><span class="dashboard-attention__dot"></span>${escapeHtml(item)}</li>`).join("")}</ul>`
            : `<div class="dashboard-attention__ok"><span>✓</span><div><strong>Tudo tranquilo por aqui</strong><small>Nenhuma pendência operacional detectada.</small></div></div>`}
        </aside>
      </div>
    </section>`;
}

function loadingMarkup() {
  return `
    <section class="dashboard dashboard-loading" aria-label="Carregando dashboard">
      <div class="dashboard-metrics">${Array.from({ length: 5 }, () => '<span class="dashboard-skeleton"></span>').join("")}</div>
      <div class="admin-panel dashboard-skeleton dashboard-skeleton--large"></div>
    </section>`;
}

function errorMarkup(message) {
  return `
    <section class="admin-panel dashboard-error">
      <strong>Não conseguimos carregar o dashboard.</strong>
      <span>${escapeHtml(message || "Tente novamente em instantes.")}</span>
      <button type="button" class="dashboard-retry" data-dashboard-retry>Tentar novamente</button>
    </section>`;
}

export async function renderDashboard(container, { onUnauthorized, onNavigate } = {}) {
  if (!container) return;
  container.innerHTML = loadingMarkup();

  try {
    const [ordersPayload, productsPayload] = await Promise.all([adminApi.orders(), adminApi.products()]);
    container.innerHTML = dashboardMarkup({
      orders: ordersPayload?.pedidos || [],
      products: productsPayload?.produtos || []
    });

    container.querySelector('[data-go-page="pedidos"]')?.addEventListener("click", () => onNavigate?.("pedidos"));
  } catch (error) {
    if (error?.status === 401) {
      onUnauthorized?.();
      return;
    }
    container.innerHTML = errorMarkup(error?.message);
    container.querySelector("[data-dashboard-retry]")?.addEventListener("click", () => {
      renderDashboard(container, { onUnauthorized, onNavigate });
    });
  }
}
