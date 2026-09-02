import "./comanda-cache.js";

function moneyFromCents(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function parseMoney(text) {
  const raw = String(text || "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;

  let normalized = raw;
  if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(".")) {
    const parts = raw.split(".");
    const decimalPart = parts.at(-1) || "";
    normalized = parts.length === 2 && decimalPart.length <= 2 ? raw : raw.replace(/\./g, "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function readPendingCents(group) {
  const strong = group.querySelector(":scope > strong");
  const match = strong?.textContent?.match(/R\$\s*[\d.,]+/);
  return match ? parseMoney(match[0]) : 0;
}

function readRemainingCents(dialog) {
  const cards = dialog.querySelectorAll(".comanda-summary article");
  return cards[2] ? parseMoney(cards[2].textContent) : 0;
}

function readFormValue(form) {
  const input = form?.querySelector('input[name="valor"]');
  return input ? parseMoney(input.value) : 0;
}

function selectedMethod(form) {
  const select = form?.querySelector('select[name="metodo"]');
  const option = select?.selectedOptions?.[0];
  return option?.textContent?.trim() || "Pagamento";
}

function contextFor(group) {
  if (group.closest("[data-comanda-payment-form]")) return "payment";
  if (group.closest("[data-comanda-pix-form]")) return "pix";
  if (group.closest("[data-comanda-add-form]")) return "add";
  return "generic";
}

function optionCopy(context, action) {
  if (context === "payment") {
    return action === "CANCELAR"
      ? { title: "Cancelar Pix", description: "Usar este pagamento no lugar." }
      : { title: "Manter Pix", description: "Registrar este pagamento separado." };
  }

  if (context === "pix") {
    return action === "CANCELAR"
      ? { title: "Substituir Pix", description: "Cancelar o atual e gerar outro." }
      : { title: "Criar outro Pix", description: "Manter o atual e gerar mais um." };
  }

  if (context === "add") {
    return action === "CANCELAR"
      ? { title: "Cancelar Pix", description: "Cancelar antes de tratar o novo item." }
      : { title: "Manter Pix", description: "Tratar o novo item separado." };
  }

  return action === "CANCELAR"
    ? { title: "Cancelar Pix", description: "Cancelar antes de continuar." }
    : { title: "Manter Pix", description: "Continuar com a cobrança ativa." };
}

function buildOutcome(group) {
  let outcome = group.querySelector("[data-comanda-ux-outcome]");
  if (!outcome) {
    outcome = document.createElement("div");
    outcome.className = "comanda-ux-outcome";
    outcome.dataset.comandaUxOutcome = "";
    group.append(outcome);
  }
  return outcome;
}

function updateOutcome(group) {
  const dialog = group.closest("[data-comanda-dialog]");
  if (!dialog) return;

  const context = contextFor(group);
  const selected = group.querySelector('input[type="radio"]:checked')?.value || "CANCELAR";
  const pending = Number(group.dataset.pendingCents || 0);
  const remaining = readRemainingCents(dialog);
  const form = group.closest("form");
  const value = readFormValue(form);
  const outcome = buildOutcome(group);

  if (context === "payment") {
    const method = selectedMethod(form);
    if (selected === "CANCELAR") {
      outcome.innerHTML = `<strong>Pix ${moneyFromCents(pending)} cancelado → ${method} ${moneyFromCents(value)} pago → saldo ${moneyFromCents(Math.max(0, remaining - value))}</strong>`;
    } else {
      const freeAfter = Math.max(0, remaining - pending - value);
      outcome.innerHTML = `<strong>Pix ${moneyFromCents(pending)} mantido → ${method} ${moneyFromCents(value)} pago → livre ${moneyFromCents(freeAfter)}</strong>`;
    }
    return;
  }

  if (context === "pix") {
    if (selected === "CANCELAR") {
      outcome.innerHTML = `<strong>Pix ${moneyFromCents(pending)} cancelado → novo Pix ${moneyFromCents(value)} → livre ${moneyFromCents(Math.max(0, remaining - value))}</strong>`;
    } else {
      const freeAfter = Math.max(0, remaining - pending - value);
      outcome.innerHTML = `<strong>Pix ${moneyFromCents(pending)} mantido → novo Pix ${moneyFromCents(value)} → livre ${moneyFromCents(freeAfter)}</strong>`;
    }
    return;
  }

  outcome.innerHTML = selected === "CANCELAR"
    ? `<strong>Pix ${moneyFromCents(pending)} será cancelado.</strong>`
    : `<strong>Pix ${moneyFromCents(pending)} será mantido.</strong>`;
}

function enhanceChoiceGroup(group) {
  if (group.dataset.comandaUxEnhanced === "1") return;
  const radios = [...group.querySelectorAll('input[type="radio"]')];
  if (radios.length < 2) return;

  group.dataset.comandaUxEnhanced = "1";
  group.classList.add("comanda-ux-choice-group");

  const pending = readPendingCents(group);
  group.dataset.pendingCents = String(pending);
  const context = contextFor(group);
  const heading = group.querySelector(":scope > strong");
  if (heading) heading.textContent = `Já existe um Pix de ${moneyFromCents(pending)}`;

  radios.forEach(radio => {
    const label = radio.closest("label");
    if (!label) return;
    label.classList.add("comanda-ux-option");
    const span = label.querySelector("span");
    const copy = optionCopy(context, radio.value);
    if (span) span.innerHTML = `<strong>${copy.title}</strong><small>${copy.description}</small>`;
    radio.addEventListener("change", () => updateOutcome(group));
  });

  const form = group.closest("form");
  form?.querySelectorAll('input[name="valor"], select[name="metodo"], select[name="modo"]').forEach(control => {
    control.addEventListener("input", () => updateOutcome(group));
    control.addEventListener("change", () => updateOutcome(group));
  });

  updateOutcome(group);
}

function enhanceDialog(dialog) {
  dialog.querySelectorAll(".comanda-choice-group").forEach(enhanceChoiceGroup);
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("[data-comanda-dialog]")) enhanceDialog(node);
      node.querySelectorAll?.("[data-comanda-dialog]").forEach(enhanceDialog);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll("[data-comanda-dialog]").forEach(enhanceDialog);

const CLOSE_ANIMATION_MS = 200;

document.addEventListener("click", event => {
  const closeButton = event.target.closest?.("[data-comanda-close]");
  if (!closeButton) return;

  const dialog = closeButton.closest("[data-comanda-dialog]");
  if (!dialog || closeButton.dataset.drawerClosePass === "1") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (dialog.classList.contains("is-closing")) return;

  dialog.classList.add("is-closing");
  dialog.setAttribute("aria-busy", "true");
  dialog.querySelectorAll("button,input,select").forEach(control => {
    control.disabled = true;
  });

  window.setTimeout(() => {
    if (!dialog.isConnected) return;
    closeButton.dataset.drawerClosePass = "1";
    closeButton.click();
    delete closeButton.dataset.drawerClosePass;
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CLOSE_ANIMATION_MS);
}, true);
