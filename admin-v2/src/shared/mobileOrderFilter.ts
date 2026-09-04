const SELECT_SELECTOR = "select:not([multiple])";
const OVERLAY_ID = "rp-native-select-menu";

let activeSelect: HTMLSelectElement | null = null;
let repositionHandler: (() => void) | null = null;

function selectLabel(select: HTMLSelectElement): string {
  const ariaLabel = select.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  if (select.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(select.id)}"]`);
    const text = label?.textContent?.trim();
    if (text) return text;
  }

  const wrappingLabel = select.closest("label")?.textContent?.trim();
  return wrappingLabel || select.name || "Selecionar opção";
}

function closeMenu({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
  const previousSelect = activeSelect;
  document.getElementById(OVERLAY_ID)?.remove();
  activeSelect = null;

  if (repositionHandler) {
    window.removeEventListener("resize", repositionHandler);
    window.removeEventListener("scroll", repositionHandler, true);
    repositionHandler = null;
  }

  if (restoreFocus && previousSelect && document.body.contains(previousSelect)) {
    requestAnimationFrame(() => previousSelect.focus({ preventScroll: true }));
  }
}

function positionMenu(select: HTMLSelectElement, menu: HTMLElement): void {
  const rect = select.getBoundingClientRect();
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const gap = 8;
  const viewportPadding = mobile ? 12 : 10;
  const availableWidth = window.innerWidth - viewportPadding * 2;
  const requestedWidth = Math.max(rect.width, mobile ? 220 : 200);
  const width = Math.min(requestedWidth, availableWidth);
  const maxMenuHeight = Math.min(menu.scrollHeight, window.innerHeight * (mobile ? 0.58 : 0.5));
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
  const roomAbove = rect.top - viewportPadding;
  const placeAbove = roomBelow < Math.min(maxMenuHeight, 240) && roomAbove > roomBelow;

  menu.style.width = `${width}px`;
  menu.style.left = `${Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding)}px`;
  menu.style.maxHeight = `${Math.max(160, Math.min(maxMenuHeight, placeAbove ? roomAbove - gap : roomBelow - gap))}px`;

  if (placeAbove) {
    menu.style.top = "auto";
    menu.style.bottom = `${Math.max(viewportPadding, window.innerHeight - rect.top + gap)}px`;
  } else {
    menu.style.bottom = "auto";
    menu.style.top = `${Math.min(window.innerHeight - viewportPadding, rect.bottom + gap)}px`;
  }
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;

  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function openMenu(select: HTMLSelectElement): void {
  if (select.disabled) return;

  closeMenu();
  activeSelect = select;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "rp-mobile-filter-overlay";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "rp-mobile-filter-backdrop";
  dismiss.setAttribute("aria-label", "Fechar seletor");
  dismiss.addEventListener("click", () => closeMenu({ restoreFocus: true }));

  const menu = document.createElement("div");
  menu.className = "rp-mobile-filter-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", selectLabel(select));

  Array.from(select.options).forEach(option => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rp-mobile-filter-option";
    item.disabled = option.disabled;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", option.value === select.value ? "true" : "false");

    const label = document.createElement("span");
    label.textContent = option.textContent || option.label;

    const marker = document.createElement("span");
    marker.className = "rp-mobile-filter-radio";
    marker.setAttribute("aria-hidden", "true");

    item.append(label, marker);
    item.addEventListener("click", event => {
      event.stopPropagation();
      if (option.disabled) return;
      const changed = option.value !== select.value;
      if (changed) setSelectValue(select, option.value);
      closeMenu({ restoreFocus: true });
    });
    menu.appendChild(item);
  });

  overlay.append(dismiss, menu);
  document.body.appendChild(overlay);
  positionMenu(select, menu);

  repositionHandler = () => {
    if (!activeSelect || !document.body.contains(activeSelect)) {
      closeMenu();
      return;
    }
    positionMenu(activeSelect, menu);
  };

  window.addEventListener("resize", repositionHandler, { passive: true });
  window.addEventListener("scroll", repositionHandler, true);
}

function isEnhancedSelect(target: EventTarget | null): target is HTMLSelectElement {
  return target instanceof HTMLSelectElement && target.matches(SELECT_SELECTOR);
}

// Usamos click, e não pointerdown. Abrir o overlay durante pointerdown fazia o
// pointerup/click do mesmo toque cair no backdrop recém-criado e fechar o menu
// imediatamente em alguns Chromiums/Androids.
function onClick(event: MouseEvent): void {
  if (!isEnhancedSelect(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  openMenu(event.target);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeMenu({ restoreFocus: true });
    return;
  }

  if (!isEnhancedSelect(event.target)) return;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  event.stopPropagation();
  openMenu(event.target);
}

document.addEventListener("click", onClick, true);
document.addEventListener("keydown", onKeyDown, true);
window.addEventListener("pagehide", () => closeMenu());
