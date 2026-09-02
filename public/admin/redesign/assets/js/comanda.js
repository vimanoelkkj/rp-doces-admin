import { adminApi } from "./api.js";

const PAYMENT_LABELS = {
  PIX_MP: "Pix pelo site",
  PIX: "Pix pelo site",
  PIX_EXTERNO: "Pix direto",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar"
};

let releasePageScroll = null;

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function dateTime(value) {
  if (!value) return "—";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function cents(value) {
  const raw = String(value || "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function financialLabel(status) {
  if (status === "PAGO") return "Pago";
  if (status === "PARCIAL") return "Parcial";
  return "Pendente";
}

function statusClass(status) {
  if (status === "PAGO") return "comanda-status-paid";
  if (status === "PARCIAL") return "comanda-status-partial";
  if (["CANCELADO", "EXPIRADO", "FALHOU", "REEMBOLSADO"].includes(status)) return "comanda-status-cancelled";
  return "comanda-status-pending";
}

async function financialOrder(orderId) {
  const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/finance`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
  return payload?.pedido || null;
}

async function loadState(orderId) {
  const [order, productsPayload] = await Promise.all([financialOrder(orderId), adminApi.products()]);
  if (!order) throw new Error("Comanda não encontrada.");
  const products = (productsPayload?.produtos || []).filter(product => Boolean(product.ativo) && Boolean(product.disponivel));
  return { order, products };
}

function lockPageScroll() {
  const body = document.body;
  const root = document.documentElement;
  const scrollY = window.scrollY;
  const previous = {
    rootOverflow: root.style.overflow,
    rootOverscrollBehavior: root.style.overscrollBehavior,
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width
  };
  root.style.overflow = "hidden";
  root.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    root.style.overflow = previous.rootOverflow;
    root.style.overscrollBehavior = previous.rootOverscrollBehavior;
    body.style.overflow = previous.bodyOverflow;
    body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
    body.style.position = previous.bodyPosition;
    body.style.top = previous.bodyTop;
    body.style.left = previous.bodyLeft;
    body.style.right = previous.bodyRight;
    body.style.width = previous.bodyWidth;
    window.scrollTo(0, scrollY);
  };
}

function findPendingPix(order) {
  return (order.pagamentos || []).find(payment => payment.metodo === "PIX_MP" && payment.status === "PENDENTE") || null;
}

function paymentRows(order) {
  return (order.pagamentos || []).map(payment => `
    <div class="comanda-line">
      <div class="comanda-line-name"><strong>${esc(PAYMENT_LABELS[payment.metodo] || payment.metodo)}</strong><small>${payment.origem === "ADMIN" ? "Registrado pelo admin" : "Criado pelo site"} · ${esc(dateTime(payment.pago_em || payment.criado_em))}</small>${payment.substitui_pagamento_id ? `<small>Substitui a cobrança #${Number(payment.substitui_pagamento_id)}</small>` : ""}</div>
      <span class="comanda-state ${statusClass(payment.status)}">${esc(payment.status)}</span>
      <strong class="comanda-line-value">${money(payment.valor_centavos)}</strong>
    </div>`).join("");
}

function itemRows(order) {
  return (order.itens || []).map(item => `
    <div class="comanda-line">
      <div class="comanda-line-name"><strong>${Number(item.quantidade || 0)}× ${esc(item.produto_nome || "Produto")}</strong><small>${money(item.valor_unitario_centavos)} cada · pago ${money(item.valor_pago_centavos)}</small></div>
      <span class="comanda-state ${statusClass(item.status_financeiro)}">${esc(financialLabel(item.status_financeiro))}</span>
      <strong class="comanda-line-value">${money(item.valor_total_centavos)}</strong>
    </div>`).join("");
}

function markup(order, products) {
  const pendingPix = findPendingPix(order);
  const open = order.status_comanda !== "ENCERRADA";
  const saldo = Number(order.saldo_centavos || 0);
  const total = Number(order.valor_total_centavos || 0);
  const paid = Number(order.valor_pago_centavos || 0);
  const progress = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
  const productOptions = products.map(product => `<option value="${Number(product.id)}">${esc(product.nome)}</option>`).join("");
  const items = itemRows(order);
  const payments = paymentRows(order);
  const pendingCode = pendingPix?.mp_qr_code || "";

  return `<div class="comanda-dialog" data-comanda-dialog data-order-id="${Number(order.id)}">
    <button class="comanda-backdrop" type="button" data-comanda-close aria-label="Fechar comanda"></button>
    <section class="comanda-panel" role="dialog" aria-modal="true" aria-labelledby="comanda-title">
      <header class="comanda-head">
        <div class="comanda-head-meta"><span>Pedido #${Number(order.id)} · Comanda</span><h2 id="comanda-title">${esc(order.cliente_nome || "Cliente")}</h2><small>Aberta desde ${esc(dateTime(order.criado_em))}</small></div>
        <span class="comanda-chip ${open ? "is-open" : "is-closed"}">${open ? (saldo <= 0 ? "Comanda quitada" : "Comanda aberta") : "Comanda encerrada"}</span>
        <button class="comanda-close" type="button" data-comanda-close aria-label="Fechar">×</button>
      </header>

      <div class="comanda-body">
        <p class="comanda-feedback" data-comanda-feedback hidden></p>
        <p class="comanda-error" data-comanda-error hidden></p>

        <section class="comanda-balance">
          <div class="comanda-balance-row">
            <div><span>Falta receber</span><strong class="${saldo <= 0 ? "is-settled" : ""}">${money(saldo)}</strong></div>
            <p>Total <b>${money(total)}</b> · Pago <b>${money(paid)}</b></p>
          </div>
          <div class="comanda-progress"><i style="width:${progress.toFixed(2)}%"></i></div>
        </section>

        ${pendingPix ? `<section class="comanda-pending-pix">
          <div class="comanda-pending-top"><span class="comanda-pending-dot"></span><strong>Pix de ${money(pendingPix.valor_centavos)} aguardando pagamento</strong><small>${esc(dateTime(pendingPix.criado_em))}</small></div>
          <div class="comanda-pending-code"><code>${esc(pendingCode || "Código Pix indisponível")}</code>${pendingCode ? '<button type="button" class="comanda-mini" data-comanda-copy-pix>Copiar</button>' : ""}<button type="button" class="comanda-mini is-ghost" data-comanda-cancel-pix>Cancelar</button></div>
        </section>` : ""}

        ${open ? `<section class="comanda-receive">
          <h3>Receber</h3><p>Escolha a forma e o valor. O resto a tela resolve.</p>
          <div class="comanda-methods" role="group" aria-label="Forma de pagamento">
            <button type="button" data-comanda-method="PIX" aria-pressed="true">Pix</button>
            <button type="button" data-comanda-method="DINHEIRO" aria-pressed="false">Dinheiro</button>
            <button type="button" data-comanda-method="CARTAO" aria-pressed="false">Cartão</button>
            <button type="button" data-comanda-method="PIX_EXTERNO" aria-pressed="false">Pix direto</button>
          </div>
          <div class="comanda-receive-field"><label for="comanda-receive-value">Valor</label><div class="comanda-amount-row"><div class="comanda-money-input"><span>R$</span><input id="comanda-receive-value" data-comanda-receive-value inputmode="decimal" value="${(saldo / 100).toFixed(2).replace(".", ",")}"></div><div class="comanda-quick"><button type="button" data-comanda-quick="all">Tudo</button><button type="button" data-comanda-quick="half">Metade</button></div></div></div>
          <div class="comanda-consequence" data-comanda-consequence><p></p>${pendingPix ? '<label><input type="checkbox" data-comanda-keep-pix><span data-comanda-keep-label>Manter o Pix atual e gerar uma segunda cobrança</span></label>' : ""}</div>
          <button type="button" class="comanda-cta" data-comanda-receive-submit ${saldo <= 0 ? "disabled" : ""}>Gerar Pix de ${money(saldo)}</button>
        </section>` : ""}

        <section class="comanda-block">
          <header class="comanda-block-head"><h3>Itens</h3><span>${(order.itens || []).length} ${(order.itens || []).length === 1 ? "item" : "itens"}</span>${open ? '<button type="button" class="comanda-linkish" data-comanda-add-toggle>+ Adicionar</button>' : ""}</header>
          ${open ? `<form class="comanda-add-form" data-comanda-add-form hidden><label>Produto<select name="produto_id" required><option value="">Selecione</option>${productOptions}</select></label><label>Quantidade<input name="quantidade" type="number" min="1" max="50" value="1" required></label><button class="comanda-secondary" type="submit">Adicionar à comanda</button></form>` : ""}
          <div>${items || '<div class="comanda-empty">Nenhum item.</div>'}</div>
        </section>

        <details class="comanda-block comanda-history">
          <summary><span class="comanda-caret">▶</span><h3>Histórico</h3><span>${(order.pagamentos || []).length} ${(order.pagamentos || []).length === 1 ? "registro" : "registros"}</span></summary>
          <div>${payments || '<div class="comanda-empty">Nenhum pagamento registrado.</div>'}</div>
        </details>
      </div>
    </section>
  </div>`;
}

async function openComanda(orderId) {
  document.querySelector("[data-comanda-dialog]")?.remove();
  releasePageScroll?.();
  releasePageScroll = lockPageScroll();

  let state;
  try {
    state = await loadState(orderId);
  } catch (error) {
    releasePageScroll?.();
    releasePageScroll = null;
    window.alert(error?.message || "Não foi possível carregar a comanda.");
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup(state.order, state.products);
  const dialog = wrapper.firstElementChild;
  document.body.append(dialog);

  const close = () => {
    dialog.remove();
    releasePageScroll?.();
    releasePageScroll = null;
  };
  dialog.querySelectorAll("[data-comanda-close]").forEach(button => button.addEventListener("click", close));

  const feedback = dialog.querySelector("[data-comanda-feedback]");
  const errorBox = dialog.querySelector("[data-comanda-error]");
  const show = (node, message) => { if (!node) return; node.textContent = message; node.hidden = false; };
  const busy = value => dialog.querySelectorAll("button,input,select").forEach(control => { control.disabled = value; });
  const refresh = async message => {
    close();
    await openComanda(orderId);
    if (message) setTimeout(() => {
      const node = document.querySelector("[data-comanda-feedback]");
      if (node) show(node, message);
    }, 0);
  };
  const run = async (task, message) => {
    if (feedback) feedback.hidden = true;
    if (errorBox) errorBox.hidden = true;
    busy(true);
    try {
      await task();
      window.dispatchEvent(new CustomEvent("rp-admin-data-changed", { detail: { pages: ["pedidos", "produtos", "dashboard"] } }));
      await refresh(message);
    } catch (error) {
      busy(false);
      show(errorBox, error?.message || "Não foi possível concluir a operação.");
    }
  };

  const pendingPix = findPendingPix(state.order);
  const saldo = Number(state.order.saldo_centavos || 0);
  let method = "PIX";

  const valueInput = dialog.querySelector("[data-comanda-receive-value]");
  const consequence = dialog.querySelector("[data-comanda-consequence]");
  const keepPix = dialog.querySelector("[data-comanda-keep-pix]");
  const keepLabel = dialog.querySelector("[data-comanda-keep-label]");
  const receiveSubmit = dialog.querySelector("[data-comanda-receive-submit]");

  const renderReceive = () => {
    if (!valueInput || !receiveSubmit || !consequence) return;
    const value = cents(valueInput.value);
    const keep = Boolean(keepPix?.checked);
    const pendingValue = Number(pendingPix?.valor_centavos || 0);
    const after = Math.max(0, saldo - value);
    let text = "";

    if (!pendingPix) {
      text = method === "PIX"
        ? `Gera uma cobrança de <b>${money(value)}</b>. O saldo só cai quando o pagamento for confirmado.`
        : `Registra <b>${money(value)}</b> em ${esc(PAYMENT_LABELS[method] || method)}. Saldo depois: <b>${money(after)}</b>.`;
    } else if (method === "PIX") {
      if (keepLabel) keepLabel.textContent = "Manter o Pix atual e gerar uma segunda cobrança";
      text = keep
        ? `Ficam <b>duas</b> cobranças abertas: a de <b>${money(pendingValue)}</b> e a nova de <b>${money(value)}</b>.`
        : `O Pix de <b>${money(pendingValue)}</b> é cancelado e substituído por um novo de <b>${money(value)}</b>.`;
    } else {
      if (keepLabel) keepLabel.textContent = "Manter o Pix pendente e registrar este pagamento em separado";
      text = keep
        ? `Registra <b>${money(value)}</b> em ${esc(PAYMENT_LABELS[method] || method)} e o Pix de <b>${money(pendingValue)}</b> continua aberto.`
        : `O Pix de <b>${money(pendingValue)}</b> é cancelado e <b>${money(value)}</b> entra como ${esc(PAYMENT_LABELS[method] || method)}. Saldo depois: <b>${money(after)}</b>.`;
    }

    const p = consequence.querySelector("p");
    if (p) p.innerHTML = text;
    receiveSubmit.disabled = value <= 0 || saldo <= 0;
    receiveSubmit.textContent = method === "PIX" ? `Gerar Pix de ${money(value)}` : `Registrar ${money(value)} em ${PAYMENT_LABELS[method] || method}`;
  };

  dialog.querySelectorAll("[data-comanda-method]").forEach(button => {
    button.addEventListener("click", () => {
      method = button.dataset.comandaMethod || "PIX";
      dialog.querySelectorAll("[data-comanda-method]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      renderReceive();
    });
  });
  valueInput?.addEventListener("input", renderReceive);
  keepPix?.addEventListener("change", renderReceive);
  dialog.querySelectorAll("[data-comanda-quick]").forEach(button => {
    button.addEventListener("click", () => {
      const next = button.dataset.comandaQuick === "half" ? Math.max(1, Math.round(saldo / 2)) : saldo;
      valueInput.value = (next / 100).toFixed(2).replace(".", ",");
      renderReceive();
    });
  });
  renderReceive();

  receiveSubmit?.addEventListener("click", () => {
    const value = cents(valueInput?.value);
    if (value <= 0) return show(errorBox, "Informe um valor válido.");
    const pixDecision = pendingPix ? (keepPix?.checked ? "MANTER" : "CANCELAR") : undefined;
    if (method === "PIX") {
      run(() => adminApi.generateComandaPix(orderId, { valor_centavos: value, ...(pixDecision ? { pix_pendente: pixDecision } : {}) }), "Cobrança Pix gerada.");
      return;
    }
    run(() => adminApi.registerComandaPayment(orderId, { metodo: method, valor_centavos: value, ...(pixDecision ? { pix_pendente: pixDecision } : {}) }), "Pagamento registrado.");
  });

  dialog.querySelector("[data-comanda-add-toggle]")?.addEventListener("click", () => {
    const form = dialog.querySelector("[data-comanda-add-form]");
    if (form) form.hidden = !form.hidden;
  });

  dialog.querySelector("[data-comanda-add-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const productId = Number(form.elements.produto_id.value);
    const quantity = Number(form.elements.quantidade.value);
    const product = state.products.find(item => Number(item.id) === productId);
    if (!product || !Number.isInteger(quantity) || quantity < 1) return show(errorBox, "Selecione um produto e uma quantidade válida.");
    run(() => adminApi.addComandaItem(orderId, { produto_id: productId, quantidade: quantity }), "Item adicionado à comanda.");
  });

  dialog.querySelector("[data-comanda-cancel-pix]")?.addEventListener("click", () => run(() => adminApi.cancelComandaPix(orderId), "Cobrança Pix cancelada."));
  dialog.querySelector("[data-comanda-copy-pix]")?.addEventListener("click", async () => {
    const code = pendingPix?.mp_qr_code;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    show(feedback, "Código Pix copiado.");
  });
}

function enhanceOrders(root = document) {
  root.querySelectorAll?.(".orders-details-button").forEach(button => {
    if (button.dataset.comandaEnhanced === "1") return;
    button.dataset.comandaEnhanced = "1";
    if (button.textContent !== "Abrir comanda") button.textContent = "Abrir comanda";
  });
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(".orders-details-button")) enhanceOrders(node.parentElement || node);
      else if (node.querySelector?.(".orders-details-button")) enhanceOrders(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceOrders();

document.addEventListener("click", event => {
  const button = event.target.closest?.(".orders-details-button");
  if (!button) return;
  const card = button.closest("[data-order-id]");
  if (!card) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void openComanda(Number(card.dataset.orderId));
}, true);
