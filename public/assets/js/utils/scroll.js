import { scrollBehavior } from "./reduced-motion.js";
export function scrollToSection(id) {
  const node = document.getElementById(String(id || ""));
  if (!node) return false;
  node.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  return true;
}
