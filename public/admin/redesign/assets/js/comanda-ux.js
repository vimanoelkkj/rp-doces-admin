function moneyFromCents(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function parseMoney(text) {
  const normalized = String(text || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
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
  return option?.textContent?.trim() || "pagamento";
}

function contextFor(group) {
  if (group.closest("[data-comanda-payment-form]")) return "payment";
  if (group.closest("[data-comanda-pix-form]")) return "pix";
  if (group.closest("[data-comanda-add-form]")) return "add";
  return "generic";
}

function optionCopy(context, action, pending) {
  const value = moneyFromCents(pending);

  if (context === "payment") {
    return action === "CANCELAR"
      ? {
          title: "Cancelar o Pix e usar este pagamento",
          description: `O Pix de ${value} será cancelado. O pagamento abaixo entra no histórico normalmente.`
        }
      : {
          title: "Manter o Pix e registrar à parte",
          description: `O Pix de ${value} continua válido. Este pagamento será separado e só poderá usar o saldo ainda livre.`
        };
  }

  if (context === "pix") {
    return action === "CANCELAR"
      ? {
          title: "Substituir o Pix atual",
          description: `Cancela o Pix de ${value} e gera uma nova cobrança com o valor informado abaixo.`
        }
      : {
          title: "Manter o Pix e criar outro",
          description: `O Pix de ${value} continua válido. A nova cobrança será adicional e limitada ao saldo livre.`
        };
  }

  if (context === "add") {
    return action === "CANCELAR"
      ? {
          title: "Cancelar o Pix atual",
          description: `Cancela o Pix de ${value} antes de tratar o pagamento deste novo item.`
        }
      : {
          title: "Manter o Pix atual",
          description: `O Pix de ${value} continua válido. O novo item será tratado separadamente.`
        };
  }

  return action === "CANCELAR"
    ? { title: "Cancelar o Pix atual", description: `Cancela a cobrança de ${value} antes de continuar.` }
    : { title: "Manter o Pix atual", description: `Mantém a cobrança de ${value} ativa.` };
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
      outcome.innerHTML = `<span>Depois desta ação</span><strong>Pix atual cancelado · ${method} ${moneyFromCents(value)} registrado</strong><small>Saldo após o pagamento: ${moneyFromCents(Math.max(0, remaining - value))}</small>`;
    } else {
      const freeAfter = Math.max(0, remaining - pending - value);
      outcome.innerHTML = `<span>Depois desta ação</span><strong>Pix ${moneyFromCents(pending)} continua pendente · ${method} ${moneyFromCents(value)} registrado</strong><small>Saldo ainda sem pagamento ou cobrança: ${moneyFromCents(freeAfter)}</small>`;
    }
    return;
  }

  if (context === "pix") {
    if (selected === "CANCELAR") {
      outcome.innerHTML = `<span>Depois desta ação</span><strong>Pix atual cancelado · novo Pix de ${moneyFromCents(value)}</strong><small>Saldo livre para outra cobrança: ${moneyFromCents(Math.max(0, remaining - value))}</small>`;
    } else {
      const freeAfter = Math.max(0, remaining - pending - value);
      outcome.innerHTML = `<span>Depois desta ação</span><strong>Pix ${moneyFromCents(pending)} mantido · novo Pix de ${moneyFromCents(value)}</strong><small>Saldo livre para outra cobrança: ${moneyFromCents(freeAfter)}</small>`;
    }
    return;
  }

  outcome.innerHTML = selected === "CANCELAR"
    ? `<span>O que vai acontecer</span><strong>O Pix de ${moneyFromCents(pending)} será cancelado antes de tratar o novo item.</strong>`
    : `<span>O que vai acontecer</span><strong>O Pix de ${moneyFromCents(pending)} continua ativo e o novo item será tratado separadamente.</strong>`;
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
  if (heading) heading.textContent = `Já existe um Pix de ${moneyFromCents(pending)} pendente`;

  radios.forEach(radio => {
    const label = radio.closest("label");
    if (!label) return;
    label.classList.add("comanda-ux-option");
    const span = label.querySelector("span");
    const copy = optionCopy(context, radio.value, pending);
    if (span) {
      span.innerHTML = `<strong>${copy.title}</strong><small>${copy.description}</small>`;
    }
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
