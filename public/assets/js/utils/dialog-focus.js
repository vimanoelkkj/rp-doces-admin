export const DIALOG_FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function firstDialogControl(root) {
  return root?.querySelector?.(DIALOG_FOCUSABLE) || null;
}
export function focusDialog(root) {
  const node = firstDialogControl(root);
  node?.focus?.();
  return node;
}
