import type { MouseEvent } from "react";

export const INSTAGRAM_WEB_URL = "https://www.instagram.com/rp.doces_/";
const INSTAGRAM_IOS_URL = "instagram://user?username=rp.doces_";
const INSTAGRAM_ANDROID_URL =
  "intent://instagram.com/_u/rp.doces_/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.instagram.com%2Frp.doces_%2F;end";

// Handler do link do Instagram: no Android e no iOS abre o app (deep link); nos demais ambientes não faz
// nada e o link segue para a versão web (href).
export const openInstagram = (event: MouseEvent<HTMLAnchorElement>) => {
  const userAgent = navigator.userAgent;

  if (/Android/i.test(userAgent)) {
    event.preventDefault();
    window.location.href = INSTAGRAM_ANDROID_URL;
    return;
  }

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    event.preventDefault();

    const fallbackTimer = window.setTimeout(() => {
      window.location.href = INSTAGRAM_WEB_URL;
    }, 1200);

    const stopFallback = () => {
      if (!document.hidden) return;
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", stopFallback);
    };

    document.addEventListener("visibilitychange", stopFallback);
    window.location.href = INSTAGRAM_IOS_URL;
  }
};
