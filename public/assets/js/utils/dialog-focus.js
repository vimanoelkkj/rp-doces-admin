import { FOCUSABLE_SELECTOR } from "./focus.js";
export const DIALOG_FOCUSABLE = FOCUSABLE_SELECTOR;
export function firstDialogControl(root) {
  return root?.querySelector?.(DIALOG_FOCUSABLE) || null;
}
export function focusDialog(root) {
  const node = firstDialogControl(root);
  node?.focus?.();
  return node;
}
