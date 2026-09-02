import { adminApi } from "./api.js";

let financialInFlight = null;
const originalFinancialOrders = adminApi.financialOrders.bind(adminApi);
const originalOrders = adminApi.orders.bind(adminApi);

function getFinancialOrdersShared() {
  if (financialInFlight) return financialInFlight;
  financialInFlight = originalFinancialOrders().finally(() => {
    financialInFlight = null;
  });
  return financialInFlight;
}

adminApi.financialOrders = getFinancialOrdersShared;

function dashboardIsLoading() {
  return Boolean(document.querySelector("[data-admin-content] .dashboard-loading"));
}

adminApi.orders = async (...args) => {
  if (!dashboardIsLoading()) return originalOrders(...args);

  void originalOrders(...args).catch(() => {});
  return { pedidos: [] };
};

function warmDashboard() {
  void getFinancialOrdersShared().catch(() => {});
  void adminApi.products().catch(() => {});
}

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

warmDashboard();
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
