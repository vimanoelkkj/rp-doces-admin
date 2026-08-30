const PREVIEW_CANCEL_DELAY_MS = 800;
let cancelPending = false;

function paymentSheet() {
  return document.querySelector("[data-payment-root] .rp-payment__sheet");
}

function setPreviewCancelPending(button) {
  cancelPending = true;
  const sheet = paymentSheet();
  if (sheet) sheet.inert = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="rp-payment__cancel-progress"><span class="rp-payment__cancel-spinner" aria-hidden="true"></span>Cancelando…</span>`;
}

function clearPreviewCancelPending() {
  cancelPending = false;
  const sheet = paymentSheet();
  if (sheet) sheet.inert = false;
}

document.addEventListener(
  "click",
  event => {
    const button = event.target.closest?.("[data-confirm-cancel-order]");
    if (!button || button.dataset.previewCancelReplay === "true") {
      if (button) delete button.dataset.previewCancelReplay;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    setPreviewCancelPending(button);

    window.setTimeout(() => {
      if (!button.isConnected) {
        clearPreviewCancelPending();
        return;
      }
      clearPreviewCancelPending();
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.dataset.previewCancelReplay = "true";
      button.click();
    }, PREVIEW_CANCEL_DELAY_MS);
  },
  true
);

document.addEventListener(
  "keydown",
  event => {
    if (!cancelPending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);
