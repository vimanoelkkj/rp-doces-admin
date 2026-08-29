const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusFirst(container) {
  container?.querySelector(FOCUSABLE)?.focus();
}

export function restoreFocus(element) {
  if (element instanceof HTMLElement && element.isConnected) element.focus();
}
