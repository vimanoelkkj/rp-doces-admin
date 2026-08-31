import { adminApi } from "./api.js";

const LABEL_TO_STATUS = {
  "Aguardando pagamento": "PENDENTE",
  "Pagamento confirmado": "PAGO",
  "Pagamento cancelado": "CANCELADO"
};

const STATUS_LABELS = {
  PENDENTE: "Pendente",
  PAGO: "Pago",
  CANCELADO: "Cancelado"
};

function getOrderId(dialog) {
  const text = dialog.querySelector(".orders-dialog__head span")?.textContent || "";
  const match = text.match(/Pedido\s+#(\d+)/i);
  return match ? Number(match[1]) : null;
}

function getPaymentStatus(dialog) {
  const badges = [...dialog.querySelectorAll(".orders-dialog__status .orders-status")];
  for (const badge of badges) {
    const status = LABEL_TO_STATUS[(badge.textContent || "").trim()];
    if (status) return status;
  }
  return "PENDENTE";
}

function renderControl(dialog) {
  if (!(dialog instanceof Element) || dialog.dataset.manualPaymentEnhanced === "true") return;
  const manual = [...dialog.querySelectorAll(".orders-status")].some(
    badge => (badge.textContent || "").trim() === "Pedido manual"
  );
  if (!manual) return;

  const orderId = getOrderId(dialog);
  if (!orderId) return;

  dialog.dataset.manualPaymentEnhanced = "true";
  const current = getPaymentStatus(dialog);
  dialog.querySelector(".manual-payment-actions")?.remove();

  const section = document.createElement("div");
  section.className = "manual-payment-state";
  section.innerHTML = `
    <div class="manual-payment-state__head">
      <div>
        <span>Situação do pagamento</span>
        <strong>Alterar status manual</strong>
      </div>
      <small>O estoque é ajustado automaticamente.</small>
    </div>
    <div class="manual-payment-state__options" role="group" aria-label="Situação do pagamento">
      ${Object.entries(STATUS_LABELS)
        .map(
          ([status, label]) => `
            <button
              type="button"
              class="manual-payment-state__option${status === current ? " is-active" : ""}"
              data-manual-payment-state="${status}"
              aria-pressed="${status === current}"
            >${label}</button>`
        )
        .join("")}
    </div>
    <div class="manual-payment-state__feedback" hidden></div>`;

  const note = dialog.querySelector(".orders-dialog__note");
  if (note) note.before(section);
  else dialog.querySelector(".orders-dialog__panel")?.append(section);

  const feedback = section.querySelector(".manual-payment-state__feedback");
  const buttons = [...section.querySelectorAll("[data-manual-payment-state]")];

  buttons.forEach(button => {
    button.addEventListener("click", async () => {
      const next = button.dataset.manualPaymentState;
      if (!next || next === getPaymentStatus(dialog)) return;

      buttons.forEach(item => (item.disabled = true));
      if (feedback) feedback.hidden = true;

      try {
        await adminApi.updateManualPayment(orderId, next);
        dialog.querySelector("[data-orders-dialog-close]")?.click();
        document.querySelector("[data-orders-refresh]")?.click();
      } catch (error) {
        if (feedback) {
          feedback.hidden = false;
          feedback.textContent = error?.message || "Não foi possível atualizar o pagamento.";
        }
        buttons.forEach(item => (item.disabled = false));
      }
    });
  });
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (!(node instanceof Element)) return;
      if (node.matches?.("[data-orders-dialog]")) renderControl(node);
      node.querySelectorAll?.("[data-orders-dialog]").forEach(renderControl);
    });
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll("[data-orders-dialog]").forEach(renderControl);
