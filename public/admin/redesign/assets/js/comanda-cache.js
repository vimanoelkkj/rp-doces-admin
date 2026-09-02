import { adminApi } from "./api.js";

const originalFetch = window.fetch.bind(window);
const financeCache = new Map();
let warmupPromise = null;
let warmupReady = false;

function requestPath(input) {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function cachedFinanceResponse(order) {
  return new Response(JSON.stringify({ pedido: order }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-RP-Comanda-Cache": "HIT"
    }
  });
}

window.fetch = async function rpComandaCachedFetch(input, init = {}) {
  const url = requestPath(input);
  const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
  const match = url?.origin === window.location.origin && method === "GET"
    ? url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/finance$/)
    : null;
  const bypassCache = url?.searchParams.get("fresh") === "1";

  if (match && !bypassCache) {
    const orderId = Number(match[1]);
    const cached = financeCache.get(orderId);
    if (cached) return cachedFinanceResponse(cached);

    if (warmupPromise) {
      try {
        await warmupPromise;
        const warmed = financeCache.get(orderId);
        if (warmed) return cachedFinanceResponse(warmed);
      } catch {
        // O fetch real abaixo mantém o comportamento normal em caso de falha no aquecimento.
      }
    }
  }

  return originalFetch(input, init);
};

async function warmComandaCache({ force = false } = {}) {
  if (warmupPromise) return warmupPromise;
  if (warmupReady && !force) return;

  warmupPromise = Promise.all([
    adminApi.financialOrders(),
    adminApi.products()
  ])
    .then(([financePayload]) => {
      financeCache.clear();
      const orders = Array.isArray(financePayload?.pedidos) ? financePayload.pedidos : [];
      for (const order of orders) {
        const id = Number(order?.id);
        if (id > 0) financeCache.set(id, order);
      }
      warmupReady = true;
    })
    .finally(() => {
      warmupPromise = null;
    });

  return warmupPromise;
}

function invalidateComandaCache() {
  financeCache.clear();
  warmupReady = false;
}

function ordersVisible(root = document) {
  return Boolean(root.querySelector?.(".orders-details-button") || document.querySelector(".orders-details-button"));
}

function scheduleWarmup() {
  const run = () => void warmComandaCache().catch(() => {});
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 250 });
  } else {
    window.setTimeout(run, 0);
  }
}

function pendingPixFromOrder(order) {
  return (order?.pagamentos || []).find(payment => payment?.metodo === "PIX_MP" && payment?.status === "PENDENTE") || null;
}

function qrImageSource(base64) {
  const value = String(base64 || "").trim();
  if (!value) return "";
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

async function loadPendingPixMetadata(orderId) {
  const response = await originalFetch(`/api/admin/orders/${encodeURIComponent(orderId)}/finance`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
  return pendingPixFromOrder(payload?.pedido);
}

function enhancePendingPix(section) {
  if (!(section instanceof Element) || section.dataset.comandaQrEnhanced === "1") return;
  section.dataset.comandaQrEnhanced = "1";

  const dialog = section.closest("[data-comanda-dialog]");
  const actions = section.querySelector(".comanda-pending-code");
  const orderId = Number(dialog?.dataset?.orderId || 0);
  if (!actions || !Number.isInteger(orderId) || orderId <= 0) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "comanda-mini is-ghost comanda-pending-qr-toggle";
  toggle.dataset.comandaQrToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "Exibir QR Code";

  const qrBox = document.createElement("div");
  qrBox.className = "comanda-pending-qr";
  qrBox.hidden = true;

  actions.append(toggle);
  actions.insertAdjacentElement("afterend", qrBox);

  let loaded = false;
  let loading = false;

  toggle.addEventListener("click", async () => {
    if (loaded) {
      qrBox.hidden = !qrBox.hidden;
      const expanded = !qrBox.hidden;
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "Ocultar QR Code" : "Exibir QR Code";
      return;
    }

    if (loading) return;
    loading = true;
    toggle.disabled = true;
    toggle.textContent = "Carregando QR...";
    qrBox.hidden = false;
    qrBox.innerHTML = '<p class="comanda-pending-qr-status">Buscando QR Code...</p>';

    try {
      const pendingPix = await loadPendingPixMetadata(orderId);
      const src = qrImageSource(pendingPix?.mp_qr_code_base64);
      if (!src) throw new Error("QR Code indisponível para esta cobrança.");

      const image = document.createElement("img");
      image.src = src;
      image.alt = `QR Code Pix do pedido #${orderId}`;
      image.loading = "eager";
      image.decoding = "async";
      qrBox.replaceChildren(image);
      loaded = true;
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "Ocultar QR Code";
    } catch (error) {
      qrBox.innerHTML = `<p class="comanda-pending-qr-status">${String(error?.message || "Não foi possível carregar o QR Code.")}</p>`;
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "Tentar novamente";
    } finally {
      loading = false;
      toggle.disabled = false;
    }
  });
}

function enhanceQrCodes(root = document) {
  if (root.matches?.(".comanda-pending-pix")) enhancePendingPix(root);
  root.querySelectorAll?.(".comanda-pending-pix").forEach(enhancePendingPix);
}

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      enhanceQrCodes(node);
      if (ordersVisible(node)) {
        scheduleWarmup();
      }
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceQrCodes();

window.addEventListener("rp-admin-data-changed", event => {
  const pages = Array.isArray(event?.detail?.pages) ? event.detail.pages : [];
  if (!pages.length || pages.includes("pedidos") || pages.includes("produtos") || pages.includes("dashboard")) {
    invalidateComandaCache();
    if (ordersVisible()) scheduleWarmup();
  }
});

// Começa cedo: quando o usuário chegar em Pedidos, a comanda normalmente já estará em memória.
scheduleWarmup();
