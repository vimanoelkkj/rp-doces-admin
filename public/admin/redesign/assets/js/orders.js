import { adminApi } from "./api.js";

const ORDER_STATUS_LABELS = {
  NOVO: "Novo",
  PREPARANDO: "Preparando",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado"
};

const PAYMENT_STATUS_LABELS = {
  PENDENTE: "Aguardando pagamento",
  PAGO: "Pagamento confirmado",
  EXPIRADO: "Pix expirado",
  CANCELADO: "Pagamento cancelado",
  ERRO: "Falha no pagamento",
  REEMBOLSADO: "Reembolsado"
};

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

function dateTime(value) {
  if (!value) return "—";
  const parsed = new Date(
    String(value).replace(" ", "T") + (String(value).includes("T") ? "" : "Z")
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function paymentClass(status) {
  const value = String(status || "").toUpperCase();
  if (value === "PAGO") return "is-paid";
  if (value === "PENDENTE") return "is-pending";
  if (value === "REEMBOLSADO") return "is-refunded";
  return "is-failed";
}

function orderClass(status) {
  const value = String(status || "").toUpperCase();
  if (value === "ENTREGUE") return "is-delivered";
  if (value === "CANCELADO") return "is-cancelled";
  if (value === "PRONTO") return "is-ready";
  if (value === "PREPARANDO") return "is-preparing";
  return "is-new";
}

function itemsOf(order) {
  if (Array.isArray(order.itens) && order.itens.length) return order.itens;
  return [
    {
      produto_nome: order.produto_nome,
      quantidade: order.quantidade,
      valor_unitario_centavos: order.valor_unitario_centavos,
      valor_total_centavos: order.valor_total_centavos
    }
  ].filter(item => item.produto_nome);
}

function itemSummary(order) {
  const items = itemsOf(order);
  if (!items.length) return "Pedido sem itens";
  const first = items[0];
  const rest = items.length - 1;
  return `${Number(first.quantidade || 0)}× ${first.produto_nome}${rest > 0 ? ` + ${rest} item(ns)` : ""}`;
}

function statusControl(status) {
  return `
    <div class="orders-status-menu" data-order-status-menu>
      <button class="orders-status-trigger" type="button" data-order-status-trigger aria-haspopup="listbox" aria-expanded="false">
        <span>${esc(ORDER_STATUS_LABELS[status] || status)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
      </button>
      <div class="orders-status-options" role="listbox" aria-label="Alterar andamento do pedido" hidden>
        ${Object.entries(ORDER_STATUS_LABELS)
          .map(
            ([value, label]) => `
              <button type="button" role="option" data-order-status-value="${value}" aria-selected="${value === status}">
                <span>${esc(label)}</span>${value === status ? "<strong>✓</strong>" : ""}
              </button>`
          )
          .join("")}
      </div>
    </div>`;
}

function orderCard(order) {
  const payment = String(order.status_pagamento || "PENDENTE").toUpperCase();
  const status = String(order.status_pedido || "NOVO").toUpperCase();
  const pendingClass = payment === "PENDENTE" ? " is-payment-pending" : "";

  return `
    <article class="orders-card${pendingClass}" data-order-id="${Number(order.id)}">
      <div class="orders-card__top">
        <div>
          <span class="orders-card__number">Pedido #${Number(order.id)}</span>
          <h3>${esc(order.cliente_nome || "Cliente")}</h3>
          <p>${esc(itemSummary(order))}</p>
        </div>
        <strong class="orders-card__total">${money(order.valor_total_centavos)}</strong>
      </div>

      <div class="orders-card__badges">
        <span class="orders-status ${paymentClass(payment)}">${esc(PAYMENT_STATUS_LABELS[payment] || payment)}</span>
        <span class="orders-status ${orderClass(status)}">${esc(ORDER_STATUS_LABELS[status] || status)}</span>
        <span class="orders-status is-neutral">${esc(order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada")}</span>
      </div>

      <div class="orders-card__meta">
        <span><strong>Criado</strong>${esc(dateTime(order.criado_em))}</span>
        <span><strong>Contato</strong>${esc(order.cliente_whatsapp || order.cliente_email || "—")}</span>
      </div>

      <div class="orders-card__actions">
        <button class="orders-secondary orders-details-button" type="button" data-order-details>Ver detalhes</button>
        ${statusControl(status)}
      </div>
    </article>`;
}

function detailDialog(order) {
  const items = itemsOf(order);
  const payment = String(order.status_pagamento || "PENDENTE").toUpperCase();
  const status = String(order.status_pedido || "NOVO").toUpperCase();

  return `
    <div class="orders-dialog" data-orders-dialog>
      <button class="orders-dialog__backdrop" type="button" data-orders-dialog-close aria-label="Fechar detalhes"></button>
      <section class="orders-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header class="orders-dialog__head">
          <div>
            <span>Pedido #${Number(order.id)}</span>
            <h2 id="order-detail-title">${esc(order.cliente_nome || "Cliente")}</h2>
            <p>${esc(dateTime(order.criado_em))}</p>
          </div>
          <button class="orders-dialog__close" type="button" data-orders-dialog-close aria-label="Fechar">×</button>
        </header>

        <div class="orders-dialog__status">
          <span class="orders-status ${paymentClass(payment)}">${esc(PAYMENT_STATUS_LABELS[payment] || payment)}</span>
          <span class="orders-status ${orderClass(status)}">${esc(ORDER_STATUS_LABELS[status] || status)}</span>
        </div>

        <div class="orders-dialog__section">
          <h3>Itens</h3>
          <div class="orders-items">
            ${items
              .map(
                item => `
                  <div class="orders-item">
                    <div><strong>${Number(item.quantidade || 0)}× ${esc(item.produto_nome || "Produto")}</strong><span>${money(item.valor_unitario_centavos)} cada</span></div>
                    <strong>${money(item.valor_total_centavos)}</strong>
                  </div>`
              )
              .join("")}
          </div>
          <div class="orders-dialog__total"><span>Total</span><strong>${money(order.valor_total_centavos)}</strong></div>
        </div>

        <div class="orders-dialog__grid">
          <div><span>WhatsApp</span><strong>${esc(order.cliente_whatsapp || "—")}</strong></div>
          <div><span>E-mail</span><strong>${esc(order.cliente_email || "—")}</strong></div>
          <div><span>Recebimento</span><strong>${esc(order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada")}</strong></div>
          <div><span>Método</span><strong>${esc(order.metodo_pagamento || "PIX")}</strong></div>
        </div>

        ${order.observacao ? `<div class="orders-dialog__note"><span>Observação</span><p>${esc(order.observacao)}</p></div>` : ""}
      </section>
    </div>`;
}

function emptyState() {
  return `<div class="orders-empty"><strong>Nenhum pedido encontrado</strong><span>Ajuste a busca ou os filtros para ver outros pedidos.</span></div>`;
}

export async function renderOrders(container, { onUnauthorized } = {}) {
  container.innerHTML = `
    <section class="orders-view" aria-busy="true">
      <div class="orders-toolbar">
        <label class="orders-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input type="search" placeholder="Buscar pedido ou cliente" aria-label="Buscar pedido ou cliente" data-orders-search />
        </label>
        <button class="orders-secondary" type="button" data-orders-refresh>Atualizar</button>
      </div>

      <div class="orders-summary" data-orders-summary></div>

      <div class="orders-filters" aria-label="Filtrar pedidos">
        <button type="button" class="is-active" data-orders-filter="todos">Todos</button>
        <button type="button" data-orders-filter="pendentes">Pagamento pendente</button>
        <button type="button" data-orders-filter="em-andamento">Em andamento</button>
        <button type="button" data-orders-filter="concluidos">Concluídos</button>
      </div>

      <div class="orders-list" data-orders-list></div>
    </section>`;

  const view = container.querySelector(".orders-view");
  const list = container.querySelector("[data-orders-list]");
  const summary = container.querySelector("[data-orders-summary]");
  const search = container.querySelector("[data-orders-search]");
  const refresh = container.querySelector("[data-orders-refresh]");
  const filters = [...container.querySelectorAll("[data-orders-filter]")];

  let orders = [];
  let filter = "todos";
  let query = "";

  function renderSummary() {
    if (!summary) return;
    const pending = orders.filter(order => order.status_pagamento === "PENDENTE").length;
    const paid = orders.filter(order => order.status_pagamento === "PAGO").length;
    const active = orders.filter(order =>
      ["NOVO", "PREPARANDO", "PRONTO"].includes(String(order.status_pedido || "NOVO"))
    ).length;
    const delivered = orders.filter(order => order.status_pedido === "ENTREGUE").length;

    summary.innerHTML = `
      <article><span>Total</span><strong>${orders.length}</strong><small>últimos pedidos</small></article>
      <article><span>Aguardando Pix</span><strong>${pending}</strong><small>pagamentos pendentes</small></article>
      <article><span>Pagos</span><strong>${paid}</strong><small>pagamentos confirmados</small></article>
      <article><span>Em andamento</span><strong>${active}</strong><small>até a entrega</small></article>
      <article><span>Entregues</span><strong>${delivered}</strong><small>finalizados</small></article>`;
  }

  function visibleOrders() {
    return orders.filter(order => {
      const haystack =
        `${order.id} ${order.cliente_nome || ""} ${order.cliente_email || ""} ${order.cliente_whatsapp || ""} ${itemSummary(order)}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filter === "pendentes") return order.status_pagamento === "PENDENTE";
      if (filter === "em-andamento") {
        return ["NOVO", "PREPARANDO", "PRONTO"].includes(order.status_pedido);
      }
      if (filter === "concluidos") return ["ENTREGUE", "CANCELADO"].includes(order.status_pedido);
      return true;
    });
  }

  function renderList() {
    if (!list) return;
    const visible = visibleOrders();
    list.innerHTML = visible.length ? visible.map(orderCard).join("") : emptyState();
    bindOrderActions();
  }

  function closeDialog() {
    container.querySelector("[data-orders-dialog]")?.remove();
    document.body.classList.remove("orders-dialog-open");
  }

  function closeStatusMenus(except = null) {
    list?.querySelectorAll("[data-order-status-menu]").forEach(menu => {
      if (menu === except) return;
      const trigger = menu.querySelector("[data-order-status-trigger]");
      const options = menu.querySelector(".orders-status-options");
      trigger?.setAttribute("aria-expanded", "false");
      if (options) options.hidden = true;
      menu.classList.remove("is-open", "is-up");
    });
  }

  function positionStatusMenu(menu, trigger, options) {
    menu.classList.remove("is-up");

    const triggerRect = trigger.getBoundingClientRect();
    const optionsHeight = options.getBoundingClientRect().height || options.scrollHeight;
    const bottomReserve = window.innerWidth <= 860 ? 78 : 12;
    const spaceBelow = window.innerHeight - bottomReserve - triggerRect.bottom;
    const spaceAbove = triggerRect.top - 12;
    const shouldOpenUp = spaceBelow < optionsHeight + 8 && spaceAbove > spaceBelow;

    menu.classList.toggle("is-up", shouldOpenUp);
  }

  function openDetails(order) {
    closeDialog();
    container.insertAdjacentHTML("beforeend", detailDialog(order));
    document.body.classList.add("orders-dialog-open");
    container.querySelectorAll("[data-orders-dialog-close]").forEach(button => {
      button.addEventListener("click", closeDialog);
    });
  }

  function bindOrderActions() {
    list?.querySelectorAll("[data-order-id]").forEach(card => {
      const id = Number(card.dataset.orderId);
      const order = orders.find(item => Number(item.id) === id);
      if (!order) return;

      card
        .querySelector("[data-order-details]")
        ?.addEventListener("click", () => openDetails(order));

      const menu = card.querySelector("[data-order-status-menu]");
      const trigger = card.querySelector("[data-order-status-trigger]");
      const options = menu?.querySelector(".orders-status-options");

      trigger?.addEventListener("click", event => {
        event.stopPropagation();
        const opening = options?.hidden ?? false;
        closeStatusMenus(opening ? menu : null);
        if (!options || !menu) return;

        options.hidden = !opening;
        menu.classList.toggle("is-open", opening);
        trigger.setAttribute("aria-expanded", String(opening));

        if (opening) positionStatusMenu(menu, trigger, options);
        else menu.classList.remove("is-up");
      });

      menu?.querySelectorAll("[data-order-status-value]").forEach(option => {
        option.addEventListener("click", async event => {
          event.stopPropagation();
          const next = option.dataset.orderStatusValue;
          const previous = order.status_pedido || "NOVO";
          if (!next || next === previous) return closeStatusMenus();

          trigger.disabled = true;
          closeStatusMenus();
          try {
            await adminApi.updateOrderStatus(id, next);
            order.status_pedido = next;
            renderSummary();
            renderList();
          } catch (error) {
            order.status_pedido = previous;
            trigger.disabled = false;
            window.alert(error?.message || "Não foi possível atualizar o pedido.");
          }
        });
      });
    });
  }

  async function loadOrders() {
    if (view) view.setAttribute("aria-busy", "true");
    if (refresh instanceof HTMLButtonElement) refresh.disabled = true;
    try {
      const payload = await adminApi.orders();
      orders = Array.isArray(payload?.pedidos) ? payload.pedidos : [];
      renderSummary();
      renderList();
    } catch (error) {
      if (error?.status === 401 && typeof onUnauthorized === "function") return onUnauthorized();
      if (list)
        list.innerHTML = `<div class="orders-empty"><strong>Não foi possível carregar os pedidos</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div>`;
    } finally {
      if (view) view.setAttribute("aria-busy", "false");
      if (refresh instanceof HTMLButtonElement) refresh.disabled = false;
    }
  }

  search?.addEventListener("input", event => {
    query = String(event.target.value || "")
      .trim()
      .toLowerCase();
    renderList();
  });

  filters.forEach(button => {
    button.addEventListener("click", () => {
      filter = button.dataset.ordersFilter || "todos";
      filters.forEach(item => item.classList.toggle("is-active", item === button));
      renderList();
    });
  });

  refresh?.addEventListener("click", loadOrders);

  document.addEventListener("click", event => {
    if (!event.target.closest("[data-order-status-menu]")) closeStatusMenus();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (container.querySelector("[data-orders-dialog]")) closeDialog();
    else closeStatusMenus();
  });

  await loadOrders();
}
