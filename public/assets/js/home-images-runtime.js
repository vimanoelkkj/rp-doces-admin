const REFRESH_INTERVAL_MS = 8000;
let config = null;
let timer = null;
let inFlight = false;

function imageUrl(key) {
  return key ? `/api/images/${encodeURIComponent(key)}` : "";
}

function syncMedia(selector, key, alt) {
  const media = document.querySelector(selector);
  if (!media) return;
  const url = imageUrl(key);
  let image = media.querySelector("img[data-home-managed-image]");

  if (!url) {
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
  if (image.getAttribute("src") !== url) image.src = url;
  media.classList.add("has-image");
}

function applyConfig() {
  if (!config) return;
  syncMedia(
    ".rp-home-media--hero",
    config.home_hero_image_key,
    "Foto principal da R&P Doces"
  );
  syncMedia(
    ".rp-home-media--about",
    config.home_about_image_key,
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
    const changed =
      next.home_hero_image_key !== config?.home_hero_image_key ||
      next.home_about_image_key !== config?.home_about_image_key;
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
refreshConfig();
