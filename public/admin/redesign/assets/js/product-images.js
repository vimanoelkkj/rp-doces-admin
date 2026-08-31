import { adminApi } from "./api.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const WEBP_QUALITY = 0.88;
const IMAGE_REQUEST_TIMEOUT_MS = 30_000;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let productsById = new Map();
let decorating = false;

function imageUrl(product) {
  return product?.image_key ? `/api/images/${product.image_key}` : "";
}

function parseMoneyToCents(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function productImageFileName(file) {
  const base = String(file?.name || "foto-produto")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "foto-produto";
  return `${base}.webp`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível preparar a imagem."));
    }, type, quality);
  });
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.()
      };
    } catch (_) {}
  }

  const localUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Não foi possível ler a imagem selecionada."));
      image.src = localUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(localUrl)
    };
  } catch (error) {
    URL.revokeObjectURL(localUrl);
    throw error;
  }
}

async function optimizeImageForStorefront(file) {
  const loaded = await loadImageSource(file);
  try {
    const largestSide = Math.max(loaded.width, loaded.height);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / largestSide);
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(loaded.source, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("A foto ficou grande demais mesmo após a otimização. Tente outra imagem.");
    }

    return new File([blob], productImageFileName(file), {
      type: "image/webp",
      lastModified: Date.now()
    });
  } finally {
    loaded.close?.();
  }
}

async function requestImage(url, options, timeoutMessage) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(timeoutMessage);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function uploadImage(id, file) {
  const form = new FormData();
  form.set("image", file);
  const response = await requestImage(
    `/api/admin/products/${id}/image`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      body: form
    },
    "O envio da foto demorou demais. Verifique a conexão e tente novamente."
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.erro || "Não foi possível enviar a imagem.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function deleteImage(id) {
  const response = await requestImage(
    `/api/admin/products/${id}/image`,
    {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    },
    "A remoção da foto demorou demais. Tente novamente."
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.erro || "Não foi possível remover a imagem.");
  return payload;
}

async function loadProducts() {
  const payload = await adminApi.products();
  const products = Array.isArray(payload?.produtos) ? payload.produtos : [];
  productsById = new Map(products.map(product => [Number(product.id), product]));
  return products;
}

function decorateCards() {
  for (const card of document.querySelectorAll(".products-card[data-product-id]")) {
    const product = productsById.get(Number(card.dataset.productId));
    const media = card.querySelector(".products-card__media");
    const placeholder = card.querySelector(".products-card__placeholder");
    if (!media || !product?.image_key) continue;

    let image = media.querySelector(".products-card__image");
    if (!image) {
      image = document.createElement("img");
      image.className = "products-card__image";
      image.loading = "lazy";
      image.decoding = "async";
      media.prepend(image);
    }
    image.src = imageUrl(product);
    image.alt = product.nome || "Foto do produto";
    if (placeholder) placeholder.hidden = true;
  }
}

async function refreshDecorations() {
  if (decorating || !document.querySelector(".products-view")) return;
  decorating = true;
  try {
    await loadProducts();
    decorateCards();
  } catch (_) {
  } finally {
    decorating = false;
  }
}

function revokePreviewUrl(preview) {
  const previous = preview?.dataset?.localObjectUrl;
  if (previous) URL.revokeObjectURL(previous);
  if (preview?.dataset) delete preview.dataset.localObjectUrl;
}

function showLocalPreview(preview, empty, remove, file) {
  revokePreviewUrl(preview);
  const localUrl = URL.createObjectURL(file);
  preview.dataset.localObjectUrl = localUrl;
  preview.src = localUrl;
  preview.hidden = false;
  empty.hidden = true;
  remove.hidden = false;
}

