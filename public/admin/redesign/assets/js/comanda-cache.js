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

  if (match) {
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

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (ordersVisible(node)) {
        scheduleWarmup();
        return;
      }
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("rp-admin-data-changed", event => {
  const pages = Array.isArray(event?.detail?.pages) ? event.detail.pages : [];
  if (!pages.length || pages.includes("pedidos") || pages.includes("produtos") || pages.includes("dashboard")) {
    invalidateComandaCache();
    if (ordersVisible()) scheduleWarmup();
  }
});

// Começa cedo: quando o usuário chegar em Pedidos, a comanda normalmente já estará em memória.
scheduleWarmup();
