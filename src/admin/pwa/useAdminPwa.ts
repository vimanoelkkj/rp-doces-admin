/// <reference types="vite/client" />

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

let swRegistered = false;

const HEADER_LIGHT_THEME_COLOR = "#eddcc6";
const HEADER_DARK_THEME_COLOR = "#271f1b";

function getStorefrontThemeColor() {
  const themeAttr = document.documentElement.getAttribute("data-theme");
  const savedTheme =
    window.localStorage.getItem("store-theme") ||
    window.localStorage.getItem("admin-theme");
  const isDark =
    themeAttr === "dark" || (themeAttr === null && savedTheme === "dark");

  return isDark ? HEADER_DARK_THEME_COLOR : HEADER_LIGHT_THEME_COLOR;
}

function getAdminThemeColor() {
  const themeAttr =
    document.documentElement.getAttribute("data-admin-theme") ||
    document.documentElement.getAttribute("data-theme");
  const savedTheme =
    window.localStorage.getItem("admin-theme") ||
    window.localStorage.getItem("store-theme");
  const isDark =
    themeAttr === "dark" || (themeAttr === null && savedTheme === "dark");

  return isDark ? HEADER_DARK_THEME_COLOR : HEADER_LIGHT_THEME_COLOR;
}

export function useAdminPwa() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAdminRoute) return;

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

    // 3. Mantém a status bar do PWA sincronizada com o tema do Admin.
    // O tema claro usa exatamente a cor do header mobile.
    let themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      themeMeta.setAttribute("data-admin-pwa", "true");
      document.head.appendChild(themeMeta);
    }

    const syncThemeColor = () => {
      if (themeMeta) {
        themeMeta.content = getAdminThemeColor();
      }
    };

    syncThemeColor();

    const themeObserver = new MutationObserver(syncThemeColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-admin-theme", "data-theme"],
    });

    // 4. Registra o Service Worker administrativo com escopo restrito a /admin
    const isSupported = "serviceWorker" in navigator;
    const shouldRegister =
      import.meta.env.PROD || window.location.search.includes("pwa=1");

    if (isSupported && shouldRegister) {
      if (!swRegistered) {
        swRegistered = true;
        navigator.serviceWorker
          .register("/sw-admin.js", { scope: "/admin" })
          .then((reg) => {
            // Força verificação ativa de atualização no primeiro registro
            reg.update().catch(() => {});
          })
          .catch((err) => {
            console.warn("[Admin PWA] Falha ao registrar Service Worker:", err);
            swRegistered = false;
          });
      } else {
        // Se já registrado nesta sessão, garante verificação de update do SW
        navigator.serviceWorker.getRegistration("/admin").then((reg) => {
          reg?.update().catch(() => {});
        });
      }
    }

    // 5. Cleanup ao sair do escopo /admin.
    // Em transições internas (/admin -> /admin/login), mantém os metadados,
    // mas sempre encerra o observer desta instância do hook.
    return () => {
      themeObserver.disconnect();

      if (window.location.pathname.startsWith("/admin")) {
        return;
      }

      if (themeMeta) {
        themeMeta.content = getStorefrontThemeColor();
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
  }, [isAdminRoute]);
}
