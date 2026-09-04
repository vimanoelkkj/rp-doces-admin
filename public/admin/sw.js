const CACHE = "rp-admin-shell-v3";
const SHELL = [
  "/admin/",
  "/admin/login.html",
  "/admin/manifest.webmanifest",
  "/admin-favicon.png",
  "/admin-apple-touch-icon.png",
  "/admin/assets/css/pwa-login.css",
  "/admin/assets/js/pwa-login.js",
  "/admin/redesign/assets/css/app.css",
  "/admin/redesign/assets/css/responsive-qa.css",
  "/admin/redesign/assets/css/pwa-shell.css",
  "/admin/redesign/assets/css/manual-orders-rescue.css",
  "/admin/redesign/assets/css/sidebar-badges-help.css",
  "/admin/redesign/assets/js/app.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("rp-admin-shell-") && key !== CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (!url.pathname.startsWith("/admin/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match(request)) ||
            (await caches.match("/admin/")) ||
            (await caches.match("/admin/login.html"))
          );
        })
    );
    return;
  }

  // O redesign muda com frequência durante o desenvolvimento. CSS e JS precisam
  // consultar a rede primeiro para não manter uma interface antiga presa no cache.
  if (url.pathname.startsWith("/admin/redesign/assets/")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
