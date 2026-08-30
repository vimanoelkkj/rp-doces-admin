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
const passkeyButton = document.querySelector("[data-passkey-login]");
const passwordForm = document.querySelector("[data-password-form]");
const returnParam = new URLSearchParams(location.search).get("return");
const destination = returnParam?.startsWith("/admin/") ? returnParam : "/admin/";

function setStatus(message = "", error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function goToAdmin() {
  location.replace(destination);
}

async function alreadyAuthenticated() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.autenticado) goToAdmin();
  } catch (_) {}
}

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
  } finally {
    submit.disabled = false;
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

alreadyAuthenticated();
