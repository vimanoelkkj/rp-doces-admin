const CATALOG_HASH = "#cardapio";

export function routeFromLocation() {
  if (typeof window === "undefined") return "home";
  return window.location.hash === CATALOG_HASH ? "catalog" : "home";
}

export function syncRouteLocation(route, { replace = false } = {}) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.hash = route === "catalog" ? CATALOG_HASH : "";
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ storefrontRoute: route }, "", url);
}
