import { acquirePageScrollLock } from "./usePageScrollLock";

const MOBILE_DRAWER_QUERY = "(max-width: 1000px)";
const media = window.matchMedia(MOBILE_DRAWER_QUERY);
let releaseScrollLock: (() => void) | null = null;
let settleTimer = 0;

function elementIsVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < window.innerWidth - 1 &&
    rect.right > 1 &&
    rect.top < window.innerHeight - 1 &&
    rect.bottom > 1
  );
}

function drawerIsVisible(): boolean {
  if (!media.matches) return false;
  const drawer = document.getElementById("drawer");
  if (!drawer || !drawer.hasChildNodes()) return false;
  return elementIsVisible(drawer);
}

function modalIsOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(elementIsVisible);
}

function syncScrollLock(): void {
  const shouldLock = modalIsOpen() || drawerIsVisible();
  if (shouldLock && !releaseScrollLock) {
    releaseScrollLock = acquirePageScrollLock();
    return;
  }
  if (!shouldLock && releaseScrollLock) {
    releaseScrollLock();
    releaseScrollLock = null;
  }
}

function scheduleSync(): void {
  window.requestAnimationFrame(syncScrollLock);
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(syncScrollLock, 260);
}

const observer = new MutationObserver(scheduleSync);

function start(): void {
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-modal", "hidden"]
  });
  media.addEventListener("change", scheduleSync);
  window.addEventListener("resize", scheduleSync, { passive: true });
  scheduleSync();
}

function cleanup(): void {
  observer.disconnect();
  media.removeEventListener("change", scheduleSync);
  window.removeEventListener("resize", scheduleSync);
  window.clearTimeout(settleTimer);
  if (releaseScrollLock) {
    releaseScrollLock();
    releaseScrollLock = null;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

window.addEventListener("pagehide", cleanup, { once: true });
