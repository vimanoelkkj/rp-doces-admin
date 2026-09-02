const DAY_MS = 86_400_000;
let selectedDate = localDateValue(new Date());
let refreshToken = 0;

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromValue(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDate(value, days) {
  const date = dateFromValue(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function money(cents = 0) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function dayLabel(value) {
  const date = dateFromValue(value);
  if (!date) return value;
  const today = localDateValue(new Date());
  const yesterday = shiftDate(today, -1);
  if (value === today) return "Hoje";
  if (value === yesterday) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(date);
}

function metric(label, value, detail, featured = false) {
  return `<article class="dashboard-history__metric${featured ? " is-featured" : ""}">
    <span>${label}</span>
    <strong>${value}</strong>
    <small>${detail}</small>
  </article>`;
}

function loadingMetrics() {
  return Array.from({ length: 5 }, () => '<span class="dashboard-history__skeleton"></span>').join("");
}

function panelMarkup() {
  const today = localDateValue(new Date());
  return `<section class="admin-panel dashboard-history" data-dashboard-history>
    <header class="dashboard-history__head">
      <div>
        <strong>Resultados por dia</strong>
        <span data-dashboard-history-label>${dayLabel(selectedDate)}</span>
      </div>
      <div class="dashboard-history__controls">
        <button type="button" data-dashboard-history-prev aria-label="Dia anterior">‹</button>
        <input type="date" value="${selectedDate}" max="${today}" data-dashboard-history-date aria-label="Escolher data" />
        <button type="button" data-dashboard-history-next aria-label="Próximo dia" ${selectedDate >= today ? "disabled" : ""}>›</button>
        <button type="button" class="dashboard-history__today" data-dashboard-history-today ${selectedDate === today ? "disabled" : ""}>Hoje</button>
      </div>
    </header>
    <div class="dashboard-history__metrics" data-dashboard-history-metrics>${loadingMetrics()}</div>
  </section>`;
}

async function fetchMetrics(date) {
  const response = await fetch(`/api/admin/dashboard/metrics?date=${encodeURIComponent(date)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
  return payload;
}

function renderMetrics(panel, data) {
  const root = panel.querySelector("[data-dashboard-history-metrics]");
  if (!root) return;
  const paidOrders = Number(data?.pedidos_quitados || 0);
  const payments = Number(data?.pagamentos_confirmados || 0);
  const items = Number(data?.itens_vendidos || 0);
  const created = Number(data?.pedidos_criados || 0);

  root.innerHTML = [
    metric("Recebido", money(data?.recebido_centavos), `${payments} pagamento${payments === 1 ? " confirmado" : "s confirmados"}`, true),
    metric("Vendas quitadas", money(data?.vendas_quitadas_centavos), `Ticket médio ${money(data?.ticket_medio_centavos)}`),
    metric("Pedidos quitados", String(paidOrders), "Comandas totalmente pagas no dia"),
    metric("Itens vendidos", String(items), "Unidades em pedidos quitados"),
    metric("Pedidos criados", String(created), "Novos pedidos não cancelados")
  ].join("");
}

function renderError(panel, message) {
  const root = panel.querySelector("[data-dashboard-history-metrics]");
  if (!root) return;
  root.innerHTML = `<div class="dashboard-history__error"><strong>Não foi possível carregar esse dia.</strong><span>${String(message || "Tente novamente.")}</span></div>`;
}

async function loadSelectedDate(panel) {
  const token = ++refreshToken;
  const root = panel.querySelector("[data-dashboard-history-metrics]");
  const input = panel.querySelector("[data-dashboard-history-date]");
  const label = panel.querySelector("[data-dashboard-history-label]");
  const next = panel.querySelector("[data-dashboard-history-next]");
  const todayButton = panel.querySelector("[data-dashboard-history-today]");
  const today = localDateValue(new Date());

  if (root) root.innerHTML = loadingMetrics();
  if (input) input.value = selectedDate;
  if (label) label.textContent = dayLabel(selectedDate);
  if (next) next.disabled = selectedDate >= today;
  if (todayButton) todayButton.disabled = selectedDate === today;

  try {
    const data = await fetchMetrics(selectedDate);
    if (token !== refreshToken || !panel.isConnected) return;
    renderMetrics(panel, data);
  } catch (error) {
    if (token !== refreshToken || !panel.isConnected) return;
    renderError(panel, error?.message);
  }
}

function bindPanel(panel) {
  panel.querySelector("[data-dashboard-history-prev]")?.addEventListener("click", () => {
    selectedDate = shiftDate(selectedDate, -1);
    void loadSelectedDate(panel);
  });

  panel.querySelector("[data-dashboard-history-next]")?.addEventListener("click", () => {
    const today = localDateValue(new Date());
    const next = shiftDate(selectedDate, 1);
    selectedDate = next > today ? today : next;
    void loadSelectedDate(panel);
  });

  panel.querySelector("[data-dashboard-history-today]")?.addEventListener("click", () => {
    selectedDate = localDateValue(new Date());
    void loadSelectedDate(panel);
  });

  panel.querySelector("[data-dashboard-history-date]")?.addEventListener("change", event => {
    const value = String(event.currentTarget?.value || "");
    const today = localDateValue(new Date());
    if (!dateFromValue(value)) return;
    selectedDate = value > today ? today : value;
    void loadSelectedDate(panel);
  });
}

function enhanceDashboard(root = document) {
  const dashboard = root.matches?.(".dashboard") ? root : root.querySelector?.(".dashboard");
  if (!dashboard || dashboard.querySelector("[data-dashboard-history]")) return;
  const metrics = dashboard.querySelector(".dashboard-metrics");
  if (!metrics) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = panelMarkup();
  const panel = wrapper.firstElementChild;
  metrics.before(panel);
  bindPanel(panel);
  void loadSelectedDate(panel);
}

function installStyles() {
  if (document.getElementById("rp-dashboard-history-style")) return;
  const style = document.createElement("style");
  style.id = "rp-dashboard-history-style";
  style.textContent = `
    .dashboard-history{overflow:hidden}
    .dashboard-history__head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid var(--rp-line)}
    .dashboard-history__head>div:first-child strong,.dashboard-history__head>div:first-child span{display:block}
    .dashboard-history__head>div:first-child strong{font-family:var(--rp-display);font-size:15px}
    .dashboard-history__head>div:first-child span{margin-top:2px;color:var(--rp-ink-3);font-size:10.5px;text-transform:capitalize}
    .dashboard-history__controls{display:flex;align-items:center;gap:6px}
    .dashboard-history__controls button,.dashboard-history__controls input{min-height:34px;border:1px solid var(--rp-line-2);border-radius:10px;background:var(--rp-surface);color:var(--rp-ink-2);font:inherit;font-size:10.5px;font-weight:800}
    .dashboard-history__controls button{min-width:34px;padding:0 10px;cursor:pointer}
    .dashboard-history__controls input{padding:0 9px}
    .dashboard-history__controls button:hover:not(:disabled){border-color:color-mix(in oklch,var(--rp-pink) 36%,var(--rp-line-2));background:var(--rp-pink-wash);color:var(--rp-pink-strong)}
    .dashboard-history__controls button:disabled{opacity:.45;cursor:default}
    .dashboard-history__metrics{display:grid;grid-template-columns:1.35fr repeat(4,minmax(130px,1fr));gap:0}
    .dashboard-history__metric{min-width:0;padding:15px 16px;border-left:1px solid var(--rp-line);background:var(--rp-surface)}
    .dashboard-history__metric:first-child{border-left:0}
    .dashboard-history__metric span,.dashboard-history__metric strong,.dashboard-history__metric small{display:block}
    .dashboard-history__metric span{color:var(--rp-ink-3);font-size:9.5px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}
    .dashboard-history__metric strong{margin-top:5px;font-family:var(--rp-display);font-size:22px;line-height:1.05}
    .dashboard-history__metric small{margin-top:5px;color:var(--rp-ink-3);font-size:9.5px;line-height:1.25}
    .dashboard-history__metric.is-featured{background:color-mix(in oklch,var(--rp-surface) 76%,var(--rp-pink-wash))}
    .dashboard-history__metric.is-featured strong{color:var(--rp-pink-strong);font-size:27px}
    .dashboard-history__skeleton{min-height:92px;border-left:1px solid var(--rp-line);background:linear-gradient(100deg,#f4e9e4 25%,#fff7f4 43%,#f4e9e4 61%);background-size:250% 100%;animation:dashboard-shimmer 1.2s linear infinite}
    .dashboard-history__error{grid-column:1/-1;display:grid;gap:3px;padding:18px 16px;text-align:center}.dashboard-history__error strong{font-size:11.5px}.dashboard-history__error span{color:var(--rp-ink-3);font-size:10px}
    @media(max-width:1050px){.dashboard-history__metrics{grid-template-columns:repeat(3,1fr)}.dashboard-history__metric:nth-child(4){border-left:0}.dashboard-history__metric{border-top:1px solid var(--rp-line)}.dashboard-history__metric:nth-child(-n+3){border-top:0}}
    @media(max-width:700px){.dashboard-history__head{align-items:flex-start;flex-direction:column}.dashboard-history__controls{width:100%;display:grid;grid-template-columns:34px minmax(0,1fr) 34px auto}.dashboard-history__controls input{width:100%;min-width:0}.dashboard-history__metrics{grid-template-columns:repeat(2,1fr)}.dashboard-history__metric{border-top:1px solid var(--rp-line)}.dashboard-history__metric:nth-child(odd){border-left:0}.dashboard-history__metric:nth-child(-n+2){border-top:0}.dashboard-history__metric.is-featured{grid-column:1/-1;border-top:0}.dashboard-history__metric.is-featured+ .dashboard-history__metric{border-left:0}}
  `;
  document.head.appendChild(style);
}

installStyles();
enhanceDashboard();

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      enhanceDashboard(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("rp-admin-data-changed", event => {
  const pages = Array.isArray(event?.detail?.pages) ? event.detail.pages : [];
  if (pages.length && !pages.includes("dashboard")) return;
  const panel = document.querySelector("[data-dashboard-history]");
  if (panel) void loadSelectedDate(panel);
});
