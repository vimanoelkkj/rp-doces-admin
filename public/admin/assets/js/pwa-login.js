function fromUrlB64(value) {
  const source = String(value || "");
  const padded = source
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(source.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toUrlB64(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requestOptionsFromJSON(options) {
  return {
    ...options,
    challenge: fromUrlB64(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(item => ({
      ...item,
      id: fromUrlB64(item.id)
    }))
  };
}

function authenticationToJSON(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: toUrlB64(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toUrlB64(response.clientDataJSON),
      authenticatorData: toUrlB64(response.authenticatorData),
      signature: toUrlB64(response.signature),
      userHandle: response.userHandle ? toUrlB64(response.userHandle) : null
    }
  };
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.erro || "Não foi possível entrar.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

const status = document.querySelector("[data-login-status]");
const card = document.querySelector("[data-login-card]");
const setupStage = document.querySelector('[data-login-stage="setup"]');
const setupForm = document.querySelector("[data-setup-form]");
const existingLogin = document.querySelector("[data-login-existing]");
const passkeyButton = document.querySelector("[data-passkey-login]");
const usernameForm = document.querySelector("[data-username-form]");
const passwordForm = document.querySelector("[data-password-form]");
const usernameStage = document.querySelector('[data-login-stage="username"]');
const passwordStage = document.querySelector('[data-login-stage="password"]');
const switchUserButton = document.querySelector("[data-switch-user]");
const loginAvatar = document.querySelector("[data-login-avatar]");
const loginName = document.querySelector("[data-login-name]");
const loginUsername = document.querySelector("[data-login-username]");
const loginKicker = document.querySelector("[data-login-kicker]");
const loginTitle = document.querySelector("[data-login-title]");
const loginDescription = document.querySelector("[data-login-description]");
const loginFoot = document.querySelector("[data-login-foot]");
const mobileInput = matchMedia("(max-width: 520px), (pointer: coarse)");
const returnParam = new URLSearchParams(location.search).get("return");
const destination = returnParam?.startsWith("/admin/") ? returnParam : "/admin/";

function setStatus(message = "", error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function goToAdmin() {
  location.replace(destination);
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map(part => part[0])
      .join("") || "RP"
  ).toUpperCase();
}

function showSetupStage() {
  setupStage.hidden = false;
  existingLogin.hidden = true;
  card.classList.remove("is-password-stage");
  loginKicker.textContent = "Configuração inicial";
  loginTitle.textContent = "Crie o primeiro acesso";
  loginDescription.textContent = "Cadastre o administrador principal para começar a usar o painel.";
  loginFoot.textContent = "Esta etapa só aparece enquanto ainda não existe nenhum administrador.";
  setStatus();
  requestAnimationFrame(() => setupForm.elements.nome?.focus());
}

function showLoginStage() {
  setupStage.hidden = true;
  existingLogin.hidden = false;
  loginKicker.textContent = "Painel administrativo";
  loginTitle.textContent = "Bem-vindo de volta";
  loginDescription.textContent = "Entre para gerenciar pedidos, produtos e a loja.";
  loginFoot.textContent = "A biometria permanece no seu dispositivo e não é enviada à R&P Doces.";
}

function renderIdentity(user) {
  loginAvatar.replaceChildren();
  if (user?.avatar_url) {
    const image = document.createElement("img");
    image.src = user.avatar_url;
    image.alt = "";
    loginAvatar.appendChild(image);
  } else {
    loginAvatar.textContent = initials(user?.nome || user?.username);
  }
  loginName.textContent = user?.nome || user?.username || "Administrador";
  loginUsername.textContent = `@${user?.username || "usuario"}`;
}

function showPasswordStage(user) {
  const username = String(user?.username || "").trim();
  renderIdentity(user);
  passwordForm.elements.username.value = username;
  usernameStage.hidden = true;
  passwordStage.hidden = false;
  card.classList.add("is-password-stage");

  if (!mobileInput.matches) {
    requestAnimationFrame(() => passwordForm.elements.senha?.focus());
  }
}

function showUsernameStage({ preserveUsername = true } = {}) {
  const previous = preserveUsername ? passwordForm.elements.username.value : "";
  passwordForm.reset();
  passwordStage.hidden = true;
  usernameStage.hidden = false;
  card.classList.remove("is-password-stage");
  if (previous) usernameForm.elements.username.value = previous;
  setStatus();
  requestAnimationFrame(() => {
    usernameForm.elements.username?.focus();
    usernameForm.elements.username?.select();
  });
}

async function checkInitialSetup() {
  try {
    const response = await fetch("/api/setup", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    if (payload?.needsSetup) {
      showSetupStage();
      return true;
    }
    showLoginStage();
    return false;
  } catch (_) {
    return false;
  }
}

async function alreadyAuthenticated() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.autenticado) goToAdmin();
  } catch (_) {}
}

setupForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = setupForm.querySelector('button[type="submit"]');
  const data = new FormData(setupForm);
  submit.disabled = true;
  setStatus("Criando administrador…");

  try {
    await api("/api/setup", {
      nome: String(data.get("nome") || "").trim(),
      username: String(data.get("username") || "").trim().toLowerCase(),
      email: String(data.get("email") || "").trim().toLowerCase(),
      senha: String(data.get("senha") || ""),
      setupKey: String(data.get("setupKey") || "")
    });

    const username = String(data.get("username") || "").trim().toLowerCase();
    setupForm.reset();
    showLoginStage();
    usernameForm.elements.username.value = username;
    setStatus("Administrador criado. Agora entre com sua senha.");
    requestAnimationFrame(() => usernameForm.elements.username?.focus());
  } catch (error) {
    setStatus(error?.message || "Não foi possível concluir a configuração inicial.", true);
  } finally {
    submit.disabled = false;
  }
});

