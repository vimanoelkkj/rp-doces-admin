function isProductDialogOpen(dialog) {
  return dialog instanceof HTMLElement && !dialog.hidden;
}

function syncVisualViewport(dialog) {
  if (!(dialog instanceof HTMLElement)) return;
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  const offsetTop = viewport?.offsetTop || 0;
  dialog.style.setProperty("--products-visual-height", `${Math.round(height)}px`);
  dialog.style.setProperty("--products-visual-offset-top", `${Math.round(offsetTop)}px`);
}

function scrollFocusedFieldIntoView(dialog) {
  if (!isProductDialogOpen(dialog)) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !dialog.contains(active)) return;

  requestAnimationFrame(() => {
    active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  });
}

function tuneAutofill(form) {
  if (!(form instanceof HTMLFormElement)) return;
  form.autocomplete = "off";

  form.querySelectorAll("input, textarea, select").forEach(field => {
    if (!(field instanceof HTMLElement)) return;
    field.setAttribute("autocomplete", "off");
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.setAttribute("autocorrect", "off");
      field.setAttribute("spellcheck", "false");
    }
  });
}

function bindDialog(dialog) {
  if (!(dialog instanceof HTMLElement) || dialog.dataset.mobileKeyboardBound === "true") return;
  dialog.dataset.mobileKeyboardBound = "true";

  const form = dialog.querySelector("[data-product-form]");
  tuneAutofill(form);

  const sync = () => {
    if (!isProductDialogOpen(dialog)) return;
    syncVisualViewport(dialog);
    scrollFocusedFieldIntoView(dialog);
  };

  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("orientationchange", sync);

  dialog.addEventListener("focusin", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement))
      return;
    syncVisualViewport(dialog);
    setTimeout(() => scrollFocusedFieldIntoView(dialog), 120);
    setTimeout(() => scrollFocusedFieldIntoView(dialog), 320);
  });

  const observer = new MutationObserver(() => {
    if (isProductDialogOpen(dialog)) {
      tuneAutofill(dialog.querySelector("[data-product-form]"));
      syncVisualViewport(dialog);
    }
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ["hidden"] });

  syncVisualViewport(dialog);
}

function scan() {
  document.querySelectorAll("[data-product-dialog]").forEach(bindDialog);
}

const observer = new MutationObserver(scan);
observer.observe(document.body, { childList: true, subtree: true });
scan();
