const SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FRAME_RATIO = 4 / 3;
const MAX_OUTPUT_WIDTH = 1200;
const WEBP_QUALITY = 0.88;

function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function imageInfo(field) {
  let info = field?.querySelector("[data-product-image-info]");
  if (info || !field) return info;
  info = document.createElement("small");
  info.dataset.productImageInfo = "";
  const actions = field.querySelector(".product-image-actions");
  actions?.append(info);
  return info;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (...args) => args[0].drawImage(bitmap, ...args.slice(1)),
      close: () => bitmap.close?.()
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (...args) => args[0].drawImage(image, ...args.slice(1)),
      close: () => {}
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fitToStorefrontFrame(file) {
  const source = await decodeImage(file);
  try {
    const sourceRatio = source.width / source.height;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;

    if (sourceRatio > FRAME_RATIO) {
      sw = source.height * FRAME_RATIO;
      sx = (source.width - sw) / 2;
    } else if (sourceRatio < FRAME_RATIO) {
      sh = source.width / FRAME_RATIO;
      sy = (source.height - sh) / 2;
    }

    const outputWidth = Math.max(1, Math.min(MAX_OUTPUT_WIDTH, Math.round(sw)));
    const outputHeight = Math.max(1, Math.round(outputWidth / FRAME_RATIO));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Não foi possível preparar a imagem neste navegador.");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    source.draw(context, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

    let blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
    let type = "image/webp";
    let extension = "webp";
    if (!blob) {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
      type = "image/jpeg";
      extension = "jpg";
    }
    if (!blob) throw new Error("Não foi possível redimensionar a imagem.");

    const baseName = String(file.name || "produto")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "produto";

    return {
      file: new File([blob], `${baseName}-${outputWidth}x${outputHeight}.${extension}`, {
        type,
        lastModified: Date.now()
      }),
      width: outputWidth,
      height: outputHeight
    };
  } finally {
    source.close();
  }
}

function replaceInputFile(input, file) {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    return input.files?.[0] === file || input.files?.[0]?.name === file.name;
  } catch (_) {
    return false;
  }
}

document.addEventListener(
  "change",
  async event => {
    const input = event.target?.closest?.("[data-product-image-input]");
    if (!(input instanceof HTMLInputElement) || event.rpStorefrontFramed) return;

    const original = input.files?.[0];
    if (!original) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const form = input.closest("[data-product-form]");
    const field = input.closest("[data-product-image-field]");
    const info = imageInfo(field);
    const message = form?.querySelector("[data-product-form-message]");

    if (!SOURCE_TYPES.has(original.type)) {
      input.value = "";
      if (message) message.textContent = "Use uma foto JPG, PNG ou WebP.";
      return;
    }

    input.disabled = true;
    if (info) info.textContent = "Ajustando a foto para a moldura 4:3 do site…";
    if (message) message.textContent = "";

    try {
      const prepared = await fitToStorefrontFrame(original);
      if (!replaceInputFile(input, prepared.file)) {
        throw new Error("Seu navegador não permitiu aplicar o redimensionamento automaticamente.");
      }

      if (info) {
        const reduction = original.size > prepared.file.size ? ` · de ${fileSize(original.size)} para ${fileSize(prepared.file.size)}` : ` · ${fileSize(prepared.file.size)}`;
        info.textContent = `Pronta para o site: ${prepared.width}×${prepared.height}px${reduction}`;
      }

      const nextEvent = new Event("change", { bubbles: true });
      nextEvent.rpStorefrontFramed = true;
      input.dispatchEvent(nextEvent);
    } catch (error) {
      input.value = "";
      if (info) info.textContent = "";
      if (message) message.textContent = error?.message || "Não foi possível ajustar a foto.";
    } finally {
      input.disabled = false;
    }
  },
  true
);
