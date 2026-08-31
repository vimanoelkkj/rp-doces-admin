const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;
const WEBP_QUALITY = 0.9;

function fileName(file) {
  const base = String(file?.name || "foto-produto")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "foto-produto";
  return `${base}-ajustada.webp`;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível gerar a foto ajustada."));
    }, "image/webp", WEBP_QUALITY);
  });
}

async function getSource(input, preview) {
  const selected = input?.files?.[0];
  if (selected) return { blob: selected, name: selected.name };

  const src = preview?.currentSrc || preview?.src || "";
  if (!src) throw new Error("Escolha uma foto antes de ajustar.");

  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Não foi possível carregar a foto atual para ajuste.");
  const blob = await response.blob();
  return { blob, name: "foto-produto.webp" };
}

async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Não foi possível ler a foto."));
    image.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url)
  };
}

function renderCrop(canvas, image, zoom, positionX, positionY) {
  const context = canvas.getContext("2d");
  if (!context) return;

  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;
  context.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const coverScale = Math.max(TARGET_WIDTH / image.width, TARGET_HEIGHT / image.height);
  const scale = coverScale * zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  const overflowX = Math.max(0, width - TARGET_WIDTH);
  const overflowY = Math.max(0, height - TARGET_HEIGHT);
  const x = -overflowX * (positionX / 100);
  const y = -overflowY * (positionY / 100);

  context.drawImage(image.source, x, y, width, height);
}

function previewAdjustedImage(preview, empty, remove, file) {
  const previous = preview.dataset.manualObjectUrl;
  if (previous) URL.revokeObjectURL(previous);

  const url = URL.createObjectURL(file);
  preview.dataset.manualObjectUrl = url;
  preview.src = url;
  preview.hidden = false;
  if (empty) empty.hidden = true;
  if (remove) remove.hidden = false;
}

function enhanceField(field) {
  if (!(field instanceof HTMLElement) || field.dataset.manualImageEnhanced === "true") return;

  const input = field.querySelector("[data-product-image-input]");
  const preview = field.querySelector("[data-product-image-preview-img]");
  const empty = field.querySelector("[data-product-image-empty]");
  const remove = field.querySelector("[data-product-image-remove]");
  const info = field.querySelector("[data-product-image-info]");
  const actions = field.querySelector(".product-image-actions");
  if (!(input instanceof HTMLInputElement) || !(preview instanceof HTMLImageElement) || !actions) return;

  field.dataset.manualImageEnhanced = "true";

  const adjustButton = document.createElement("button");
  adjustButton.type = "button";
  adjustButton.className = "products-secondary product-image-adjust";
  adjustButton.textContent = "Ajustar manualmente";
  actions.insertBefore(adjustButton, info || null);

  const panel = document.createElement("div");
  panel.className = "product-image-manual";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="product-image-manual__stage">
      <canvas data-product-manual-canvas aria-label="Prévia do recorte manual"></canvas>
    </div>
    <div class="product-image-manual__controls">
      <label><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" data-product-manual-zoom></label>
      <label><span>Horizontal</span><input type="range" min="0" max="100" step="1" value="50" data-product-manual-x></label>
      <label><span>Vertical</span><input type="range" min="0" max="100" step="1" value="50" data-product-manual-y></label>
      <div class="product-image-manual__actions">
        <button type="button" class="products-secondary" data-product-manual-cancel>Cancelar</button>
        <button type="button" class="products-primary" data-product-manual-apply>Aplicar ajuste</button>
      </div>
      <small>O ajuste gera uma imagem 8:5 para preencher o card inteiro. Use zoom e posição para escolher o enquadramento.</small>
    </div>`;
  field.appendChild(panel);

  const canvas = panel.querySelector("[data-product-manual-canvas]");
  const zoom = panel.querySelector("[data-product-manual-zoom]");
  const positionX = panel.querySelector("[data-product-manual-x]");
  const positionY = panel.querySelector("[data-product-manual-y]");
  const apply = panel.querySelector("[data-product-manual-apply]");
  const cancel = panel.querySelector("[data-product-manual-cancel]");

  let loaded = null;
  let sourceName = "foto-produto.webp";

  const draw = () => {
    if (!loaded || !(canvas instanceof HTMLCanvasElement)) return;
    renderCrop(
      canvas,
      loaded,
      Number(zoom?.value || 1),
      Number(positionX?.value || 50),
      Number(positionY?.value || 50)
    );
  };

  [zoom, positionX, positionY].forEach(control => control?.addEventListener("input", draw));

  adjustButton.addEventListener("click", async () => {
    adjustButton.disabled = true;
    if (info) info.textContent = "Carregando foto para ajuste manual…";
    try {
      loaded?.close?.();
      const source = await getSource(input, preview);
      sourceName = source.name;
      loaded = await decode(source.blob);
      if (zoom) zoom.value = "1";
      if (positionX) positionX.value = "50";
      if (positionY) positionY.value = "50";
      panel.hidden = false;
      draw();
      if (info) info.textContent = "Ajuste manual aberto. Posicione a foto e clique em Aplicar ajuste.";
    } catch (error) {
      if (info) info.textContent = error?.message || "Não foi possível abrir o ajuste manual.";
    } finally {
      adjustButton.disabled = false;
    }
  });

  cancel?.addEventListener("click", () => {
    panel.hidden = true;
    loaded?.close?.();
    loaded = null;
    if (info) info.textContent = "Ajuste manual cancelado. A foto automática continua selecionada.";
  });

  apply?.addEventListener("click", async () => {
    if (!loaded || !(canvas instanceof HTMLCanvasElement)) return;
    apply.disabled = true;
    try {
      draw();
      const blob = await canvasToBlob(canvas);
      const adjusted = new File([blob], fileName({ name: sourceName }), {
        type: "image/webp",
        lastModified: Date.now()
      });
      input._optimizedProductImage = adjusted;
      previewAdjustedImage(preview, empty, remove, adjusted);
      panel.hidden = true;
      loaded.close?.();
      loaded = null;
      if (info) {
        const kb = Math.max(1, Math.round(adjusted.size / 1024));
        info.textContent = `Ajuste manual aplicado · 1280×800 · WebP (${kb} KB).`;
      }
    } catch (error) {
      if (info) info.textContent = error?.message || "Não foi possível aplicar o ajuste manual.";
    } finally {
      apply.disabled = false;
    }
  });
}

function scan(root = document) {
  root.querySelectorAll?.("[data-product-image-field]").forEach(enhanceField);
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("[data-product-image-field]")) enhanceField(node);
      scan(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
scan();
