import { adminApi } from "./api.js";

const FINANCEIRO = Object.freeze({
  PENDENTE: { label: "Pendente", className: "is-fin-pending" },
  PARCIAL: { label: "Parcial", className: "is-fin-partial" },
  PAGO: { label: "Pago", className: "is-fin-paid" }
});

const ENTREGA = Object.freeze({
  NOVO: { label: "A preparar", className: "is-delivery-neutral" },
  PREPARANDO: { label: "Em preparo", className: "is-delivery-neutral" },
  PRONTO: { label: "Pronto", className: "is-delivery-neutral" },
  ENTREGUE: { label: "Entregue", className: "is-delivery-neutral" },
  CANCELADO: { label: "Cancelado", className: "is-delivery-cancelled" }
});

const FILTERS = Object.freeze({
  todos: "Tudo",
  receber: "A receber",
  entregar: "A entregar",
  concluidos: "Concluídos",
  cancelados: "Cancelados"
});

let latestOrders = [];
let activeFilter = "todos";
let scheduled = false;

function upper(value, fallback = "") {
  return String(value || fallback).toUpperCase();
}

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

function orderFinancialState(order) {
  const explicit = upper(order.status_financeiro);
  if (FINANCEIRO[explicit]) return explicit;

  const payment = upper(order.status_pagamento, "PENDENTE");
  if (payment === "PAGO") return "PAGO";

  const paid = Number(order.valor_pago_centavos);
  const total = Number(order.valor_total_centavos || 0);
  if (Number.isFinite(paid) && paid > 0 && paid < total) return "PARCIAL";
  return "PENDENTE";
}

function orderPaidCents(order) {
  const explicit = Number(order.valor_pago_centavos);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return orderFinancialState(order) === "PAGO" ? Number(order.valor_total_centavos || 0) : 0;
}

function orderBalanceCents(order) {
  const explicit = Number(order.saldo_centavos);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, Number(order.valor_total_centavos || 0) - orderPaidCents(order));
}

function rowState(order) {
  const delivery = upper(order.status_pedido, "NOVO");
  if (delivery === "CANCELADO") return "is-row-cancelled";
  if (orderFinancialState(order) !== "PAGO") return "is-row-due";
  if (delivery === "ENTREGUE") return "is-row-done";
  return "is-row-progress";
}

function orderMatchesFilter(order, filter) {
  const delivery = upper(order.status_pedido, "NOVO");
  if (filter === "receber") return delivery !== "CANCELADO" && orderFinancialState(order) !== "PAGO";
  if (filter === "entregar") return ["NOVO", "PREPARANDO", "PRONTO"].includes(delivery);
  if (filter === "concluidos") return delivery === "ENTREGUE";
  if (filter === "cancelados") return delivery === "CANCELADO";
  return delivery !== "CANCELADO";
}

function installOrdersCapture() {
  if (adminApi.orders?.__rpQueueWrapped) return;
  const original = adminApi.orders.bind(adminApi);

  const wrapped = async (...args) => {
    const payload = await original(...args);
    latestOrders = Array.isArray(payload?.pedidos) ? payload.pedidos : [];
    scheduleEnhance();
    return payload;
  };
  wrapped.__rpQueueWrapped = true;
  adminApi.orders = wrapped;
}

function ensureHeader(view) {
  const list = view.querySelector("[data-orders-list]");
  if (!list || view.querySelector("[data-orders-queue-head]")) return;

  const head = document.createElement("div");
  head.className = "orders-queue-head";
  head.dataset.ordersQueueHead = "";
  head.setAttribute("aria-hidden", "true");
  head.innerHTML = `
    <span>Pedido / cliente</span>
    <span>Financeiro</span>
    <span>Entrega</span>
    <span class="is-right">Valor</span>
    <span class="is-right">Criado</span>
    <span></span>`;
  list.before(head);
}

function renderSummary(view) {
  const summary = view.querySelector("[data-orders-summary]");
  if (!summary) return;

  let entered = 0;
  let due = 0;
  let toDeliver = 0;

  for (const order of latestOrders) {
    const delivery = upper(order.status_pedido, "NOVO");
    if (delivery === "CANCELADO") continue;
    entered += orderPaidCents(order);
    due += orderBalanceCents(order);
    if (["NOVO", "PREPARANDO", "PRONTO"].includes(delivery)) toDeliver += 1;
  }

  summary.classList.add("orders-queue-summary");
  summary.innerHTML = `
    <article class="orders-queue-kpi is-entered">
      <strong>${money(entered)}</strong><span>entraram</span>
    </article>
    <button type="button" class="orders-queue-kpi is-due" data-queue-summary-filter="receber">
      <strong>${money(due)}</strong><span>a receber</span>
    </button>
    <button type="button" class="orders-queue-kpi is-deliver" data-queue-summary-filter="entregar">
      <strong>${toDeliver}</strong><span>a entregar</span>
    </button>`;

  summary.querySelectorAll("[data-queue-summary-filter]").forEach(button => {
    button.addEventListener("click", () => setFilter(view, button.dataset.queueSummaryFilter || "todos"));
  });
}

