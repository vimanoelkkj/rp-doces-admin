const REFUND_SYNC_MS = 3_000;
const pendingEnhancements = new WeakMap();

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateTime(value) {
  if (!value) return "—";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? text
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function installStyles() {
  if (document.getElementById("rp-comanda-refunds-style")) return;
  const style = document.createElement("style");
  style.id = "rp-comanda-refunds-style";
  style.textContent = `
    .comanda-refund-open{margin-top:5px;border:0;background:transparent;padding:0;color:var(--danger,#a8464e);font:inherit;font-size:10.5px;font-weight:900;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
    .comanda-refund-form{grid-column:1/-1;margin:-4px 12px 10px;padding:12px;border:1px solid #ecd5d5;border-radius:12px;background:#fff8f8;display:grid;gap:10px}
    .comanda-refund-form>strong{font-size:12.5px;color:#7d3038}.comanda-refund-form>small{color:var(--ink-3);font-size:10.5px;line-height:1.35}
    .comanda-refund-form label{display:grid;gap:5px;color:var(--ink-2);font-size:10.5px;font-weight:800}.comanda-refund-form textarea,.comanda-refund-form select{width:100%;min-height:38px;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;padding:8px 9px}.comanda-refund-form textarea{resize:vertical;min-height:58px}
    .comanda-refund-stock{display:flex!important;grid-template-columns:none!important;align-items:flex-start;gap:8px!important}.comanda-refund-stock input{margin-top:2px;accent-color:var(--rose)}.comanda-refund-stock span{display:grid;gap:1px}.comanda-refund-stock small{font-weight:600;color:var(--ink-3)}
    .comanda-refund-actions{display:flex;justify-content:flex-end;gap:7px}.comanda-refund-actions button{min-height:34px;border-radius:9px;padding:7px 11px;font:inherit;font-size:10.5px;font-weight:900;cursor:pointer}.comanda-refund-cancel{border:1px solid var(--line-strong);background:var(--surface);color:var(--ink-2)}.comanda-refund-confirm{border:0;background:#a8464e;color:#fff}.comanda-refund-confirm:disabled{opacity:.55;cursor:not-allowed}
    .comanda-line.is-refund{background:#fff8f8}.comanda-line.is-refund .comanda-line-value{color:#a8464e}.comanda-refund-source{color:#7d3038!important}.comanda-refund-pending{color:#856210!important}
    @media(max-width:720px){.comanda-refund-form{margin-inline:8px}.comanda-refund-actions{display:grid;grid-template-columns:1fr 1fr}.comanda-refund-actions button{width:100%}}
  `;
  document.head.appendChild(style);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = (response.headers.get("content-type") || "").includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    const error = new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { payload, status: response.status };
}

async function loadRefundState(orderId, { sync = true } = {}) {
  const refundsUrl = `/api/admin/orders/${encodeURIComponent(orderId)}/refunds${sync ? "?sync=1" : ""}`;
  const refunds = await jsonFetch(refundsUrl);
  const finance = await jsonFetch(`/api/admin/orders/${encodeURIComponent(orderId)}/finance?fresh=1`);
  return {
    order: finance.payload?.pedido || null,
    refunds: refunds.payload?.reembolsos || []
  };
}

function feedback(dialog, text, error = false) {
  const target = dialog.querySelector(error ? "[data-comanda-error]" : "[data-comanda-feedback]");
  if (!target) return;
  target.hidden = !text;
  target.textContent = text || "";
  if (text) target.scrollIntoView({ block: "nearest" });
}

function updateBalance(dialog, order) {
  const total = Number(order?.valor_total_centavos || 0);
  const paid = Number(order?.valor_pago_centavos || 0);
  const saldo = Number(order?.saldo_centavos || 0);
  const amount = dialog.querySelector(".comanda-balance-row>div>strong");
  if (amount) {
    amount.textContent = money(saldo);
    amount.classList.toggle("is-settled", saldo <= 0);
  }
  const summary = dialog.querySelector(".comanda-balance-row>p");
  if (summary) summary.innerHTML = `Total <b>${money(total)}</b> · Pago <b>${money(paid)}</b>`;
  const progress = dialog.querySelector(".comanda-progress>i");
  if (progress) progress.style.width = `${total > 0 ? Math.min(100, Math.max(0, paid / total * 100)) : 0}%`;

  const input = dialog.querySelector("[data-comanda-receive-value]");
  if (input) input.value = (saldo / 100).toFixed(2).replace(".", ",");
}

function refundHistoryRow(refund) {
  const confirmed = refund.status === "REEMBOLSADO";
  const source = refund.origem === "MERCADO_PAGO"
    ? (confirmed ? "Confirmado pelo Mercado Pago" : "Aguardando confirmação do Mercado Pago")
    : `Registrado manualmente${refund.registrado_por_nome ? ` por ${refund.registrado_por_nome}` : ""}`;
  return `<div class="comanda-line is-refund" data-refund-history-id="${Number(refund.id)}">
    <div class="comanda-line-name"><strong>Reembolso</strong><small class="${confirmed ? "comanda-refund-source" : "comanda-refund-pending"}">${esc(source)} · ${esc(dateTime(refund.concluido_em || refund.criado_em))}</small>${refund.motivo ? `<small>${esc(refund.motivo)}</small>` : ""}${refund.mp_refund_id ? `<small>ID MP: ${esc(refund.mp_refund_id)}</small>` : ""}</div>
    <span class="comanda-state ${confirmed ? "comanda-status-cancelled" : "comanda-status-pending"}">${confirmed ? "REEMBOLSADO" : esc(refund.status)}</span>
    <strong class="comanda-line-value">−${money(refund.valor_centavos)}</strong>
  </div>`;
}

function closeRefundForms(dialog, except = null) {
  dialog.querySelectorAll("[data-refund-form]").forEach(form => {
    if (form !== except) form.remove();
  });
}

function buildRefundForm(dialog, order, payment) {
  closeRefundForms(dialog);
  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);
  const paidPayments = (order.pagamentos || []).filter(item => item.status === "PAGO");
  const canReturnStock = paidPayments.length === 1;
  const defaultReturnStock = canReturnStock && String(order.status_pedido || "").toUpperCase() !== "ENTREGUE";
  const form = document.createElement("div");
  form.className = "comanda-refund-form";
  form.dataset.refundForm = String(Number(payment.id));
  form.innerHTML = `
    <strong>Reembolsar ${money(payment.valor_centavos)}${automatic ? " pelo Mercado Pago" : ""}</strong>
    <small>${automatic ? "O sistema só concluirá quando o Mercado Pago confirmar o reembolso." : "Use esta opção somente depois de devolver o dinheiro ao cliente. O sistema registrará a confirmação como manual."}</small>
    ${automatic ? "" : `<label>Como o valor foi devolvido<select data-refund-method><option value="PIX_EXTERNO">Pix direto</option><option value="DINHEIRO">Dinheiro</option><option value="CARTAO">Cartão</option><option value="OUTRO">Outro</option></select></label>`}
    <label>Motivo <textarea data-refund-reason maxlength="300" placeholder="Ex.: cliente desistiu do pedido"></textarea></label>
    <label class="comanda-refund-stock"><input type="checkbox" data-refund-stock ${defaultReturnStock ? "checked" : ""} ${canReturnStock ? "" : "disabled"}><span>Devolver itens ao estoque<small>${canReturnStock ? (String(order.status_pedido || "").toUpperCase() === "ENTREGUE" ? "Desmarcado porque o pedido já foi entregue." : "Use quando os produtos não foram entregues e podem voltar à venda.") : "Disponível apenas ao reembolsar o último pagamento confirmado."}</small></span></label>
    <div class="comanda-refund-actions"><button type="button" class="comanda-refund-cancel" data-refund-cancel>Voltar</button><button type="button" class="comanda-refund-confirm" data-refund-confirm>Confirmar reembolso</button></div>`;

  form.querySelector("[data-refund-cancel]")?.addEventListener("click", () => form.remove());
  form.querySelector("[data-refund-confirm]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    feedback(dialog, "", true);
    feedback(dialog, automatic ? "Solicitando reembolso ao Mercado Pago…" : "Registrando reembolso manual…");
    try {
      const result = await jsonFetch(`/api/admin/orders/${encodeURIComponent(order.id)}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pagamento_id: Number(payment.id),
          origem: automatic ? "MERCADO_PAGO" : "MANUAL",
          metodo: automatic ? "PIX_MP" : form.querySelector("[data-refund-method]")?.value,
          motivo: form.querySelector("[data-refund-reason]")?.value || "",
          devolver_estoque: Boolean(form.querySelector("[data-refund-stock]")?.checked)
        })
      });

      window.dispatchEvent(new CustomEvent("rp-admin-data-changed", { detail: { pages: ["pedidos", "produtos", "dashboard"] } }));
      if (result.status === 202 || result.payload?.pendente) {
        feedback(dialog, "Reembolso solicitado. Aguardando confirmação do Mercado Pago.");
        form.remove();
        window.setTimeout(() => scheduleEnhance(dialog, true), REFUND_SYNC_MS);
      } else {
        feedback(dialog, result.payload?.confirmado_por === "MERCADO_PAGO"
          ? "Reembolso confirmado pelo Mercado Pago."
          : "Reembolso manual registrado.");
        form.remove();
        await enhanceDialog(dialog, true);
      }
    } catch (error) {
      feedback(dialog, error?.message || "Não foi possível reembolsar.", true);
      feedback(dialog, "");
      button.disabled = false;
    }
  });
  return form;
}

function renderState(dialog, state) {
  if (!state.order) return;
  updateBalance(dialog, state.order);
  const history = dialog.querySelector(".comanda-history");
  const body = history?.querySelector(":scope > div");
  if (!history || !body) return;

  body.querySelectorAll(".comanda-line.is-refund").forEach(row => row.remove());
  const rows = [...body.querySelectorAll(":scope > .comanda-line:not(.is-refund)")];
  const refundedByPayment = new Map(
    state.refunds
      .filter(refund => refund.status === "REEMBOLSADO")
      .map(refund => [Number(refund.pagamento_id), refund])
  );

  (state.order.pagamentos || []).forEach((payment, index) => {
    const row = rows[index];
    if (!row) return;
    row.dataset.refundPaymentId = String(Number(payment.id || 0));
    const badge = row.querySelector(".comanda-state");
    if (badge) {
      badge.textContent = payment.status;
      badge.classList.toggle("comanda-status-paid", payment.status === "PAGO");
      badge.classList.toggle("comanda-status-cancelled", ["REEMBOLSADO", "CANCELADO", "EXPIRADO", "FALHOU"].includes(payment.status));
    }

    row.querySelector("[data-refund-open]")?.remove();
    if (payment.status === "PAGO" && payment.id && !refundedByPayment.has(Number(payment.id))) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "comanda-refund-open";
      button.dataset.refundOpen = String(Number(payment.id));
      button.textContent = "Reembolsar";
      button.addEventListener("click", () => {
        const form = buildRefundForm(dialog, state.order, payment);
        row.after(form);
      });
      row.querySelector(".comanda-line-name")?.append(button);
    }
  });

  state.refunds.forEach(refund => body.insertAdjacentHTML("beforeend", refundHistoryRow(refund)));
  const count = history.querySelector("summary>span:last-child");
  if (count) {
    const total = (state.order.pagamentos || []).length + state.refunds.length;
    count.textContent = `${total} ${total === 1 ? "registro" : "registros"}`;
  }
}

async function enhanceDialog(dialog, force = false) {
  if (!dialog?.isConnected) return;
  const orderId = Number(dialog.dataset.orderId || 0);
  if (!orderId) return;
  if (!force && pendingEnhancements.has(dialog)) return pendingEnhancements.get(dialog);

  const task = loadRefundState(orderId, { sync: true })
    .then(state => {
      if (dialog.isConnected) renderState(dialog, state);
    })
    .catch(error => {
      if (error?.status !== 404 && error?.status !== 500) console.warn("R&P Admin: falha ao carregar reembolsos.", error);
    })
    .finally(() => pendingEnhancements.delete(dialog));
  pendingEnhancements.set(dialog, task);
  return task;
}

function scheduleEnhance(dialog, force = false) {
  if (!dialog?.isConnected) return;
  window.setTimeout(() => enhanceDialog(dialog, force), 80);
}

installStyles();
document.querySelectorAll("[data-comanda-dialog]").forEach(dialog => scheduleEnhance(dialog));

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("[data-comanda-dialog]")) scheduleEnhance(node, true);
      node.querySelectorAll?.("[data-comanda-dialog]").forEach(dialog => scheduleEnhance(dialog, true));
      const owner = node.closest?.("[data-comanda-dialog]");
      if (owner && (node.matches?.(".comanda-line") || node.querySelector?.(".comanda-line"))) scheduleEnhance(owner);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
