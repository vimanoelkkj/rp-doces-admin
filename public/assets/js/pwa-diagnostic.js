window.rpPwaStatus = async function () {
  const result = {
    secureContext: window.isSecureContext,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    manifest: null,
    serviceWorker: null
  };
  try {
    const r = await fetch("/manifest.webmanifest", { cache: "no-store" });
    result.manifest = { ok: r.ok, status: r.status, type: r.headers.get("content-type") };
  } catch (e) {
    result.manifest = { error: String(e) };
  }
  try {
    result.serviceWorker = await navigator.serviceWorker.getRegistration("/");
  } catch (e) {
    result.serviceWorker = { error: String(e) };
  }
  console.table(result);
  return result;
};
