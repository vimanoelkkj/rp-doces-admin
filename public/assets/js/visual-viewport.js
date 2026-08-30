const root = document.documentElement;

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;

  root.style.setProperty("--rp-visual-viewport-height", `${Math.round(height)}px`);
  root.style.setProperty("--rp-visual-viewport-offset-top", `${Math.round(offsetTop)}px`);
}

syncVisualViewport();
window.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });
