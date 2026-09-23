import { useState, useEffect } from "react";

type PushState = "CHECKING" | "UNSUPPORTED" | "DENIED" | "SUBSCRIBED" | "PROMPT";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationCard() {
  const [status, setStatus] = useState<PushState>("CHECKING");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;

    async function checkStatus() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancel) setStatus("UNSUPPORTED");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancel) setStatus("DENIED");
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancel) return;

        if (sub) {
          setStatus("SUBSCRIBED");
        } else {
          setStatus("PROMPT");
        }
      } catch {
        if (!cancel) setStatus("PROMPT");
      }
    }

    checkStatus();
    return () => {
      cancel = true;
    };
  }, []);

  const handleSubscribe = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setStatus("DENIED");
        setBusy(false);
        return;
      }
      if (permission !== "granted") {
        setStatus("PROMPT");
        setBusy(false);
        return;
      }

      // 1. Busca chave VAPID pública
      const keyRes = await fetch("/api/admin/push/vapid-key");
      if (!keyRes.ok) {
        throw new Error("Não foi possível carregar a chave de notificação do servidor.");
      }
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        throw new Error("Chave de notificação não configurada no servidor.");
      }

      // 2. Inscreve no Service Worker
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });
      }

      // 3. Registra inscrição no backend
      const subJson = sub.toJSON();
      const saveRes = await fetch("/api/admin/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      if (!saveRes.ok) {
        throw new Error("Falha ao salvar inscrição de notificação no servidor.");
      }

      setStatus("SUBSCRIBED");
      setFeedback("Notificações Web Push ativadas com sucesso neste dispositivo.");
    } catch (err: unknown) {
      console.error("Erro ao ativar Web Push:", err);
      setFeedback(err instanceof Error ? err.message : "Erro ao ativar notificações.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/admin/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("PROMPT");
      setFeedback("Notificações desativadas para este dispositivo.");
    } catch (err: unknown) {
      console.error("Erro ao desativar Web Push:", err);
      setFeedback("Erro ao desativar notificações.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "CHECKING") {
    return null;
  }

  return (
    <div className="push-card" data-status={status}>
      <div className="push-card-icon" aria-hidden="true">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 106 8c0 6-3 7-3 7h18s-3-1-3-7" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
      </div>

      <div className="push-card-content">
        <div className="push-card-header">
          <h2 className="push-card-title">Notificações no Dispositivo</h2>
          {status === "SUBSCRIBED" && <span className="push-badge active">Ativadas</span>}
          {status === "DENIED" && <span className="push-badge blocked">Bloqueadas</span>}
          {status === "UNSUPPORTED" && (
            <span className="push-badge unsupported">Não suportadas</span>
          )}
          {status === "PROMPT" && <span className="push-badge prompt">Desativadas</span>}
        </div>

        <p className="push-card-description">
          {status === "SUBSCRIBED" &&
            "Este dispositivo receberá alertas sonoros e visuais assim que novos pedidos forem confirmados, mesmo com o painel fechado."}
          {status === "PROMPT" &&
            "Ative as notificações Web Push para receber alertas imediatos de novos pedidos neste celular ou computador, mesmo com o aplicativo fechado."}
          {status === "DENIED" &&
            "As notificações estão bloqueadas nas configurações do seu navegador. Para ativá-las, clique no ícone de cadeado/configurações ao lado da URL e permita notificações."}
          {status === "UNSUPPORTED" &&
            "Este navegador não possui suporte a Web Push Notifications. No iOS (iPhone/iPad), instale a PWA adicionando este site à Tela de Início para habilitar notificações."}
        </p>

        {feedback && <p className="push-card-feedback">{feedback}</p>}
      </div>

      <div className="push-card-actions">
        {status === "PROMPT" && (
          <button
            type="button"
            className="push-btn primary"
            onClick={handleSubscribe}
            disabled={busy}
          >
            {busy ? "Ativando…" : "Ativar notificações"}
          </button>
        )}

        {status === "SUBSCRIBED" && (
          <button
            type="button"
            className="push-btn outline"
            onClick={handleUnsubscribe}
            disabled={busy}
          >
            {busy ? "Desativando…" : "Desativar"}
          </button>
        )}
      </div>
    </div>
  );
}
