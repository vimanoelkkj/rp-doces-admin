const PRODUCT_IMAGE_SELECTOR = [
  ".rp-product-card__image",
  ".products-card__image",
  ".product-image-preview img"
].join(",");

function hasTransparentPixels(image) {
  try {
    const canvas = document.createElement("canvas");
    const size = 48;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 245) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function applyTransparencyMode(image) {
  if (!(image instanceof HTMLImageElement)) return;
  const inspect = () => {
    const transparent = hasTransparentPixels(image);
    image.classList.toggle("is-transparent-art", transparent);
    image.parentElement?.classList.toggle("has-transparent-art", transparent);
  };
  if (image.complete && image.naturalWidth) inspect();
  else image.addEventListener("load", inspect, { once: true });
}

function scan(root = document) {
  if (root instanceof HTMLImageElement && root.matches(PRODUCT_IMAGE_SELECTOR)) {
    applyTransparencyMode(root);
  }
  root.querySelectorAll?.(PRODUCT_IMAGE_SELECTOR).forEach(applyTransparencyMode);
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) scan(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
