let region;

function liveRegion() {
  if (region?.isConnected) return region;
  region = document.createElement("div");
  region.className = "rp-sr-only";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  document.body.appendChild(region);
  return region;
}

export function announce(message) {
  const target = liveRegion();
  target.textContent = "";
  requestAnimationFrame(() => {
    target.textContent = String(message || "");
  });
}
