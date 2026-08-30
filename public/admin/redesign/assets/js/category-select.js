function enhanceCategorySelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.dataset.customCategory === "true") return;

  select.dataset.customCategory = "true";
  select.classList.add("category-select__native");

  const root = document.createElement("div");
  root.className = "category-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "category-select__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const label = document.createElement("span");
  label.className = "category-select__label";

  const chevron = document.createElement("span");
  chevron.className = "category-select__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<svg viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg>';

  const menu = document.createElement("div");
  menu.className = "category-select__menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  function close({ focus = false } = {}) {
    menu.hidden = true;
    root.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  }

  function open() {
    menu.hidden = false;
    root.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    const selected = menu.querySelector('[aria-selected="true"]');
    requestAnimationFrame(() => selected?.focus());
  }

  function sync() {
    const selectedOption = select.options[select.selectedIndex] || select.options[0];
    label.textContent = selectedOption?.textContent || "Selecione";

    menu.querySelectorAll("[data-category-value]").forEach(option => {
      const selected = option.dataset.categoryValue === select.value;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
  }

  [...select.options].forEach(option => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "category-select__option";
    item.setAttribute("role", "option");
    item.dataset.categoryValue = option.value;
    item.textContent = option.textContent;

    item.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      close({ focus: true });
    });

    item.addEventListener("keydown", event => {
      const items = [...menu.querySelectorAll(".category-select__option")];
      const index = items.indexOf(item);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close({ focus: true });
      } else if (event.key === "Tab") {
        close();
      }
    });

    menu.append(item);
  });

  trigger.append(label, chevron);
  root.append(trigger, menu);
  select.insertAdjacentElement("afterend", root);

  trigger.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });

  trigger.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) && menu.hidden) {
      event.preventDefault();
      open();
    } else if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      close();
    }
  });

  select.addEventListener("change", sync);

  document.addEventListener("pointerdown", event => {
    if (!menu.hidden && !root.contains(event.target)) close();
  });

  sync();
}

function enhanceAllCategorySelects(root = document) {
  root.querySelectorAll?.('select[name="categoria"]').forEach(enhanceCategorySelect);
}

enhanceAllCategorySelects();

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('select[name="categoria"]')) enhanceCategorySelect(node);
      enhanceAllCategorySelects(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
