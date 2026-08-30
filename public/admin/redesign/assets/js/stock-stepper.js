function clampStock(input, value) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100000);
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safeValue));
}

function syncStepper(stepper, input) {
  const value = clampStock(input, Number(input.value));
  const min = Number(input.min || 0);
  const max = Number(input.max || 100000);

  stepper.querySelector('[data-stock-step="-1"]')?.toggleAttribute("disabled", value <= min);
  stepper.querySelector('[data-stock-step="1"]')?.toggleAttribute("disabled", value >= max);
}

function enhanceStockInput(input) {
  if (!(input instanceof HTMLInputElement) || input.closest(".products-stepper")) return;

  const stepper = document.createElement("div");
  stepper.className = "products-stepper";
  stepper.setAttribute("data-stock-stepper", "");

  const decrease = document.createElement("button");
  decrease.className = "products-stepper__button";
  decrease.type = "button";
  decrease.dataset.stockStep = "-1";
  decrease.setAttribute("aria-label", "Diminuir estoque");
  decrease.textContent = "−";

  const increase = document.createElement("button");
  increase.className = "products-stepper__button";
  increase.type = "button";
  increase.dataset.stockStep = "1";
  increase.setAttribute("aria-label", "Aumentar estoque");
  increase.textContent = "+";

  input.parentNode?.insertBefore(stepper, input);
  stepper.append(decrease, input, increase);

  stepper.addEventListener("click", event => {
    const button = event.target.closest("[data-stock-step]");
    if (!(button instanceof HTMLButtonElement)) return;

    const step = Number(button.dataset.stockStep || 0);
    const current = Number(input.value);
    const next = clampStock(input, (Number.isFinite(current) ? current : 0) + step);

    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    syncStepper(stepper, input);
    input.focus();
  });

  input.addEventListener("input", () => syncStepper(stepper, input));
  input.addEventListener("blur", () => {
    input.value = String(clampStock(input, Number(input.value)));
    syncStepper(stepper, input);
  });

  syncStepper(stepper, input);
}

function enhanceStockSteppers(root = document) {
  root.querySelectorAll?.('[data-product-form] input[name="estoque"]').forEach(enhanceStockInput);
}

enhanceStockSteppers();

const observer = new MutationObserver(() => enhanceStockSteppers());
observer.observe(document.body, { childList: true, subtree: true });
