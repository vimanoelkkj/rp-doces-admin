/// <reference types="vite/client" />

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

let swRegistered = false;

export function useAdminPwa() {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!location.pathname.startsWith("/admin")) return;

    // 1. Injeta o manifesto dinamicamente no <head>
    let manifestLink = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      manifestLink.href = "/admin-manifest.webmanifest";
      manifestLink.setAttribute("data-admin-pwa", "true");
      document.head.appendChild(manifestLink);
    }

    // 2. Injeta apple-touch-icon para dispositivos iOS
    let appleIcon = document.querySelector<HTMLLinkElement>(
      'link[rel="apple-touch-icon"]',
    );
    if (!appleIcon) {
      appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      appleIcon.href = "/icons/apple-touch-icon.png";
      appleIcon.setAttribute("data-admin-pwa", "true");
      document.head.appendChild(appleIcon);
    }

    // 3. Ajusta o theme-color do navegador para o tom escuro do painel
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const originalThemeColor = themeMeta ? themeMeta.content : "#eddcc6";
    if (themeMeta) {
      themeMeta.content = "#1a1412";
    }

    // 4. Registra o Service Worker administrativo com escopo restrito a /admin
    const isSupported = "serviceWorker" in navigator;
    const shouldRegister =
      import.meta.env.PROD || window.location.search.includes("pwa=1");

    if (isSupported && shouldRegister && !swRegistered) {
      swRegistered = true;
      navigator.serviceWorker
        .register("/sw-admin.js", { scope: "/admin" })
        .catch((err) => {
          console.warn("[Admin PWA] Falha ao registrar Service Worker:", err);
          swRegistered = false;
        });
    }

    // 5. Cleanup se o usuário sair do escopo /admin
    return () => {
      if (window.location.pathname.startsWith("/admin")) {
        return;
      }

      if (themeMeta) {
        themeMeta.content = originalThemeColor;
      }

      const injectedManifest = document.querySelector(
        'link[data-admin-pwa="true"][rel="manifest"]',
      );
      injectedManifest?.remove();

      const injectedAppleIcon = document.querySelector(
        'link[data-admin-pwa="true"][rel="apple-touch-icon"]',
      );
      injectedAppleIcon?.remove();
    };
  }, [location.pathname]);
}
