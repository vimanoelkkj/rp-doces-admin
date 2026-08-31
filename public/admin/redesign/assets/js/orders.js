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

const PAYMENT_METHOD_LABELS = {
  PIX: "Pix pelo site",
  PIX_EXTERNO: "Pix direto",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar"
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
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(cents || 0) / 100
  );
}

function dateTime(value) {
  if (!value) return "—";
  const text = String(value);
  const parsed = new Date(text.replace(" ", "T") + (text.includes("T") ? "" : "Z"));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
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
  const manual = order.origem_pedido === "MANUAL";

  return `
    <article class="orders-card${pendingClass}" data-order-id="${Number(order.id)}">
      <div class="orders-card__top">
        <div>
          <span class="orders-card__number">Pedido #${Number(order.id)}${manual ? " · Manual" : ""}</span>
          <h3>${esc(order.cliente_nome || "Cliente não informado")}</h3>
          <p>${esc(itemSummary(order))}</p>
        </div>
        <strong class="orders-card__total">${money(order.valor_total_centavos)}</strong>
      </div>

      <div class="orders-card__badges">
        ${manual ? '<span class="orders-status is-manual">Pedido manual</span>' : ""}
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
  const manual = order.origem_pedido === "MANUAL";

  return `
    <div class="orders-dialog" data-orders-dialog>
      <button class="orders-dialog__backdrop" type="button" data-orders-dialog-close aria-label="Fechar detalhes"></button>
      <section class="orders-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header class="orders-dialog__head">
          <div>
            <span>Pedido #${Number(order.id)}${manual ? " · Registrado manualmente" : ""}</span>
            <h2 id="order-detail-title">${esc(order.cliente_nome || "Cliente não informado")}</h2>
            <p>${esc(dateTime(order.criado_em))}</p>
          </div>
          <button class="orders-dialog__close" type="button" data-orders-dialog-close aria-label="Fechar">×</button>
        </header>

        <div class="orders-dialog__status">
          ${manual ? '<span class="orders-status is-manual">Pedido manual</span>' : ""}
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
          <div><span>Método</span><strong>${esc(PAYMENT_METHOD_LABELS[order.metodo_pagamento] || order.metodo_pagamento || "Pix")}</strong></div>
        </div>

        ${order.observacao ? `<div class="orders-dialog__note"><span>Observação</span><p>${esc(order.observacao)}</p></div>` : ""}

        ${
          manual && payment === "PENDENTE"
            ? `<div class="manual-payment-actions">
                <button type="button" class="manual-order-button is-confirm" data-manual-payment="PAGO">Confirmar pagamento</button>
                <button type="button" class="orders-secondary is-danger" data-manual-payment="CANCELADO">Cancelar pedido</button>
              </div>`
            : ""
        }
      </section>
    </div>`;
}

function productPrice(product) {
  const now = Date.now();
  const inicioOk = !product.promocao_inicio || Date.parse(product.promocao_inicio) <= now;
  const fimOk = !product.promocao_fim || Date.parse(product.promocao_fim) > now;
  const promo =
    Boolean(product.promocao_ativa) &&
    Number(product.preco_promocional_centavos) > 0 &&
    inicioOk &&
    fimOk;
  return promo ? Number(product.preco_promocional_centavos) : Number(product.preco_centavos);
}

function manualOrderDialog(products) {
  const availableProducts = products.filter(product => {
    const available = Number(product.estoque || 0) - Number(product.estoque_reservado || 0);
    return Boolean(product.ativo) && Boolean(product.disponivel) && available > 0;
  });

  const options = availableProducts
    .map(product => {
      const available = Number(product.estoque || 0) - Number(product.estoque_reservado || 0);
      return `<option value="${Number(product.id)}">${esc(product.nome)} · ${money(productPrice(product))} · ${available} disp.</option>`;
    })
    .join("");

  return `
    <div class="orders-dialog manual-order-dialog" data-manual-order-dialog>
      <button class="orders-dialog__backdrop" type="button" data-manual-order-close aria-label="Fechar"></button>
      <section class="orders-dialog__panel manual-order-panel" role="dialog" aria-modal="true" aria-labelledby="manual-order-title">
        <header class="orders-dialog__head">
          <div>
            <span>Novo pedido</span>
            <h2 id="manual-order-title">Registrar venda manual</h2>
            <p>Balcão, WhatsApp, boca a boca ou pedido feito fora do site.</p>
          </div>
          <button class="orders-dialog__close" type="button" data-manual-order-close aria-label="Fechar">×</button>
        </header>

        <form class="manual-order-form" data-manual-order-form>
          <div class="manual-order-fields two-cols">
            <label><span>Cliente <small>opcional</small></span><input name="cliente_nome" maxlength="120" placeholder="Nome do cliente" /></label>
            <label><span>WhatsApp <small>opcional</small></span><input name="cliente_whatsapp" maxlength="40" inputmode="tel" placeholder="(31) 99999-9999" /></label>
          </div>

          <div class="manual-order-section">
            <div class="manual-order-section__head"><div><strong>Itens</strong><span>O estoque será reservado ao salvar.</span></div><button type="button" class="orders-secondary" data-manual-add-item>+ Adicionar item</button></div>
            <div class="manual-order-items" data-manual-items>
              <div class="manual-order-item" data-manual-item>
                <label><span>Produto</span><select data-manual-product ${availableProducts.length ? "" : "disabled"}>${options || '<option value="">Nenhum produto disponível</option>'}</select></label>
                <label class="manual-qty"><span>Qtd.</span><input type="number" min="1" max="50" value="1" data-manual-qty /></label>
                <button type="button" class="manual-remove-item" data-manual-remove aria-label="Remover item">×</button>
              </div>
            </div>
          </div>

          <div class="manual-order-fields two-cols">
            <label><span>Forma de pagamento</span><select name="metodo_pagamento"><option value="PIX_EXTERNO">Pix direto</option><option value="CARTAO">Cartão</option><option value="DINHEIRO">Dinheiro</option><option value="A_COMBINAR">A combinar</option></select></label>
            <label><span>Situação do pagamento</span><select name="status_pagamento"><option value="PENDENTE">Aguardando pagamento</option><option value="PAGO">Já pago</option></select></label>
          </div>

          <label class="manual-order-note"><span>Observação <small>opcional</small></span><textarea name="observacao" maxlength="500" rows="3" placeholder="Ex.: buscar amanhã às 15h"></textarea></label>

          <div class="manual-order-feedback" data-manual-feedback hidden></div>
          <div class="manual-order-footer">
            <button type="button" class="orders-secondary" data-manual-order-close>Cancelar</button>
            <button type="submit" class="manual-order-button" data-manual-submit ${availableProducts.length ? "" : "disabled"}>Registrar pedido</button>
          </div>
        </form>
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
        <div class="orders-toolbar__actions">
          <button class="orders-secondary" type="button" data-orders-refresh>Atualizar</button>
          <button class="manual-order-button" type="button" data-manual-order-open>+ Novo pedido</button>
        </div>
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
  const openManual = container.querySelector("[data-manual-order-open]");
  const filters = [...container.querySelectorAll("[data-orders-filter]")];

  let orders = [];
  let filter = "todos";
  let query = "";

  function renderSummary() {
    if (!summary) return;
    const pending = orders.filter(order => order.status_pagamento === "PENDENTE").length;
    const paid = orders.filter(order => order.status_pagamento === "PAGO").length;
    const manual = orders.filter(order => order.origem_pedido === "MANUAL").length;
    const active = orders.filter(order =>
      ["NOVO", "PREPARANDO", "PRONTO"].includes(String(order.status_pedido || "NOVO"))
    ).length;
    const delivered = orders.filter(order => order.status_pedido === "ENTREGUE").length;

    summary.innerHTML = `
      <article><span>Total</span><strong>${orders.length}</strong><small>últimos pedidos</small></article>
      <article><span>Aguardando</span><strong>${pending}</strong><small>pagamentos pendentes</small></article>
      <article><span>Pagos</span><strong>${paid}</strong><small>pagamentos confirmados</small></article>
      <article><span>Manuais</span><strong>${manual}</strong><small>fora do site</small></article>
      <article><span>Em andamento</span><strong>${active}</strong><small>até a entrega</small></article>
      <article><span>Entregues</span><strong>${delivered}</strong><small>finalizados</small></article>`;
  }

  function visibleOrders() {
    return orders.filter(order => {
      const haystack = `${order.id} ${order.cliente_nome || ""} ${order.cliente_email || ""} ${order.cliente_whatsapp || ""} ${itemSummary(order)}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filter === "pendentes") return order.status_pagamento === "PENDENTE";
      if (filter === "em-andamento") return ["NOVO", "PREPARANDO", "PRONTO"].includes(order.status_pedido);
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

  function closeManualDialog() {
    container.querySelector("[data-manual-order-dialog]")?.remove();
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
    menu.classList.toggle("is-up", spaceBelow < optionsHeight + 8 && spaceAbove > spaceBelow);
  }

  function openDetails(order) {
    closeDialog();
    container.insertAdjacentHTML("beforeend", detailDialog(order));
    document.body.classList.add("orders-dialog-open");
    container.querySelectorAll("[data-orders-dialog-close]").forEach(button => button.addEventListener("click", closeDialog));
    container.querySelectorAll("[data-manual-payment]").forEach(button => {
      button.addEventListener("click", async () => {
        const status = button.dataset.manualPayment;
        if (!status) return;
        button.disabled = true;
        try {
          await adminApi.updateManualPayment(order.id, status);
          closeDialog();
          await loadOrders();
        } catch (error) {
          button.disabled = false;
          window.alert(error?.message || "Não foi possível atualizar o pagamento.");
        }
      });
    });
  }

  async function openManualDialog() {
    openManual.disabled = true;
    try {
      const payload = await adminApi.products();
      const products = Array.isArray(payload?.produtos) ? payload.produtos : [];
      closeManualDialog();
      container.insertAdjacentHTML("beforeend", manualOrderDialog(products));
      document.body.classList.add("orders-dialog-open");

      const dialog = container.querySelector("[data-manual-order-dialog]");
      const form = dialog?.querySelector("[data-manual-order-form]");
      const itemsRoot = dialog?.querySelector("[data-manual-items]");
      const firstItem = itemsRoot?.querySelector("[data-manual-item]");
      const template = firstItem?.outerHTML || "";
      const feedback = dialog?.querySelector("[data-manual-feedback]");
      const submit = dialog?.querySelector("[data-manual-submit]");

      dialog?.querySelectorAll("[data-manual-order-close]").forEach(button => button.addEventListener("click", closeManualDialog));

      function bindRemoveButtons() {
        itemsRoot?.querySelectorAll("[data-manual-remove]").forEach(button => {
          button.onclick = () => {
            const rows = itemsRoot.querySelectorAll("[data-manual-item]");
            if (rows.length <= 1) return;
            button.closest("[data-manual-item]")?.remove();
          };
        });
      }

      bindRemoveButtons();
      dialog?.querySelector("[data-manual-add-item]")?.addEventListener("click", () => {
        if (!template || !itemsRoot) return;
        itemsRoot.insertAdjacentHTML("beforeend", template);
        bindRemoveButtons();
      });

      form?.addEventListener("submit", async event => {
        event.preventDefault();
        const data = new FormData(form);
        const itens = [...form.querySelectorAll("[data-manual-item]")].map(row => ({
          produto_id: Number(row.querySelector("[data-manual-product]")?.value),
          quantidade: Number(row.querySelector("[data-manual-qty]")?.value)
        }));

        if (itens.some(item => !item.produto_id || !Number.isInteger(item.quantidade) || item.quantidade < 1)) {
          if (feedback) {
            feedback.hidden = false;
            feedback.textContent = "Revise os produtos e quantidades.";
          }
          return;
        }

        if (submit) submit.disabled = true;
        if (feedback) feedback.hidden = true;
        try {
          await adminApi.createManualOrder({
            cliente_nome: data.get("cliente_nome"),
            cliente_whatsapp: data.get("cliente_whatsapp"),
            observacao: data.get("observacao"),
            metodo_pagamento: data.get("metodo_pagamento"),
            status_pagamento: data.get("status_pagamento"),
            itens
          });
          closeManualDialog();
          await loadOrders();
        } catch (error) {
          if (feedback) {
            feedback.hidden = false;
            feedback.textContent = error?.message || "Não foi possível registrar o pedido.";
          }
          if (submit) submit.disabled = false;
        }
      });
    } catch (error) {
      window.alert(error?.message || "Não foi possível carregar os produtos.");
    } finally {
      openManual.disabled = false;
    }
  }

  function bindOrderActions() {
    list?.querySelectorAll("[data-order-id]").forEach(card => {
      const id = Number(card.dataset.orderId);
      const order = orders.find(item => Number(item.id) === id);
      if (!order) return;

      card.querySelector("[data-order-details]")?.addEventListener("click", () => openDetails(order));

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
            await loadOrders();
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
      if (list) list.innerHTML = `<div class="orders-empty"><strong>Não foi possível carregar os pedidos</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div>`;
    } finally {
      if (view) view.setAttribute("aria-busy", "false");
      if (refresh instanceof HTMLButtonElement) refresh.disabled = false;
    }
  }

  search?.addEventListener("input", event => {
    query = String(event.target.value || "").trim().toLowerCase();
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
  openManual?.addEventListener("click", openManualDialog);

  document.addEventListener("click", event => {
    if (!event.target.closest("[data-order-status-menu]")) closeStatusMenus();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (container.querySelector("[data-manual-order-dialog]")) closeManualDialog();
    else if (container.querySelector("[data-orders-dialog]")) closeDialog();
    else closeStatusMenus();
  });

  await loadOrders();
}
