import { adminApi } from "./api.js";

const PAYMENT_METHODS = [
  ["PIX_EXTERNO", "Pix direto"],
  ["CARTAO", "Cartão"],
  ["DINHEIRO", "Dinheiro"],
  ["A_COMBINAR", "A combinar"]
];

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function productPrice(product) {
  const now = Date.now();
  const inicioOk = !product.promocao_inicio || Date.parse(product.promocao_inicio) <= now;
  const fimOk = !product.promocao_fim || Date.parse(product.promocao_fim) > now;
  return product.promocao_ativa && Number(product.preco_promocional_centavos) > 0 && inicioOk && fimOk
    ? Number(product.preco_promocional_centavos)
    : Number(product.preco_centavos);
}

function orderIdFromDialog(dialog) {
  const text = dialog.querySelector(".orders-dialog__head > div > span")?.textContent || "";
  const match = text.match(/Pedido\s+#(\d+)/i);
  return match ? Number(match[1]) : null;
}

function pendingDialog(dialog) {
  return [...dialog.querySelectorAll(".orders-dialog__status .orders-status")].some(
    badge => badge.textContent?.trim().toLowerCase() === "aguardando pagamento"
  );
}

function reservedByOrder(order) {
  const map = new Map();
  if (String(order.reserva_status || "").toUpperCase() !== "ATIVA") return map;
  for (const item of order.itens || []) {
    const id = Number(item.produto_id || 0);
    if (id) map.set(id, (map.get(id) || 0) + Number(item.quantidade || 0));
  }
  return map;
}

function effectiveAvailable(product, reserved) {
  return Math.max(0, Number(product.estoque || 0) - Number(product.estoque_reservado || 0) + (reserved.get(Number(product.id)) || 0));
}

function paymentMethod(order) {
  const current = String(order.metodo_pagamento || "").toUpperCase();
  return PAYMENT_METHODS.some(([value]) => value === current) ? current : "A_COMBINAR";
}

function selectOptions(products, reserved, selectedId, selectedElsewhere = new Set()) {
  return products.map(product => {
    const id = Number(product.id);
    const available = effectiveAvailable(product, reserved);
    const currentReserved = reserved.get(id) || 0;
    const disabled = selectedElsewhere.has(id) || available <= 0 || (!product.disponivel && currentReserved <= 0);
    return `<option value="${id}" ${id === selectedId ? "selected" : ""} ${disabled && id !== selectedId ? "disabled" : ""}>${esc(product.nome)} · ${money(productPrice(product))} · ${available} disp.</option>`;
  }).join("");
}

function itemRow(item, key, products, reserved, allItems) {
  const selectedElsewhere = new Set(allItems.filter(other => other.key !== key).map(other => Number(other.produtoId)));
  const product = products.find(candidate => Number(candidate.id) === Number(item.produtoId));
  const max = Math.min(50, product ? effectiveAvailable(product, reserved) : 50);
  return `
    <div class="manual-order-item" data-edit-order-item data-edit-key="${key}">
      <label><span>Produto</span><select data-edit-product>${selectOptions(products, reserved, Number(item.produtoId), selectedElsewhere)}</select></label>
      <label class="manual-qty"><span>Qtd.</span><input type="number" min="1" max="${max}" value="${Number(item.quantidade || 1)}" data-edit-qty /></label>
      <button type="button" class="manual-remove-item" data-edit-remove aria-label="Remover item" ${allItems.length === 1 ? "disabled" : ""}>×</button>
    </div>`;
}

async function openEditor(orderId, detailDialog) {
  const [ordersPayload, productsPayload] = await Promise.all([adminApi.orders(), adminApi.products()]);
  const order = (ordersPayload?.pedidos || []).find(item => Number(item.id) === orderId);
  if (!order) throw new Error("Pedido não encontrado.");
  if (String(order.status_pagamento || "").toUpperCase() !== "PENDENTE") throw new Error("Somente pedidos com pagamento pendente podem ser editados.");

  const reserved = reservedByOrder(order);
  const products = (productsPayload?.produtos || []).filter(product => Boolean(product.ativo));
  let items = (order.itens || [])
    .filter(item => Number(item.produto_id || 0) > 0)
    .map((item, index) => ({ key: index, produtoId: Number(item.produto_id), quantidade: Number(item.quantidade || 1) }));
  let nextKey = Math.max(1, items.length);

  const modal = document.createElement("div");
  modal.className = "orders-dialog manual-order-dialog";
  modal.dataset.editOrderDialog = "";
  modal.innerHTML = `
    <button class="orders-dialog__backdrop" type="button" data-edit-order-close aria-label="Fechar"></button>
    <section class="orders-dialog__panel manual-order-panel" role="dialog" aria-modal="true" aria-labelledby="edit-order-title-v1">
      <header class="orders-dialog__head">
        <div><span>Pedido #${Number(order.id)}</span><h2 id="edit-order-title-v1">Editar pedido</h2><p>Altere itens, quantidades e a forma de pagamento sem abrir outro pedido.</p></div>
        <button class="orders-dialog__close" type="button" data-edit-order-close aria-label="Fechar">×</button>
      </header>
      <form class="manual-order-form" data-edit-order-form>
        <div class="manual-order-section">
          <div class="manual-order-section__head"><div><strong>Itens</strong><span>O total e a reserva serão recalculados ao salvar.</span></div><button type="button" class="orders-secondary" data-edit-add>+ Adicionar item</button></div>
          <div class="manual-order-items" data-edit-items></div>
        </div>
        <div class="manual-order-fields">
          <label><span>Forma de pagamento</span><select name="metodo_pagamento">${PAYMENT_METHODS.map(([value, label]) => `<option value="${value}" ${paymentMethod(order) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        </div>
        ${order.mp_order_id ? '<div class="manual-order-feedback">Ao salvar, o Pix atual do site será cancelado antes da alteração.</div>' : ""}
        <div class="manual-order-feedback" data-edit-feedback hidden></div>
        <div class="manual-order-footer">
          <button type="button" class="orders-secondary" data-edit-order-close>Cancelar</button>
          <button type="submit" class="manual-order-button" data-edit-submit>Salvar alterações</button>
        </div>
      </form>
    </section>`;
  document.body.appendChild(modal);
  document.body.classList.add("orders-dialog-open");

  const itemsRoot = modal.querySelector("[data-edit-items]");
  const feedback = modal.querySelector("[data-edit-feedback]");
  const submit = modal.querySelector("[data-edit-submit]");
  const form = modal.querySelector("[data-edit-order-form]");

  function renderItems() {
    if (!items.length) {
      const first = products.find(product => Boolean(product.disponivel) && effectiveAvailable(product, reserved) > 0);
      if (first) items = [{ key: nextKey++, produtoId: Number(first.id), quantidade: 1 }];
    }
    itemsRoot.innerHTML = items.map(item => itemRow(item, item.key, products, reserved, items)).join("");
    itemsRoot.querySelectorAll("[data-edit-order-item]").forEach(row => {
      const key = Number(row.dataset.editKey);
      row.querySelector("[data-edit-product]")?.addEventListener("change", event => {
        const item = items.find(current => current.key === key);
        if (!item) return;
        item.produtoId = Number(event.target.value);
        item.quantidade = 1;
        renderItems();
      });
      row.querySelector("[data-edit-qty]")?.addEventListener("input", event => {
        const item = items.find(current => current.key === key);
        if (item) item.quantidade = Number(event.target.value);
      });
      row.querySelector("[data-edit-remove]")?.addEventListener("click", () => {
        if (items.length <= 1) return;
        items = items.filter(current => current.key !== key);
        renderItems();
      });
    });
  }

  function close() {
    modal.remove();
    if (!document.querySelector(".orders-dialog")) document.body.classList.remove("orders-dialog-open");
  }

  modal.querySelectorAll("[data-edit-order-close]").forEach(button => button.addEventListener("click", close));
  modal.querySelector("[data-edit-add]")?.addEventListener("click", () => {
    if (items.length >= 20) return;
    const selected = new Set(items.map(item => Number(item.produtoId)));
    const next = products.find(product => Boolean(product.disponivel) && effectiveAvailable(product, reserved) > 0 && !selected.has(Number(product.id)));
    if (!next) return;
    items.push({ key: nextKey++, produtoId: Number(next.id), quantidade: 1 });
    renderItems();
  });

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!items.length) return;
    for (const item of items) {
      const product = products.find(candidate => Number(candidate.id) === Number(item.produtoId));
      if (!product || !Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 50 || item.quantidade > effectiveAvailable(product, reserved)) {
        feedback.textContent = product ? `${product.nome}: quantidade ou estoque inválido.` : "Selecione produtos válidos.";
        feedback.hidden = false;
        return;
      }
    }

    submit.disabled = true;
    submit.textContent = "Salvando…";
    feedback.hidden = true;
    try {
      const method = form.elements.namedItem("metodo_pagamento")?.value || "A_COMBINAR";
      await adminApi.editOrder(order.id, {
        itens: items.map(item => ({ produto_id: Number(item.produtoId), quantidade: Number(item.quantidade) })),
        metodo_pagamento: method
      });
      close();
      detailDialog.querySelector("[data-orders-dialog-close]")?.click();
      document.querySelector('[data-admin-nav="pedidos"]')?.click();
    } catch (error) {
      feedback.textContent = error?.message || "Não foi possível editar o pedido.";
      feedback.hidden = false;
      submit.disabled = false;
      submit.textContent = "Salvar alterações";
    }
  });

  renderItems();
}

function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLElement) || dialog.dataset.orderEditReady === "true" || !pendingDialog(dialog)) return;
  const id = orderIdFromDialog(dialog);
  if (!id) return;
  const note = dialog.querySelector(".orders-dialog__note");
  const anchor = note || dialog.querySelector(".orders-dialog__grid");
  if (!anchor) return;

  const actions = document.createElement("div");
  actions.className = "manual-payment-actions";
  actions.innerHTML = '<button type="button" class="orders-secondary" data-admin-edit-order>Editar pedido</button>';
  anchor.insertAdjacentElement("afterend", actions);
  actions.querySelector("[data-admin-edit-order]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await openEditor(id, dialog); }
    catch (error) { button.textContent = error?.message || "Não foi possível editar"; button.disabled = false; }
  });
  dialog.dataset.orderEditReady = "true";
}

function enhance() {
  document.querySelectorAll("[data-orders-dialog]").forEach(enhanceDialog);
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
