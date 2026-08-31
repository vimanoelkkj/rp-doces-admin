const ENHANCED = "data-manual-select-enhanced";

function closeAll(except = null) {
  document.querySelectorAll(".manual-select.is-open").forEach(root => {
    if (root === except) return;
    root.classList.remove("is-open");
    root.querySelector(".manual-select__trigger")?.setAttribute("aria-expanded", "false");
    const menu = root.querySelector(".manual-select__menu");
    if (menu) menu.hidden = true;
  });
}

function optionLabel(option) {
  return option?.textContent?.trim() || "Selecionar";
}

function renderOptions(root, select) {
  const menu = root.querySelector(".manual-select__menu");
  const triggerLabel = root.querySelector(".manual-select__value");
  if (!menu || !triggerLabel) return;

  const selected = select.options[select.selectedIndex] || select.options[0];
  triggerLabel.textContent = optionLabel(selected);

  menu.innerHTML = [...select.options]
    .map((option, index) => {
      const isSelected = index === select.selectedIndex;
      return `
        <button
          class="manual-select__option${isSelected ? " is-selected" : ""}"
          type="button"
          role="option"
          data-manual-select-index="${index}"
          aria-selected="${isSelected}"
          ${option.disabled ? "disabled" : ""}
        >
          <span>${optionLabel(option)}</span>
          ${isSelected ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>' : ""}
        </button>`;
    })
    .join("");

  menu.querySelectorAll("[data-manual-select-index]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.manualSelectIndex);
      if (!Number.isInteger(index) || !select.options[index] || select.options[index].disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      renderOptions(root, select);
      closeAll();
      root.querySelector(".manual-select__trigger")?.focus();
    });
  });
}

function enhanceSelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.hasAttribute(ENHANCED)) return;
  select.setAttribute(ENHANCED, "true");

  const root = document.createElement("div");
  root.className = "manual-select";

  const trigger = document.createElement("button");
  trigger.className = "manual-select__trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.disabled = select.disabled;
  trigger.innerHTML = `
    <span class="manual-select__value"></span>
    <svg class="manual-select__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>`;

  const menu = document.createElement("div");
  menu.className = "manual-select__menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  select.parentNode.insertBefore(root, select);
  root.append(select, trigger, menu);
  select.classList.add("manual-select__native");

  renderOptions(root, select);

  trigger.addEventListener("click", event => {
    event.stopPropagation();
    if (trigger.disabled) return;
    const opening = !root.classList.contains("is-open");
    closeAll(opening ? root : null);
    root.classList.toggle("is-open", opening);
    trigger.setAttribute("aria-expanded", String(opening));
    menu.hidden = !opening;
  });

  trigger.addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (!root.classList.contains("is-open")) trigger.click();
    const options = [...menu.querySelectorAll(".manual-select__option:not(:disabled)")];
    const selectedIndex = options.findIndex(option => option.classList.contains("is-selected"));
    const target = event.key === "ArrowUp"
      ? options[Math.max(0, selectedIndex - 1)] || options.at(-1)
      : options[Math.min(options.length - 1, selectedIndex + 1)] || options[0];
    target?.focus();
  });

  select.addEventListener("change", () => renderOptions(root, select));
}

function enhanceWithin(root = document) {
  root.querySelectorAll?.(".manual-order-form select").forEach(enhanceSelect);
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (!(node instanceof Element)) return;
      if (node.matches?.(".manual-order-form select")) enhanceSelect(node);
      enhanceWithin(node);
    });
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceWithin();

document.addEventListener("click", event => {
  if (!event.target.closest(".manual-select")) closeAll();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAll();
});
