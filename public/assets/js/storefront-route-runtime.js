import { routeFromLocation, syncRouteLocation } from "./utils/storefront-route.js";

let applyingLocationRoute = false;

function applyLocationRoute() {
  const route = routeFromLocation();
  if (route !== "catalog") return;

  const trigger = document.querySelector("[data-show-catalog]");
  if (!trigger) return;

  applyingLocationRoute = true;
  trigger.click();
  applyingLocationRoute = false;
}

document.addEventListener(
  "click",
  event => {
    if (applyingLocationRoute) return;

    if (event.target.closest("[data-show-catalog]")) {
      syncRouteLocation("catalog");
      return;
    }

    if (event.target.closest("[data-home-top], [data-home-section]")) {
      syncRouteLocation("home");
    }
  },
  true
);

window.addEventListener("hashchange", () => {
  const route = routeFromLocation();

  if (route === "catalog") {
    applyLocationRoute();
    return;
  }

  const trigger = document.querySelector("[data-home-top]");
  if (!trigger) return;

  applyingLocationRoute = true;
  trigger.click();
  applyingLocationRoute = false;
});

queueMicrotask(applyLocationRoute);
