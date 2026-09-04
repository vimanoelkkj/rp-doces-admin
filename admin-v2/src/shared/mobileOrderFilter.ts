const MOBILE_QUERY = "(max-width: 760px)";
const FILTER_SELECTOR = 'select[aria-label="Filtrar pedidos"]';
const OVERLAY_ID = "rp-mobile-order-filter";

let activeSelect: HTMLSelectElement | null = null;
let resizeHandler: (() => void) | null = null;

function closeMenu(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  activeSelect = null;
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    window.removeEventListener("scroll", resizeHandler, true);
    resizeHandler = null;
  }
}

function positionMenu(select: HTMLSelectElement, menu: HTMLElement): void {
  const rect = select.getBoundingClientRect();
  const gap = 8;
  const viewportPadding = 12;
  const menuHeight = Math.min(menu.scrollHeight, window.innerHeight * 0.62);
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
  const roomAbove = rect.top - viewportPadding;
  const placeAbove = roomBelow < menuHeight && roomAbove > roomBelow;

  menu.style.left = `${Math.max(viewportPadding, rect.left)}px`;
  menu.style.width = `${Math.min(rect.width, window.innerWidth - viewportPadding * 2)}px`;
  menu.style.maxHeight = `${Math.max(180, placeAbove ? roomAbove - gap : roomBelow - gap)}px`;

  if (placeAbove) {
    menu.style.top = "auto";
    menu.style.bottom = `${Math.max(viewportPadding, window.innerHeight - rect.top + gap)}px`;
  } else {
    menu.style.bottom = "auto";
    menu.style.top = `${Math.min(window.innerHeight - viewportPadding, rect.bottom + gap)}px`;
  }
}

function setNativeSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function openMenu(select: HTMLSelectElement): void {
  if (!window.matchMedia(MOBILE_QUERY).matches) return;
  closeMenu();
  activeSelect = select;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "rp-mobile-filter-overlay";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "rp-mobile-filter-backdrop";
  dismiss.setAttribute("aria-label", "Fechar filtros");
  dismiss.addEventListener("click", closeMenu);

  const menu = document.createElement("div");
  menu.className = "rp-mobile-filter-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Filtrar pedidos");

  Array.from(select.options).forEach(option => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rp-mobile-filter-option";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", option.value === select.value ? "true" : "false");

    const label = document.createElement("span");
    label.textContent = option.textContent || option.label;

    const marker = document.createElement("span");
    marker.className = "rp-mobile-filter-radio";
    marker.setAttribute("aria-hidden", "true");

    item.append(label, marker);
    item.addEventListener("click", () => {
      setNativeSelectValue(select, option.value);
      closeMenu();
      select.focus({ preventScroll: true });
    });
    menu.appendChild(item);
  });

  overlay.append(dismiss, menu);
  document.body.appendChild(overlay);
  positionMenu(select, menu);

  resizeHandler = () => {
    if (!activeSelect || !document.body.contains(activeSelect)) {
      closeMenu();
      return;
    }
    positionMenu(activeSelect, menu);
  };
  window.addEventListener("resize", resizeHandler, { passive: true });
  window.addEventListener("scroll", resizeHandler, true);
}

function onPointerDown(event: PointerEvent): void {
  if (!window.matchMedia(MOBILE_QUERY).matches) return;
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.matches(FILTER_SELECTOR)) return;
  event.preventDefault();
  event.stopPropagation();
  openMenu(target);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeMenu();
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || !target.matches(FILTER_SELECTOR)) return;
  if (!window.matchMedia(MOBILE_QUERY).matches) return;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
  event.preventDefault();
  openMenu(target);
}

document.addEventListener("pointerdown", onPointerDown, true);
document.addEventListener("keydown", onKeyDown, true);
window.addEventListener("pagehide", closeMenu);
