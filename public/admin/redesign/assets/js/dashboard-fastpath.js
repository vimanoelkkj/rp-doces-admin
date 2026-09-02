import { adminApi } from "./api.js";

const originalFinancialOrders = adminApi.financialOrders.bind(adminApi);
const originalOrders = adminApi.orders.bind(adminApi);
const originalProducts = adminApi.products.bind(adminApi);

let summaryInFlight = null;
let dashboardWindowUntil = 0;

function dashboardIsLoading() {
  return Boolean(document.querySelector("[data-admin-content] .dashboard-loading"));
}

function dashboardIsVisible() {
  return Boolean(document.querySelector("[data-admin-content] .dashboard"));
}

function dashboardFastPathActive() {
  return dashboardIsLoading() || dashboardIsVisible() || Date.now() < dashboardWindowUntil;
}

async function fetchDashboardSummary() {
  const response = await fetch("/api/admin/dashboard/summary", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = (response.headers.get("content-type") || "").includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    const error = new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload || { pedidos: [], produtos: [] };
}

function getDashboardSummaryShared() {
  if (summaryInFlight) return summaryInFlight;
  summaryInFlight = fetchDashboardSummary().finally(() => {
    summaryInFlight = null;
  });
  return summaryInFlight;
}

adminApi.orders = async (...args) => {
  if (!dashboardIsLoading()) return originalOrders(...args);

  dashboardWindowUntil = Date.now() + 2500;
  void getDashboardSummaryShared().catch(() => {});
  return { pedidos: [] };
};

adminApi.financialOrders = async (...args) => {
  if (!dashboardFastPathActive()) return originalFinancialOrders(...args);
  const payload = await getDashboardSummaryShared();
  return { pedidos: payload?.pedidos || [] };
};

adminApi.products = async (...args) => {
  if (!dashboardFastPathActive()) return originalProducts(...args);
  const payload = await getDashboardSummaryShared();
  return { produtos: payload?.produtos || [] };
};

function alignCancelledRecentOrders(root = document) {
  const rows = root.querySelectorAll?.(".dashboard-order") || [];
  for (const row of rows) {
    const statusCells = row.querySelectorAll(".status-pill");
    if (statusCells.length < 2) continue;

    const payment = statusCells[0];
    const delivery = statusCells[1];
    if (String(delivery.textContent || "").trim().toLowerCase() !== "cancelado") continue;

    payment.textContent = "Cancelado";
    payment.dataset.tone = "danger";
  }
}

alignCancelledRecentOrders();

const observer = new MutationObserver(records => {
  for (const record of records) {
    if ([...record.addedNodes].some(node => node instanceof Element)) {
      alignCancelledRecentOrders();
      break;
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