function ensureImageField(form) {
  if (!(form instanceof HTMLFormElement) || form.querySelector("[data-product-image-field]"))
    return;
  const grid = form.querySelector(".products-form__grid");
  if (!grid) return;

  const field = document.createElement("div");
  field.className = "products-field products-field--wide product-image-field";
  field.dataset.productImageField = "";
  field.innerHTML = `
    <span>Foto do produto</span>
    <div class="product-image-picker">
      <div class="product-image-preview" data-product-image-preview>
        <span data-product-image-empty>Sem foto</span>
        <img alt="Prévia da foto do produto" data-product-image-preview-img hidden />
      </div>
      <div class="product-image-actions">
        <label class="products-secondary product-image-choose">
          Escolher foto
          <input type="file" name="product_image" accept="image/jpeg,image/png,image/webp" data-product-image-input hidden />
        </label>
        <button class="products-secondary" type="button" data-product-image-remove hidden>Remover foto</button>
        <small data-product-image-info>A prévia usa o enquadramento do card do site. A foto é redimensionada automaticamente e enviada em WebP.</small>
      </div>
    </div>`;

  const description = grid.querySelector('textarea[name="descricao"]')?.closest(".products-field");
  if (description) grid.insertBefore(field, description);
  else grid.appendChild(field);

  const input = field.querySelector("[data-product-image-input]");
  const remove = field.querySelector("[data-product-image-remove]");
  const preview = field.querySelector("[data-product-image-preview-img]");
  const empty = field.querySelector("[data-product-image-empty]");
  const info = field.querySelector("[data-product-image-info]");

  input?.addEventListener("change", async () => {
    const sourceFile = input.files?.[0];
    input._optimizedProductImage = null;
    form.dataset.removeProductImage = "0";
    if (!sourceFile) return;

    const message = form.querySelector("[data-product-form-message]");
    if (!ACCEPTED_TYPES.has(sourceFile.type) || sourceFile.size > MAX_SOURCE_IMAGE_BYTES) {
      input.value = "";
      if (message)
        message.textContent = "Use JPG, PNG ou WebP com no máximo 20 MB. A foto será otimizada antes do envio.";
      return;
    }

    if (message) message.textContent = "";
    if (info) info.textContent = "Ajustando a foto para a moldura do site…";

    try {
      const optimized = await optimizeImageForStorefront(sourceFile);
      input._optimizedProductImage = optimized;
      showLocalPreview(preview, empty, remove, optimized);
      if (info) {
        const kb = Math.max(1, Math.round(optimized.size / 1024));
        info.textContent = `Prévia do enquadramento do site · imagem otimizada em WebP (${kb} KB, até ${MAX_IMAGE_DIMENSION}px).`;
      }
    } catch (error) {
      input.value = "";
      input._optimizedProductImage = null;
      if (message) message.textContent = error?.message || "Não foi possível preparar a foto.";
      if (info)
        info.textContent = "A prévia usa o enquadramento do card do site. A foto é redimensionada automaticamente e enviada em WebP.";
    }
  });

  remove?.addEventListener("click", () => {
    input.value = "";
    input._optimizedProductImage = null;
    form.dataset.removeProductImage = "1";
    revokePreviewUrl(preview);
    preview.removeAttribute("src");
    preview.hidden = true;
    empty.hidden = false;
    remove.hidden = true;
    if (info)
      info.textContent = "A prévia usa o enquadramento do card do site. A foto é redimensionada automaticamente e enviada em WebP.";
  });
}

function syncFormImage(form) {
  ensureImageField(form);
  const product = form._editingProduct;
  const preview = form.querySelector("[data-product-image-preview-img]");
  const empty = form.querySelector("[data-product-image-empty]");
  const remove = form.querySelector("[data-product-image-remove]");
  const input = form.querySelector("[data-product-image-input]");
  const info = form.querySelector("[data-product-image-info]");
  if (!(preview instanceof HTMLImageElement) || !empty || !remove || !input) return;

  revokePreviewUrl(preview);
  input.value = "";
  input._optimizedProductImage = null;
  form.dataset.removeProductImage = "0";
  if (info)
    info.textContent = "A prévia usa o enquadramento do card do site. A foto é redimensionada automaticamente e enviada em WebP.";
  if (product?.image_key) {
    preview.src = imageUrl(product);
    preview.hidden = false;
    empty.hidden = true;
    remove.hidden = false;
  } else {
    preview.removeAttribute("src");
    preview.hidden = true;
    empty.hidden = false;
    remove.hidden = true;
  }
}

