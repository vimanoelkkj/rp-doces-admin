const CACHE_NAME = "rp-admin-offline-v1";
const OFFLINE_URL = "/admin-offline";

// Precacheia SOMENTE a página estática de offline fallback.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Suporta tanto /admin-offline (pretty URL Cloudflare Pages) quanto /admin-offline.html
      const response = await fetch(OFFLINE_URL).catch(() =>
        fetch("/admin-offline.html"),
      );
      if (response && response.ok) {
        await cache.put(OFFLINE_URL, response.clone());
        await cache.put("/admin-offline.html", response);
      }
    }),
  );
  self.skipWaiting();
});

// Remove caches antigos e assume controle imediatamente.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Apenas requisições GET
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // Bypass TOTAL e imediato para qualquer rota de API ou autenticação.
  // Nunca intercepta, nunca toca no CacheStorage.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navegação dentro do escopo administrativo:
  // Tenta rede primeiro (Network-Only para o HTML fresco).
  // Se falhar por queda real de rede, responde com a página estática de offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse =
          (await cache.match(OFFLINE_URL)) ||
          (await cache.match("/admin-offline.html"));
        return cachedResponse || Response.error();
      }),
    );
    return;
  }

  // Quaisquer outros assets (scripts, styles, imagens):
  // O Service Worker NÃO intercepta; o navegador cuida via HTTP cache padrão.
});

// ─────────────────────────────────────────────────────────────
// Web Push Notifications (PWA Admin V2)
// ─────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Novo pedido 🍰", body: event.data.text() };
    }
  }

  const title = data.title || "Novo pedido 🍰";
  const options = {
    body: data.body || "Novo pedido confirmado na loja.",
    icon: "/icons/admin-icon-192.png",
    badge: "/icons/admin-badge-72.png",
    tag: data.tag || (data.pedidoId ? `pedido-${data.pedidoId}` : "novo-pedido"),
    renotify: true,
    data: {
      url: data.url || (data.pedidoId ? `/admin/pedidos?pedido=${data.pedidoId}` : "/admin/pedidos"),
      pedidoId: data.pedidoId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/admin/pedidos";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Se houver uma janela/aba aberta no escopo /admin, foca e navega nela
      for (const client of windowClients) {
        if ("focus" in client && client.url.includes("/admin")) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      // Se não houver janela aberta, abre uma nova
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }),
  );
});
