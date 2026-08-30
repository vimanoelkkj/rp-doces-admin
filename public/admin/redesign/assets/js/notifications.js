import { adminApi } from "./api.js";

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (String(value).length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function supported() {
  return Boolean("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
}

export function setupNotificationMenu(button, { onUnauthorized } = {}) {
  if (!button || button.dataset.notificationsReady === "1") return;
  button.dataset.notificationsReady = "1";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const host = button.parentElement;
  const dot = button.querySelector("[data-notifications-dot]");
  const menu = document.createElement("section");
  menu.className = "notifications-menu";
  menu.hidden = true;
  menu.setAttribute("aria-label", "Notificações");
  menu.innerHTML = `
    <div class="notifications-menu__head">
      <strong>Notificações</strong>
      <span>Receba um aviso quando um novo pedido for pago.</span>
    </div>
    <div class="notifications-menu__state" data-notifications-state>
      <strong>Verificando…</strong>
      <span>Aguarde um instante.</span>
    </div>
    <div class="notifications-menu__message" data-notifications-message aria-live="polite"></div>
    <button class="notifications-menu__action" type="button" data-notifications-action disabled>Ativar notificações</button>`;
  host.appendChild(menu);

  const state = menu.querySelector("[data-notifications-state]");
  const message = menu.querySelector("[data-notifications-message]");
  const action = menu.querySelector("[data-notifications-action]");
  let subscription = null;
  let config = null;
  let loading = false;

  const setMessage = (text = "", error = false) => {
    message.textContent = text;
    message.classList.toggle("is-error", error);
  };

  const render = () => {
    const permission = supported() ? Notification.permission : "unsupported";
    const active = Boolean(subscription);
    button.classList.toggle("has-notifications", active);
    if (dot) dot.hidden = !active;
    action.classList.toggle("is-danger", active);

    if (!supported()) {
      state.innerHTML = "<strong>Indisponível neste navegador</strong><span>Este navegador não oferece Web Push.</span>";
      action.disabled = true;
      action.textContent = "Indisponível";
      return;
    }
    if (config && !config.supported) {
      state.innerHTML = "<strong>Push não configurado</strong><span>As chaves VAPID ainda não estão disponíveis no servidor.</span>";
      action.disabled = true;
      action.textContent = "Indisponível";
      return;
    }
    if (permission === "denied") {
      state.innerHTML = "<strong>Bloqueadas pelo navegador</strong><span>Libere as notificações nas permissões deste site.</span>";
      action.disabled = true;
      action.textContent = "Bloqueadas";
      return;
    }
    if (active) {
      state.innerHTML = "<strong>Ativas neste navegador</strong><span>Você receberá avisos de novos pedidos pagos.</span>";
      action.disabled = false;
      action.textContent = "Desativar notificações";
      return;
    }
    state.innerHTML = "<strong>Desativadas neste navegador</strong><span>Ative para receber avisos mesmo com o painel fechado.</span>";
    action.disabled = false;
    action.textContent = "Ativar notificações";
  };

  const refresh = async () => {
    if (loading) return;
    loading = true;
    action.disabled = true;
    try {
      if (!supported()) return render();
      config = await adminApi.pushConfig();
      const registration = await navigator.serviceWorker.getRegistration("/");
      subscription = registration ? await registration.pushManager.getSubscription() : null;
      render();
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      setMessage(error?.message || "Não foi possível verificar as notificações.", true);
      render();
    } finally {
      loading = false;
    }
  };

  const close = () => {
    menu.hidden = true;
    button.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.hidden = false;
    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    refresh();
  };

  button.addEventListener("click", event => {
    event.stopPropagation();
    menu.hidden ? open() : close();
  });

  action.addEventListener("click", async () => {
    if (loading || !supported()) return;
    const wasActive = Boolean(subscription);
    loading = true;
    action.disabled = true;
    setMessage("");
    try {
      if (wasActive) {
        const endpoint = subscription.endpoint;
        await adminApi.unsubscribePush(endpoint);
        await subscription.unsubscribe();
        subscription = null;
        setMessage("Notificações desativadas neste navegador.");
      } else {
        config ||= await adminApi.pushConfig();
        if (!config?.supported || !config?.publicKey) throw new Error("Web Push não está configurado.");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Permissão de notificações não concedida.");
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey)
        });
        const payload = subscription.toJSON();
        await adminApi.subscribePush({ endpoint: payload.endpoint, keys: payload.keys });
        setMessage("Notificações ativadas neste navegador.");
      }
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      if (!wasActive && subscription) {
        try {
          await subscription.unsubscribe();
        } catch {}
        subscription = null;
      }
      setMessage(error?.message || "Não foi possível alterar as notificações.", true);
    } finally {
      loading = false;
      render();
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

  refresh();
}