function baseProductPayload(product, data, price, stock, name) {
  return {
    nome: name,
    categoria: String(data.get("categoria") || product?.categoria || "BOLO_NO_POTE"),
    descricao: String(data.get("descricao") || "").trim(),
    preco_centavos: price,
    disponivel: product ? Boolean(Number(product.disponivel)) : true,
    ativo: data.get("ativo") === "on",
    destaque: data.get("destaque") === "on",
    emoji: String(data.get("emoji") || product?.emoji || "🍰").trim(),
    estoque: stock,
    promocao_ativa: product ? Boolean(Number(product.promocao_ativa)) : false,
    preco_promocional_centavos: product?.preco_promocional_centavos ?? null,
    promocao_inicio: product?.promocao_inicio ?? null,
    promocao_fim: product?.promocao_fim ?? null
  };
}

async function handleImageSubmit(event, form) {
  const input = form.querySelector("[data-product-image-input]");
  const file = input?._optimizedProductImage || input?.files?.[0] || null;
  const removeRequested = form.dataset.removeProductImage === "1";
  if (!file && !removeRequested) return false;

  event.preventDefault();
  event.stopImmediatePropagation();

  const data = new FormData(form);
  const price = parseMoneyToCents(data.get("preco"));
  const stock = Number(data.get("estoque"));
  const name = String(data.get("nome") || "").trim();
  const message = form.querySelector("[data-product-form-message]");
  const submit = form.querySelector("[data-product-submit]");
  const editId = Number(form.dataset.editProductId || 0);
  const product = form._editingProduct || productsById.get(editId) || null;

  if (!name || price === null || !Number.isSafeInteger(stock) || stock < 0) {
    if (message) message.textContent = "Confira nome, preço e estoque antes de salvar.";
    return true;
  }

  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  if (submit) submit.textContent = file ? "Enviando foto…" : "Salvando…";
  if (message) message.textContent = "";

  let completed = false;
  try {
    let id = editId;
    const payload = baseProductPayload(product, data, price, stock, name);
    if (id) {
      await adminApi.updateProduct(id, payload);
    } else {
      const created = await adminApi.createProduct(payload);
      id = Number(created?.id || 0);
      if (!id) throw new Error("Produto criado sem identificador para a foto.");
    }

    if (file) await uploadImage(id, file);
    else if (removeRequested && id) await deleteImage(id);

    completed = true;

    const close = form.closest("[data-product-dialog]")?.querySelector("[data-product-dialog-close]");
    if (close instanceof HTMLButtonElement) close.click();

    requestAnimationFrame(() => {
      document.querySelector('[data-admin-nav="produtos"]')?.click();
      refreshDecorations();
    });
  } catch (error) {
    if (message)
      message.textContent = error?.message || "Não foi possível salvar a foto do produto.";
  } finally {
    if (!completed && submit instanceof HTMLButtonElement) {
      submit.disabled = false;
      submit.textContent = editId ? "Salvar alterações" : "Salvar produto";
    }
  }
  return true;
}

document.addEventListener(
  "submit",
  event => {
    const form = event.target.closest?.("[data-product-form]");
    if (form instanceof HTMLFormElement) handleImageSubmit(event, form);
  },
  true
);

document.addEventListener("click", event => {
  if (event.target.closest("[data-new-product]")) {
    requestAnimationFrame(() => {
      const form = document.querySelector("[data-product-form]");
      if (form instanceof HTMLFormElement) syncFormImage(form);
    });
  }
  if (event.target.closest("[data-edit-product]")) {
    setTimeout(() => {
      const form = document.querySelector("[data-product-form]");
      if (form instanceof HTMLFormElement) syncFormImage(form);
    }, 0);
  }
});

const observer = new MutationObserver(records => {
  let hasProductUi = false;
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.("[data-product-form]")) ensureImageField(node);
      node.querySelectorAll?.("[data-product-form]").forEach(ensureImageField);
      if (node.matches?.(".products-card") || node.querySelector?.(".products-card"))
        hasProductUi = true;
    }
  }
  if (hasProductUi) refreshDecorations();
});

observer.observe(document.body, { childList: true, subtree: true });
refreshDecorations();
