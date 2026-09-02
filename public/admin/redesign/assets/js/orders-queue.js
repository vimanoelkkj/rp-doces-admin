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

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function upper(value, fallback = "") {
  return String(value || fallback).toUpperCase();
}

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

function compactDate(value) {
  if (!value) return "—";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function itemSummary(order) {
  const items = Array.isArray(order.itens) ? order.itens : [];
  if (!items.length) {
    return order.produto_nome
      ? `${Number(order.quantidade || 1)}× ${order.produto_nome}`
      : "Pedido sem itens";
  }
  return items
    .slice(0, 2)
    .map(item => `${Number(item.quantidade || 0)}× ${item.produto_nome || "Produto"}`)
    .join(" · ") + (items.length > 2 ? ` · +${items.length - 2}` : "");
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
    <article class="orders-queue-kpi is-entered"><strong>${money(entered)}</strong><span>entraram</span></article>
    <button type="button" class="orders-queue-kpi is-due" data-queue-summary-filter="receber"><strong>${money(due)}</strong><span>a receber</span></button>
    <button type="button" class="orders-queue-kpi is-deliver" data-queue-summary-filter="entregar"><strong>${toDeliver}</strong><span>a entregar</span></button>`;

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

function statusMenuMarkup(order) {
  const current = upper(order.status_pedido, "NOVO");
  return `
    <div class="orders-status-menu orders-queue-menu" data-order-status-menu>
      <button class="orders-queue-more" type="button" data-order-status-trigger aria-haspopup="menu" aria-expanded="false" aria-label="Ações do pedido ${Number(order.id)}">···</button>
      <div class="orders-status-options" data-queue-status-options role="menu" hidden>
        ${Object.entries(ENTREGA).map(([value, data]) => `
          <button type="button" role="menuitem" data-queue-status="${value}" ${value === current ? 'aria-current="true"' : ""}>
            <span>${esc(data.label)}</span>${value === current ? "<strong>✓</strong>" : ""}
          </button>`).join("")}
      </div>
    </div>`;
}

function rowMarkup(order) {
  const id = Number(order.id);
  const financial = orderFinancialState(order);
  const delivery = upper(order.status_pedido, "NOVO");
  const fin = FINANCEIRO[financial] || FINANCEIRO.PENDENTE;
  const ent = ENTREGA[delivery] || ENTREGA.NOVO;
  const balance = orderBalanceCents(order);
  const manual = order.origem_pedido === "MANUAL";

  return `
    <div class="orders-queue-main">
      <span class="orders-queue-id">#${id}${manual ? " · manual" : ""}</span>
      <strong class="orders-queue-name">${esc(order.cliente_nome || "Cliente não informado")}</strong>
      <span class="orders-queue-items">${esc(itemSummary(order))}</span>
    </div>
    <span class="orders-status ${fin.className}" data-queue-financial>${esc(fin.label)}</span>
    <span class="orders-status ${ent.className}" data-queue-delivery>${esc(ent.label)}</span>
    <div class="orders-queue-value">
      <strong>${money(order.valor_total_centavos)}</strong>
      ${balance > 0 ? `<small>${money(balance)} falta</small>` : ""}
    </div>
    <time class="orders-queue-created">${esc(compactDate(order.criado_em))}</time>
    <button class="orders-details-button orders-queue-open" type="button" aria-label="Abrir comanda do pedido ${id}" tabindex="-1">Abrir comanda</button>
    ${statusMenuMarkup(order)}`;
}

function bindStatusMenu(card, order) {
  const menu = card.querySelector("[data-order-status-menu]");
  const trigger = card.querySelector("[data-order-status-trigger]");
  const options = card.querySelector("[data-queue-status-options]");
  if (!menu || !(trigger instanceof HTMLButtonElement) || !options) return;

  trigger.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll("[data-queue-status-options]").forEach(other => {
      if (other !== options) other.hidden = true;
    });
    options.hidden = !options.hidden;
    trigger.setAttribute("aria-expanded", String(!options.hidden));
    menu.classList.toggle("is-open", !options.hidden);
  });

  options.querySelectorAll("[data-queue-status]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const next = upper(button.dataset.queueStatus);
      const previous = upper(order.status_pedido, "NOVO");
      if (!next || next === previous) {
        options.hidden = true;
        return;
      }

      trigger.disabled = true;
      try {
        await adminApi.updateOrderStatus(Number(order.id), next);
        order.status_pedido = next;
        card.dataset.queueRendered = "";
        enhanceCard(card);
        const view = card.closest(".orders-view");
        if (view) {
          renderSummary(view);
          renderFilters(view);
          applyRowVisibility(view);
        }
      } catch (error) {
        trigger.disabled = false;
        window.alert(error?.message || "Não foi possível atualizar o pedido.");
      }
    });
  });
}

function enhanceCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const id = Number(card.dataset.orderId || 0);
  const order = findOrder(id);
  if (!order) return;

  const signature = `${orderFinancialState(order)}:${upper(order.status_pedido, "NOVO")}:${order.valor_total_centavos}:${order.valor_pago_centavos}:${order.saldo_centavos}:${order.cliente_nome}:${itemSummary(order)}`;
  if (card.dataset.queueRendered === signature) return;

  card.dataset.queueRendered = signature;
  card.className = `orders-card orders-queue-row ${rowState(order)}`;
  card.innerHTML = rowMarkup(order);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Abrir comanda do pedido ${id}`);

  const openButton = card.querySelector(".orders-details-button");
  const open = event => {
    if (event.target.closest("[data-order-status-menu], .orders-details-button")) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    if (event.type === "keydown") event.preventDefault();
    if (openButton instanceof HTMLButtonElement) openButton.click();
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", open);

  bindStatusMenu(card, order);
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

document.addEventListener("click", event => {
  if (event.target.closest("[data-order-status-menu]")) return;
  document.querySelectorAll("[data-queue-status-options]").forEach(options => {
    options.hidden = true;
    options.closest("[data-order-status-menu]")?.classList.remove("is-open");
  });
});

window.addEventListener("rp-admin-data-changed", event => {
  if (event.detail?.pages?.includes?.("pedidos")) scheduleEnhance();
});
