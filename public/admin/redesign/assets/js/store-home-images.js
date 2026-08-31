import { adminApi } from "./api.js";
import "./admin-avatars.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SLOTS = [
  {
    id: "hero",
    key: "home_hero_image_key",
    title: "Imagem principal",
    help: "Foto grande ao lado do título da página inicial."
  },
  {
    id: "about",
    key: "home_about_image_key",
    title: "Nossa história",
    help: "Foto exibida na seção “Uma nova doçura dentro do salão”."
  }
];

function imageUrl(key) {
  return key ? `/api/images/${encodeURIComponent(key)}` : "";
}

function slotMarkup(slot, key) {
  const url = imageUrl(key);
  return `<div class="store-home-image" data-home-image-slot="${slot.id}">
    <div class="store-home-image__preview" data-home-image-preview>
      <span data-home-image-empty${url ? " hidden" : ""}>Sem foto</span>
      <img src="${url}" alt="Prévia de ${slot.title}" data-home-image-img${url ? "" : " hidden"} />
    </div>
    <div class="store-home-image__body">
      <div><strong>${slot.title}</strong><p>${slot.help}</p></div>
      <div class="store-home-image__actions">
        <label class="store-home-image__button">
          Escolher foto
          <input type="file" accept="image/jpeg,image/png,image/webp" data-home-image-input hidden />
        </label>
        <button type="button" class="store-home-image__button" data-home-image-remove${url ? "" : " hidden"}>Remover foto</button>
      </div>
      <small data-home-image-status>JPG, PNG ou WebP · até 5 MB</small>
    </div>
  </div>`;
}

async function upload(slot, file) {
  const form = new FormData();
  form.set("image", file);
  const response = await fetch(`/api/admin/site-images/${slot}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.erro || "Não foi possível enviar a imagem.");
  return payload;
}

async function remove(slot) {
  const response = await fetch(`/api/admin/site-images/${slot}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.erro || "Não foi possível remover a imagem.");
  return payload;
}

function setPreview(root, url) {
  const image = root.querySelector("[data-home-image-img]");
  const empty = root.querySelector("[data-home-image-empty]");
  const removeButton = root.querySelector("[data-home-image-remove]");
  if (!(image instanceof HTMLImageElement) || !empty || !removeButton) return;

  if (url) {
    image.src = url;
    image.hidden = false;
    empty.hidden = true;
    removeButton.hidden = false;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    empty.hidden = false;
    removeButton.hidden = true;
  }
}

function bindSlot(root) {
  if (!(root instanceof HTMLElement) || root.dataset.homeImageBound === "true") return;
  root.dataset.homeImageBound = "true";
  const slot = root.dataset.homeImageSlot;
  const input = root.querySelector("[data-home-image-input]");
  const removeButton = root.querySelector("[data-home-image-remove]");
  const status = root.querySelector("[data-home-image-status]");

  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      input.value = "";
      if (status) status.textContent = "Use JPG, PNG ou WebP com no máximo 5 MB.";
      return;
    }

    if (status) status.textContent = "Enviando…";
    try {
      const result = await upload(slot, file);
      setPreview(root, result.image_url || imageUrl(result.image_key));
      if (status) status.textContent = "Foto atualizada";
    } catch (error) {
      if (status) status.textContent = error?.message || "Falha ao enviar a foto.";
    } finally {
      input.value = "";
    }
  });

  removeButton?.addEventListener("click", async () => {
    removeButton.disabled = true;
    if (status) status.textContent = "Removendo…";
    try {
      await remove(slot);
      setPreview(root, "");
      if (status) status.textContent = "Foto removida";
    } catch (error) {
      if (status) status.textContent = error?.message || "Falha ao remover a foto.";
    } finally {
      removeButton.disabled = false;
    }
  });
}

async function injectHomeImagesCard(storeView) {
  if (!(storeView instanceof HTMLElement) || storeView.querySelector("[data-store-home-images]"))
    return;
  const grid = storeView.querySelector(".store-grid");
  if (!grid) return;

  let config = {};
  try {
    config = await adminApi.storeConfig();
  } catch {
    return;
  }
  if (!storeView.isConnected || storeView.querySelector("[data-store-home-images]")) return;

  const card = document.createElement("section");
  card.className = "store-card store-card--home-images";
  card.dataset.storeHomeImages = "";
  card.innerHTML = `<div class="store-card__head"><div><h3>Imagens da página inicial</h3><p>Gerencie as duas fotos principais da home.</p></div></div>
    <div class="store-home-images">${SLOTS.map(slot => slotMarkup(slot, config[slot.key])).join("")}</div>`;

  const previewCard = grid.querySelector(".store-card--public-preview");
  if (previewCard) grid.insertBefore(card, previewCard);
  else grid.appendChild(card);
  card.querySelectorAll("[data-home-image-slot]").forEach(bindSlot);
}

function scan() {
  document.querySelectorAll(".store-view").forEach(injectHomeImagesCard);
}

const observer = new MutationObserver(scan);
observer.observe(document.body, { childList: true, subtree: true });
scan();
