import { adminApi } from "./api.js";

if (!document.head.querySelector('link[href="/admin/redesign/assets/css/admin-avatars.css"]')) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/admin/redesign/assets/css/admin-avatars.css";
  document.head.appendChild(stylesheet);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
let usersById = new Map();
let usersPromise = null;

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map(part => part[0])
      .join("") || "RP"
  ).toUpperCase();
}

function setAvatar(element, user) {
  if (!(element instanceof HTMLElement)) return;
  element.replaceChildren();
  if (user?.avatar_url) {
    const image = document.createElement("img");
    image.src = user.avatar_url;
    image.alt = "";
    image.loading = "lazy";
    element.appendChild(image);
    return;
  }
  element.textContent = initials(user?.nome || user?.username);
}

async function loadUsers({ force = false } = {}) {
  if (!force && usersPromise) return usersPromise;
  usersPromise = adminApi
    .users()
    .then(payload => {
      const users = Array.isArray(payload?.usuarios) ? payload.usuarios : [];
      usersById = new Map(users.map(user => [String(user.id), user]));
      return users;
    })
    .finally(() => {
      usersPromise = null;
    });
  return usersPromise;
}

async function uploadAvatar(id, file) {
  const form = new FormData();
  form.set("image", file);
  const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/avatar`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.erro || "Não foi possível enviar a foto.");
  return payload;
}

async function removeAvatar(id) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/avatar`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.erro || "Não foi possível remover a foto.");
  return payload;
}

async function syncTopbar() {
  try {
    const payload = await adminApi.me();
    const user = payload?.usuario;
    if (!user) return;
    const avatar = document.querySelector("[data-profile-avatar]");
    setAvatar(avatar, user);
  } catch {
    // A validação principal de sessão continua sendo responsabilidade de app.js.
  }
}

function decorateCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.adminAvatarDecorated === "true") return;
  const id = String(card.dataset.adminCard || "");
  const user = usersById.get(id);
  if (!user) return;

  card.dataset.adminAvatarDecorated = "true";
  const avatar = card.querySelector(".admins-avatar");
  setAvatar(avatar, user);

  const actions = card.querySelector(".admins-card__actions");
  if (!actions) return;

  const control = document.createElement("div");
  control.className = "admins-avatar-control";
  control.innerHTML = `
    <label class="admins-secondary admins-avatar-control__choose">
      <span>${user.avatar_url ? "Trocar foto" : "Adicionar foto"}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-admin-avatar-input />
    </label>
    <button type="button" class="admins-secondary admins-avatar-control__remove" data-admin-avatar-remove${user.avatar_url ? "" : " hidden"}>Remover foto</button>
    <small data-admin-avatar-status></small>
  `;
  actions.prepend(control);

  const input = control.querySelector("[data-admin-avatar-input]");
  const remove = control.querySelector("[data-admin-avatar-remove]");
  const chooseText = control.querySelector(".admins-avatar-control__choose span");
  const status = control.querySelector("[data-admin-avatar-status]");

  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      if (status) status.textContent = "Use JPG, PNG ou WebP com até 5 MB.";
      input.value = "";
      return;
    }

    input.disabled = true;
    if (status) status.textContent = "Enviando…";
    try {
      const result = await uploadAvatar(id, file);
      user.avatar_key = result.avatar_key;
      user.avatar_url = result.avatar_url;
      setAvatar(avatar, user);
      if (chooseText) chooseText.textContent = "Trocar foto";
      if (remove) remove.hidden = false;
      if (status) status.textContent = "Foto atualizada";
      await syncTopbar();
    } catch (error) {
      if (status) status.textContent = error?.message || "Falha ao enviar a foto.";
    } finally {
      input.disabled = false;
      input.value = "";
    }
  });

  remove?.addEventListener("click", async () => {
    remove.disabled = true;
    if (status) status.textContent = "Removendo…";
    try {
      await removeAvatar(id);
      user.avatar_key = null;
      user.avatar_url = null;
      setAvatar(avatar, user);
      remove.hidden = true;
      if (chooseText) chooseText.textContent = "Adicionar foto";
      if (status) status.textContent = "Foto removida";
      await syncTopbar();
    } catch (error) {
      if (status) status.textContent = error?.message || "Falha ao remover a foto.";
    } finally {
      remove.disabled = false;
    }
  });
}

async function scan() {
  const cards = [...document.querySelectorAll("[data-admin-card]")].filter(
    card => card.dataset.adminAvatarDecorated !== "true"
  );
  if (!cards.length) return;
  try {
    if (!usersById.size) await loadUsers();
    cards.forEach(decorateCard);
  } catch {
    // A tela de administradores já exibe seus próprios erros de carregamento.
  }
}

const observer = new MutationObserver(scan);
observer.observe(document.body, { childList: true, subtree: true });
scan();
syncTopbar();
