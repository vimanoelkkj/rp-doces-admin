let previous = null;
export function rememberFocus() {
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
export function restoreFocus() {
  if (previous?.isConnected) previous.focus();
  previous = null;
}
