import { FOCUSABLE_SELECTOR } from "./focus.js";
export function trapTabKey(event, root) {
  if (event.key !== "Tab" || !root) return;
  const nodes = [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(node => !node.hidden);
  if (!nodes.length) return;
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
