import { adminApi } from "./api.js";

const PAYMENT_LABELS = {
  PIX_MP: "Pix pelo site",
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
  const parsed = Number(String(value || "").replace(",", "."));
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

async function loadState(orderId) {
  const [financialPayload, productsPayload] = await Promise.all([adminApi.financialOrders(), adminApi.products()]);
  const order = (financialPayload?.pedidos || []).find(item => Number(item.id) === Number(orderId));
  if (!order) throw new Error("Comanda não encontrada.");
  const products = (productsPayload?.produtos || []).filter(product => Boolean(product.ativo) && Boolean(product.disponivel));
  return { order, products };
}

function choices(name, pending, selected = "CANCELAR") {
  if (!pending) return "";
  return `<div class="comanda-choice-group">
    <strong>Existe um Pix pendente de ${money(pending.valor_centavos)}. O que fazer?</strong>
    <label class="comanda-choice"><input type="radio" name="${name}" value="CANCELAR" ${selected === "CANCELAR" ? "checked" : ""}><span>Cancelar o Pix atual</span></label>
    <label class="comanda-choice"><input type="radio" name="${name}" value="MANTER" ${selected === "MANTER" ? "checked" : ""}><span>Manter e tratar somente outro valor</span></label>
  </div>`;
}

function markup(order, products) {
  const pendingPix = (order.pagamentos || []).find(payment => payment.metodo === "PIX_MP" && payment.status === "PENDENTE") || null;
  const open = order.status_comanda !== "ENCERRADA";
  const productOptions = products.map(product => `<option value="${Number(product.id)}">${esc(product.nome)}</option>`).join("");
  const items = (order.itens || []).map(item => `<div class="comanda-item">
    <div><strong>${Number(item.quantidade || 0)}× ${esc(item.produto_nome || "Produto")}</strong><span>${money(item.valor_unitario_centavos)} cada · pago ${money(item.valor_pago_centavos)}</span></div>
    <div class="comanda-amount">${money(item.valor_total_centavos)}<small class="${statusClass(item.status_financeiro)}">${esc(financialLabel(item.status_financeiro))}</small></div>
  </div>`).join("");
  const payments = (order.pagamentos || []).map(payment => `<div class="comanda-payment">
    <div><strong>${esc(PAYMENT_LABELS[payment.metodo] || payment.metodo)}</strong><span>${payment.origem === "ADMIN" ? "Registrado pelo admin" : "Criado pelo site"} · ${esc(dateTime(payment.pago_em || payment.criado_em))}</span>${payment.substitui_pagamento_id ? `<span>Substitui a cobrança #${Number(payment.substitui_pagamento_id)}</span>` : ""}</div>
    <div class="comanda-amount">${money(payment.valor_centavos)}<small class="${statusClass(payment.status)}">${esc(payment.status)}</small></div>
  </div>`).join("");
  const pix = pendingPix?.mp_qr_code || "";

  return `<div class="comanda-dialog" data-comanda-dialog data-order-id="${Number(order.id)}">
    <button class="comanda-backdrop" type="button" data-comanda-close aria-label="Fechar comanda"></button>
    <section class="comanda-panel" role="dialog" aria-modal="true" aria-labelledby="comanda-title">
      <header class="comanda-head"><div><span>Pedido #${Number(order.id)} · Comanda</span><h2 id="comanda-title">${esc(order.cliente_nome || "Cliente")}</h2><span>Aberta desde ${esc(dateTime(order.criado_em))}</span></div><button class="comanda-close" type="button" data-comanda-close aria-label="Fechar">×</button></header>
      <div class="comanda-status-row"><span class="comanda-pill ${open ? "is-open" : "is-closed"}">${open ? "Comanda aberta" : "Comanda encerrada"}</span><span class="comanda-pill ${order.status_financeiro === "PAGO" ? "is-paid" : "is-pending"}">Financeiro: ${esc(financialLabel(order.status_financeiro))}</span>${pendingPix ? `<span class="comanda-pill is-pending">Pix atual pendente · ${money(pendingPix.valor_centavos)}</span>` : ""}</div>
      <div class="comanda-body">
        <p class="comanda-feedback" data-comanda-feedback hidden></p><p class="comanda-error" data-comanda-error hidden></p>
        <section class="comanda-section"><header class="comanda-section-title"><div><strong>Itens</strong><span>Consumo e situação financeira por item</span></div></header>${items || '<div class="comanda-empty">Nenhum item.</div>'}</section>
        <div class="comanda-summary"><article><span>Total</span><strong>${money(order.valor_total_centavos)}</strong></article><article><span>Pago</span><strong>${money(order.valor_pago_centavos)}</strong></article><article><span>Restante</span><strong>${money(order.saldo_centavos)}</strong></article></div>
        ${open ? `<div class="comanda-actions-grid">
          <section class="comanda-action-card"><h3>Adicionar ao pedido</h3><p>Inclui um novo consumo sem alterar pagamentos anteriores.</p><form class="comanda-form" data-comanda-add-form>
            <div class="comanda-inline-fields"><div class="comanda-field"><label>Produto</label><select name="produto_id" required><option value="">Selecione</option>${productOptions}</select></div><div class="comanda-field"><label>Quantidade</label><input name="quantidade" type="number" min="1" max="50" value="1" required></div></div>
            <div class="comanda-field"><label>Pagamento deste acréscimo</label><select name="modo"><option value="PENDENTE">Deixar pendente</option><option value="PAGO">Registrar como pago agora</option><option value="PIX">Gerar Pix</option></select></div>
            <div class="comanda-field" data-comanda-add-method hidden><label>Forma</label><select name="metodo"><option value="CARTAO">Cartão</option><option value="DINHEIRO">Dinheiro</option><option value="PIX_EXTERNO">Pix direto</option></select></div>
            <div data-comanda-add-pix-choice hidden>${choices("add_pix", pendingPix, "MANTER")}</div>
            <button class="comanda-primary" type="submit">+ Adicionar ao pedido</button>
          </form></section>
          <section class="comanda-action-card"><h3>Registrar pagamento</h3><p>Receba parte ou todo o saldo por outro meio.</p><form class="comanda-form" data-comanda-payment-form>
            <div class="comanda-inline-fields"><div class="comanda-field"><label>Forma</label><select name="metodo"><option value="CARTAO">Cartão</option><option value="DINHEIRO">Dinheiro</option><option value="PIX_EXTERNO">Pix direto</option></select></div><div class="comanda-field"><label>Valor</label><input name="valor" inputmode="decimal" value="${(Number(order.saldo_centavos || 0) / 100).toFixed(2)}"></div></div>
            ${choices("payment_pix", pendingPix, "CANCELAR")}
            <button class="comanda-primary" type="submit" ${order.saldo_centavos <= 0 ? "disabled" : ""}>Registrar pagamento</button>
          </form></section>
          <section class="comanda-action-card"><h3>Gerar Pix</h3><p>Cria uma cobrança nova sem apagar cobranças anteriores.</p><form class="comanda-form" data-comanda-pix-form>
            <div class="comanda-field"><label>Valor da cobrança</label><input name="valor" inputmode="decimal" value="${(Number(order.saldo_centavos || 0) / 100).toFixed(2)}"></div>${choices("new_pix", pendingPix, "CANCELAR")}
            <button class="comanda-primary" type="submit" ${order.saldo_centavos <= 0 ? "disabled" : ""}>Gerar Pix</button>${pendingPix ? '<button class="comanda-danger" type="button" data-comanda-cancel-pix>Cancelar Pix pendente</button>' : ""}
          </form></section>
        </div>` : ""}
        ${pix ? `<div class="comanda-pix-box"><strong>Pix copia e cola</strong><div class="comanda-pix-code">${esc(pix)}</div><button class="comanda-secondary" type="button" data-comanda-copy-pix>Copiar código</button></div>` : ""}
        <section class="comanda-section"><header class="comanda-section-title"><div><strong>Pagamentos e cobranças</strong><span>Histórico preservado da comanda</span></div></header>${payments || '<div class="comanda-empty">Nenhum pagamento registrado.</div>'}</section>
      </div>
    </section>
  </div>`;
}

function radioValue(root, name) {
  return root.querySelector(`input[name="${name}"]:checked`)?.value || undefined;
}

async function openComanda(orderId) {
  document.querySelector("[data-comanda-dialog]")?.remove();
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let state;
  try {
    state = await loadState(orderId);
  } catch (error) {
    document.body.style.overflow = previousOverflow;
    window.alert(error?.message || "Não foi possível carregar a comanda.");
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup(state.order, state.products);
  const dialog = wrapper.firstElementChild;
  document.body.append(dialog);

  const close = () => {
    dialog.remove();
    document.body.style.overflow = previousOverflow;
  };
  dialog.querySelectorAll("[data-comanda-close]").forEach(button => button.addEventListener("click", close));

  const feedback = dialog.querySelector("[data-comanda-feedback]");
  const errorBox = dialog.querySelector("[data-comanda-error]");
  const show = (node, message) => { node.textContent = message; node.hidden = false; };
  const busy = value => dialog.querySelectorAll("button,input,select").forEach(control => { control.disabled = value; });
  const refresh = async message => { const next = await loadState(orderId); dialog.outerHTML = markup(next.order, next.products); close(); await openComanda(orderId); if (message) setTimeout(() => document.querySelector("[data-comanda-feedback]") && show(document.querySelector("[data-comanda-feedback]"), message), 0); };
  const run = async (task, message) => {
    feedback.hidden = true; errorBox.hidden = true; busy(true);
    try { await task(); window.dispatchEvent(new CustomEvent("rp-admin-data-changed", { detail: { pages: ["pedidos", "produtos", "dashboard"] } })); await refresh(message); }
    catch (error) { busy(false); show(errorBox, error?.message || "Não foi possível concluir a operação."); }
  };

  const addForm = dialog.querySelector("[data-comanda-add-form]");
  if (addForm) {
    const mode = addForm.elements.modo;
    const methodWrap = dialog.querySelector("[data-comanda-add-method]");
    const choiceWrap = dialog.querySelector("[data-comanda-add-pix-choice]");
    const syncMode = () => { methodWrap.hidden = mode.value !== "PAGO"; choiceWrap.hidden = mode.value === "PENDENTE"; };
    mode.addEventListener("change", syncMode); syncMode();
    addForm.addEventListener("submit", event => {
      event.preventDefault();
      const productId = Number(addForm.elements.produto_id.value); const quantity = Number(addForm.elements.quantidade.value); const selectedMode = mode.value;
      const product = state.products.find(item => Number(item.id) === productId);
      if (!product || !Number.isInteger(quantity) || quantity < 1) return show(errorBox, "Selecione um produto e uma quantidade válida.");
      const unit = Number(product.promocao_ativa && product.preco_promocional_centavos ? product.preco_promocional_centavos : product.preco_centavos); const subtotal = unit * quantity;
      const pixDecision = radioValue(dialog, "add_pix");
      run(async () => {
        await adminApi.addComandaItem(orderId, { produto_id: productId, quantidade: quantity });
        if (selectedMode === "PAGO") await adminApi.registerComandaPayment(orderId, { metodo: addForm.elements.metodo.value, valor_centavos: subtotal, ...(pixDecision ? { pix_pendente: pixDecision } : {}) });
        if (selectedMode === "PIX") await adminApi.generateComandaPix(orderId, { ...(pixDecision === "CANCELAR" ? {} : { valor_centavos: subtotal }), ...(pixDecision ? { pix_pendente: pixDecision } : {}) });
      }, selectedMode === "PENDENTE" ? "Item adicionado à comanda." : "Item adicionado e pagamento tratado.");
    });
  }

  dialog.querySelector("[data-comanda-payment-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const form = event.currentTarget; const value = cents(form.elements.valor.value); const decision = radioValue(dialog, "payment_pix");
    if (value <= 0) return show(errorBox, "Informe um valor válido.");
    run(() => adminApi.registerComandaPayment(orderId, { metodo: form.elements.metodo.value, valor_centavos: value, ...(decision ? { pix_pendente: decision } : {}) }), "Pagamento registrado.");
  });

  dialog.querySelector("[data-comanda-pix-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const form = event.currentTarget; const value = cents(form.elements.valor.value); const decision = radioValue(dialog, "new_pix");
    if (value <= 0) return show(errorBox, "Informe um valor válido.");
    run(() => adminApi.generateComandaPix(orderId, { valor_centavos: value, ...(decision ? { pix_pendente: decision } : {}) }), "Cobrança Pix gerada.");
  });

  dialog.querySelector("[data-comanda-cancel-pix]")?.addEventListener("click", () => run(() => adminApi.cancelComandaPix(orderId), "Cobrança Pix cancelada."));
  dialog.querySelector("[data-comanda-copy-pix]")?.addEventListener("click", async () => { const code = state.order.pagamentos?.find(payment => payment.metodo === "PIX_MP" && payment.status === "PENDENTE")?.mp_qr_code; if (code) { await navigator.clipboard.writeText(code); show(feedback, "Código Pix copiado."); } });
}

function enhanceOrders() {
  document.querySelectorAll(".orders-details-button").forEach(button => { button.textContent = "Abrir comanda"; });
}

const observer = new MutationObserver(enhanceOrders);
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