function renderFilters(view) {
  const filters = view.querySelector(".orders-filters");
  if (!filters) return;
  filters.classList.add("orders-queue-filters");

  filters.innerHTML = Object.entries(FILTERS)
    .map(([value, label]) => {
      const count = latestOrders.filter(order => orderMatchesFilter(order, value)).length;
      return `<button type="button" data-queue-filter="${value}" class="${activeFilter === value ? "is-active" : ""}">${label}<span>${count}</span></button>`;
    })
    .join("");

  filters.querySelectorAll("[data-queue-filter]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      setFilter(view, button.dataset.queueFilter || "todos");
    }, true);
  });
}

function setFilter(view, next) {
  activeFilter = FILTERS[next] ? next : "todos";
  renderFilters(view);
  applyRowVisibility(view);
}

function findOrder(id) {
  return latestOrders.find(order => Number(order.id) === Number(id)) || null;
}

function enhanceStatusMenu(card, order) {
  const menu = card.querySelector("[data-order-status-menu]");
  const trigger = menu?.querySelector("[data-order-status-trigger]");
  if (!(trigger instanceof HTMLButtonElement)) return;

  trigger.classList.add("orders-queue-more");
  trigger.innerHTML = '<span aria-hidden="true">···</span>';
  trigger.setAttribute("aria-label", `Ações do pedido ${Number(order.id)}`);
  trigger.setAttribute("title", "Alterar entrega");

  menu.querySelectorAll("[data-order-status-value]").forEach(option => {
    const status = upper(option.dataset.orderStatusValue);
    const label = ENTREGA[status]?.label || status;
    const text = option.querySelector("span");
    if (text) text.textContent = label;
  });
}

function enhanceCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const id = Number(card.dataset.orderId || 0);
  const order = findOrder(id);
  if (!order) return;

  card.classList.add("orders-queue-row");
  card.classList.remove("is-payment-pending");
  card.classList.remove("is-row-done", "is-row-due", "is-row-cancelled", "is-row-progress");
  card.classList.add(rowState(order));
  card.dataset.queueFinancial = orderFinancialState(order);
  card.dataset.queueDelivery = upper(order.status_pedido, "NOVO");

  const number = card.querySelector(".orders-card__number");
  if (number) number.textContent = `#${id}${order.origem_pedido === "MANUAL" ? " · manual" : ""}`;

  const total = card.querySelector(".orders-card__total");
  if (total) {
    total.innerHTML = `${money(order.valor_total_centavos)}${orderBalanceCents(order) > 0 ? `<small>${money(orderBalanceCents(order))} falta</small>` : ""}`;
  }

  const badges = card.querySelector(".orders-card__badges");
  if (badges) {
    const financial = orderFinancialState(order);
    const delivery = upper(order.status_pedido, "NOVO");
    const fin = FINANCEIRO[financial] || FINANCEIRO.PENDENTE;
    const ent = ENTREGA[delivery] || ENTREGA.NOVO;
    badges.innerHTML = `
      <span class="orders-status ${fin.className}" data-queue-financial>${fin.label}</span>
      <span class="orders-status ${ent.className}" data-queue-delivery>${ent.label}</span>`;
  }

  const meta = card.querySelector(".orders-card__meta");
  if (meta) {
    const created = meta.querySelector("span:first-child");
    const contact = meta.querySelector("span:nth-child(2)");
    if (created) created.querySelector("strong")?.remove();
    if (contact) contact.remove();
  }

  const details = card.querySelector(".orders-details-button");
  if (details instanceof HTMLButtonElement) {
    details.classList.add("orders-queue-open");
    details.setAttribute("aria-label", `Abrir comanda do pedido ${id}`);
    details.tabIndex = -1;
  }

  enhanceStatusMenu(card, order);

  if (card.dataset.queueRowBound !== "1") {
    card.dataset.queueRowBound = "1";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir comanda do pedido ${id}`);

    const open = event => {
      if (event.target.closest("[data-order-status-menu], .orders-details-button")) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      if (event.type === "keydown") event.preventDefault();
      const button = card.querySelector(".orders-details-button");
      if (button instanceof HTMLButtonElement) button.click();
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", open);
  }
}

function applyRowVisibility(view) {
  view.querySelectorAll(".orders-card[data-order-id]").forEach(card => {
    const order = findOrder(Number(card.dataset.orderId || 0));
    card.hidden = !order || !orderMatchesFilter(order, activeFilter);
  });
}

function enhanceView(view) {
  if (!(view instanceof HTMLElement) || !latestOrders.length) return;
  view.classList.add("orders-queue-view");
  ensureHeader(view);
  renderSummary(view);
  renderFilters(view);
  view.querySelectorAll(".orders-card[data-order-id]").forEach(enhanceCard);
  applyRowVisibility(view);
}

function enhanceCurrent() {
  document.querySelectorAll(".orders-view").forEach(enhanceView);
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceCurrent();
  });
}

installOrdersCapture();

const observer = new MutationObserver(records => {
  for (const record of records) {
    if ([...record.addedNodes].some(node => node instanceof Element && (node.matches?.(".orders-view, .orders-card") || node.querySelector?.(".orders-view, .orders-card")))) {
      scheduleEnhance();
      break;
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("rp-admin-data-changed", event => {
  if (event.detail?.pages?.includes?.("pedidos")) scheduleEnhance();
});
