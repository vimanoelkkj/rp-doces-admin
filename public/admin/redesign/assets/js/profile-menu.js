import { adminApi } from "./api.js";

function passkeysSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

function fromUrlB64(value) {
  const padded = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toUrlB64(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function creationOptionsFromJSON(options) {
  return {
    ...options,
    challenge: fromUrlB64(options.challenge),
    user: { ...options.user, id: fromUrlB64(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map(item => ({
      ...item,
      id: fromUrlB64(item.id)
    }))
  };
}

function registrationToJSON(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: toUrlB64(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toUrlB64(response.clientDataJSON),
      attestationObject: toUrlB64(response.attestationObject),
      transports: response.getTransports?.() || []
    }
  };
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Ainda não usada";
  const date = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function setupProfileMenu(button, user, { onUnauthorized } = {}) {
  if (!button || button.dataset.profileMenuReady === "1") return;
  button.dataset.profileMenuReady = "1";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const host = button.parentElement;
  const menu = document.createElement("section");
  menu.className = "profile-menu";
  menu.hidden = true;
  menu.setAttribute("aria-label", "Conta e segurança");
  menu.innerHTML = `
    <div class="profile-menu__identity">
      <strong>${esc(user?.nome || user?.username || "Administrador")}</strong>
      <span>@${esc(user?.username || "admin")} · ${esc(String(user?.papel || "ADMIN").toUpperCase())}</span>
    </div>
    <a class="profile-menu__v2" href="/admin-v2/#dashboard" aria-label="Abrir Admin V2">
      <span class="profile-menu__v2-icon" aria-hidden="true">V2</span>
      <span class="profile-menu__v2-copy">
        <strong>Experimentar Admin V2</strong>
        <small>Nova versão em desenvolvimento</small>
      </span>
      <span class="profile-menu__v2-arrow" aria-hidden="true">›</span>
    </a>
    <div class="profile-menu__section">
      <div class="profile-menu__section-head">
        <div><strong>Passkeys</strong><span>Entre com biometria ou chave do dispositivo.</span></div>
        <button type="button" class="profile-menu__add" data-profile-add-passkey>Cadastrar</button>
      </div>
      <div class="profile-menu__status" data-profile-status></div>
      <div class="profile-menu__passkeys" data-profile-passkeys><span>Carregando…</span></div>
    </div>
    <button type="button" class="profile-menu__logout" data-profile-logout>Sair da conta</button>`;
  host.appendChild(menu);

  const list = menu.querySelector("[data-profile-passkeys]");
  const status = menu.querySelector("[data-profile-status]");
  const add = menu.querySelector("[data-profile-add-passkey]");
  let loaded = false;

  const showStatus = (message = "", error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  };

  const renderPasskeys = passkeys => {
    if (!passkeys.length) {
      list.innerHTML = '<span class="profile-menu__empty">Nenhuma passkey cadastrada.</span>';
      return;
    }
    list.innerHTML = passkeys
      .map(
        passkey => `<div class="profile-passkey">
          <div><strong>${esc(passkey.nome || "Biometria deste aparelho")}</strong><span>${passkey.backed_up ? "Passkey sincronizada" : "Este aparelho"} · ${esc(formatDate(passkey.ultimo_uso_em))}</span></div>
          <button type="button" data-profile-remove-passkey="${Number(passkey.id)}">Remover</button>
        </div>`
      )
      .join("");
  };

  const loadPasskeys = async () => {
    if (!passkeysSupported()) {
      add.disabled = true;
      list.innerHTML =
        '<span class="profile-menu__empty">Passkeys não estão disponíveis neste navegador.</span>';
      return;
    }
    try {
      const payload = await adminApi.passkeys();
      renderPasskeys(payload?.passkeys || []);
      loaded = true;
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      list.innerHTML =
        '<span class="profile-menu__empty">Não foi possível carregar suas passkeys.</span>';
    }
  };

  const close = () => {
    menu.hidden = true;
    button.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    window.dispatchEvent(
      new CustomEvent("rp-admin-popover-open", { detail: { source: "profile" } })
    );
    menu.hidden = false;
    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    if (!loaded) loadPasskeys();
  };

  button.addEventListener("click", event => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });

  add.addEventListener("click", async () => {
    if (!passkeysSupported()) return;
    add.disabled = true;
    showStatus("Abrindo verificação do dispositivo…");
    try {
      const begin = await adminApi.beginPasskeyRegistration();
      const credential = await navigator.credentials.create({
        publicKey: creationOptionsFromJSON(begin.options)
      });
      if (!credential) throw new Error("O cadastro não foi concluído.");
      await adminApi.finishPasskeyRegistration(begin.challenge_id, registrationToJSON(credential));
      showStatus("Passkey cadastrada.");
      await loadPasskeys();
    } catch (error) {
      const cancelled = error?.name === "NotAllowedError" || error?.name === "AbortError";
      showStatus(
        cancelled ? "Cadastro cancelado." : error?.message || "Não foi possível cadastrar.",
        true
      );
    } finally {
      add.disabled = false;
    }
  });

  list.addEventListener("click", async event => {
    const remove = event.target.closest("[data-profile-remove-passkey]");
    if (!remove) return;
    if (!confirm("Remover esta passkey? O login por senha continuará disponível.")) return;
    remove.disabled = true;
    showStatus("");
    try {
      await adminApi.removePasskey(Number(remove.dataset.profileRemovePasskey));
      showStatus("Passkey removida.");
      await loadPasskeys();
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      showStatus(error?.message || "Não foi possível remover.", true);
      remove.disabled = false;
    }
  });

  menu.querySelector("[data-profile-logout]").addEventListener("click", async () => {
    try {
      await adminApi.logout();
    } finally {
      location.assign("/admin/");
    }
  });

  document.addEventListener("click", event => {
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) {
      close();
      button.focus();
    }
  });
  window.addEventListener("rp-admin-popover-open", event => {
    if (event.detail?.source !== "profile") close();
  });
}