if (!window.PublicKeyCredential || !navigator.credentials) {
  passkeyButton.hidden = true;
}

passkeyButton?.addEventListener("click", async () => {
  passkeyButton.disabled = true;
  setStatus("Aguardando a verificação do aparelho…");
  try {
    const begin = await api("/api/auth/passkey", { acao: "opcoes" });
    const credential = await navigator.credentials.get({
      publicKey: requestOptionsFromJSON(begin.options)
    });
    if (!credential) throw new Error("A autenticação não foi concluída.");
    await api("/api/auth/passkey", {
      acao: "verificar",
      challenge_id: begin.challenge_id,
      response: authenticationToJSON(credential)
    });
    setStatus("Identidade confirmada. Entrando…");
    goToAdmin();
  } catch (error) {
    const cancelled = error?.name === "NotAllowedError" || error?.name === "AbortError";
    setStatus(
      cancelled
        ? "Autenticação cancelada."
        : error?.message || "Não foi possível usar a biometria.",
      true
    );
  } finally {
    passkeyButton.disabled = false;
  }
});

usernameForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = usernameForm.querySelector('button[type="submit"]');
  const username = String(new FormData(usernameForm).get("username") || "")
    .trim()
    .toLowerCase();
  if (!username) return;

  submit.disabled = true;
  setStatus("Procurando sua conta…");
  try {
    const payload = await api("/api/auth/identify", { username });
    if (!payload?.encontrado || !payload?.usuario) {
      setStatus("Não encontramos uma conta ativa com esse usuário.", true);
      return;
    }

    if (mobileInput.matches) {
      usernameForm.elements.username?.blur();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }

    setStatus();
    showPasswordStage(payload.usuario);
  } catch (error) {
    setStatus(error?.message || "Não foi possível localizar a conta.", true);
  } finally {
    submit.disabled = false;
  }
});

passwordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = passwordForm.querySelector('button[type="submit"]');
  const data = new FormData(passwordForm);
  submit.disabled = true;
  setStatus("Entrando…");
  try {
    await api("/api/auth/login", {
      username: String(data.get("username") || "").trim(),
      senha: String(data.get("senha") || "")
    });
    goToAdmin();
  } catch (error) {
    setStatus(error?.message || "Não foi possível entrar.", true);
    passwordForm.elements.senha?.select();
  } finally {
    submit.disabled = false;
  }
});

switchUserButton?.addEventListener("click", () => showUsernameStage());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
}

(async () => {
  const needsSetup = await checkInitialSetup();
  if (!needsSetup) await alreadyAuthenticated();
})();
