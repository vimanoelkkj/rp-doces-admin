const REFRESH_INTERVAL_MS = 8000;
const REDESIGN_HERO_IMAGE = "/assets/images/rp-hero-ultrawide-v2.webp";
let config = null;
let timer = null;
let inFlight = false;

function isLocalHost() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}

function imageUrl(key) {
  if (!key) return "";
  const encoded = encodeURIComponent(key);
  return isLocalHost() ? `/api/production-images/${encoded}` : `/api/images/${encoded}`;
}

function syncMedia(selector, src, alt) {
  const media = document.querySelector(selector);
  if (!media) return;
  let image = media.querySelector("img[data-home-managed-image]");

  if (!src) {
    image?.remove();
    media.classList.remove("has-image");
    return;
  }

  if (!image) {
    image = document.createElement("img");
    image.dataset.homeManagedImage = "";
    image.decoding = "async";
    media.appendChild(image);
  }

  image.alt = alt;
  if (image.getAttribute("src") !== src) image.src = src;
  media.classList.add("has-image");
}

function applyConfig() {
  syncMedia(".rp-home-media--hero", REDESIGN_HERO_IMAGE, "Bolos no pote e pudim da R&P Doces");

  if (!config) return;
  syncMedia(
    ".rp-home-media--about",
    imageUrl(config.home_about_image_key),
    "R&P Doces na seção Nossa história"
  );
}

async function refreshConfig() {
  if (inFlight || document.visibilityState === "hidden") return;
  inFlight = true;
  try {
    const response = await fetch("/api/config", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) return;
    const next = await response.json();
    const changed = next.home_about_image_key !== config?.home_about_image_key;
    config = next;
    if (changed) applyConfig();
  } catch {
  } finally {
    inFlight = false;
  }
}

const observer = new MutationObserver(applyConfig);
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshConfig();
});
window.addEventListener("focus", refreshConfig);
window.addEventListener("online", refreshConfig);

timer = setInterval(refreshConfig, REFRESH_INTERVAL_MS);
void timer;
applyConfig();
refreshConfig();
