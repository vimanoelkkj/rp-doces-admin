import AdminSidebar from "../components/AdminSidebar";
import "./AdminDashboard.css";

/* ── Icon components ── */
const IconCalendar = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="#634738"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M5 1.5v3M11 1.5v3M2 7h12" />
  </svg>
);

const IconShield = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#8c7a76"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2l8 4v6c0 5.5-3.8 8.2-8 10-4.2-1.8-8-4.5-8-10V6l8-4Z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const IconAlert = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="#c28343"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.57 3.22 1.75 15a1.5 1.5 0 0 0 1.3 2.25h13.68a1.5 1.5 0 0 0 1.3-2.25L11.43 3.22a1.5 1.5 0 0 0-2.66 0Z" />
    <path d="M10 8v3M10 14h.01" />
  </svg>
);

/* ── Data types ── */
interface KpiCard {
  label: string;
  value: string;
  description: string;
  warning?: { dot: string; text: string };
}

interface RankItem {
  rank: number;
  name: string;
  units: string;
  percent: number; // 0–100
}

interface OrderRow {
  id: string;
  client: string;
  items: string;
  payment: string;
  paymentColor: string;
  status: string;
  statusColor: string;
  total: string;
}

/* ── Static data (matching Figma) ── */
const kpis: KpiCard[] = [
  {
    label: "Recebido hoje",
    value: "R$ 0,00",
    description: "0 pagamentos confirmados",
  },
  {
    label: "A receber",
    value: "R$ 0,00",
    description: "0 faturamentos agendados",
  },
  {
    label: "Comandas abertas",
    value: "0",
    description: "Nenhuma mesa em atendimento",
  },
  {
    label: "Aguardando preparo",
    value: "0",
    description: "Todos os pedidos já despachados",
  },
  {
    label: "Catálogo",
    value: "5",
    description: "",
    warning: { dot: "#c28343", text: "2 estoque baixo" },
  },
];

const bestSellers: RankItem[] = [
  { rank: 1, name: "Ninho & Nutella 🍫", units: "7 un.", percent: 58 },
  { rank: 2, name: "Tentação de maracujá 💛", units: "7 un.", percent: 58 },
  { rank: 3, name: "Prestígio cremoso 🥥", units: "6 un.", percent: 51 },
  {
    rank: 4,
    name: "Encanto de frutas vermelhas 🍓",
    units: "5 un.",
    percent: 44,
  },
];

const recentOrders: OrderRow[] = [
  {
    id: "RP-33",
    client: "Mariana Alvarenga",
    items: "2 itens",
    payment: "Pago",
    paymentColor: "green",
    status: "Entregue",
    statusColor: "green",
    total: "R$ 41,50",
  },
  {
    id: "RP-32",
    client: "Nathália da Luz",
    items: "2 itens",
    payment: "Pago",
    paymentColor: "green",
    status: "Entregue",
    statusColor: "green",
    total: "R$ 41,50",
  },
  {
    id: "RP-31",
    client: "Maria Eduarda",
    items: "1 item",
    payment: "Pago",
    paymentColor: "green",
    status: "Entregue",
    statusColor: "green",
    total: "R$ 18,50",
  },
  {
    id: "RP-22",
    client: "Bianca Pacheco",
    items: "1 item",
    payment: "Pago",
    paymentColor: "green",
    status: "Entregue",
    statusColor: "green",
    total: "R$ 18,50",
  },
];

/* ── Helper: today's date ── */
function getTodayFormatted(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/* ── Component ── */
export default function AdminDashboard() {
  return (
    <div className="admin-layout">
      <AdminSidebar />

      <main className="admin-main">
        {/* ── Header row ── */}
        <div className="dash-header-row">
          <div className="dash-title-group">
            <h1 className="dash-title">Dashboard</h1>
            <p className="dash-subtitle">
              Visão geral das operações da R&P Doces
            </p>
          </div>
          <div className="dash-header-actions">
            <button className="dash-date-picker">
              <IconCalendar />
              <span>{getTodayFormatted()}</span>
            </button>
            <button className="dash-btn-today">Hoje</button>
          </div>
        </div>

        {/* ── Results banner ── */}
        <div className="dash-results-banner">
          <span className="dash-results-bold">Resultados por dia</span>
          <span className="dash-results-dot" />
          <span className="dash-results-light">Atualizado em tempo real</span>
        </div>

        {/* ── KPI strip ── */}
        <div className="dash-kpi-strip">
          {kpis.map((kpi) => (
            <div className="dash-kpi-card" key={kpi.label}>
              <span className="dash-kpi-label">{kpi.label}</span>
              <div className="dash-kpi-value-group">
                <span className="dash-kpi-value">{kpi.value}</span>
                {kpi.description && (
                  <span className="dash-kpi-desc">{kpi.description}</span>
                )}
                {kpi.warning && (
                  <div className="dash-kpi-warning">
                    <span
                      className="dash-kpi-warning-dot"
                      style={{ background: kpi.warning.dot }}
                    />
                    <span className="dash-kpi-warning-text">
                      {kpi.warning.text}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Split row ── */}
        <div className="dash-split-row">
          {/* Best sellers */}
          <div className="dash-panel dash-best-sellers">
            <div className="dash-panel-title-group">
              <h2 className="dash-panel-title">
                Sabores de bolo mais vendidos
              </h2>
              <p className="dash-panel-subtitle">
                Métricas de vendas acumuladas no período selecionado
              </p>
            </div>
            <div className="dash-ranked-list">
              {bestSellers.map((item) => (
                <div className="dash-rank-row" key={item.rank}>
                  <div className="dash-rank-meta">
                    <div className="dash-rank-label">
                      <span className="dash-rank-number">{item.rank}</span>
                      <span className="dash-rank-name">{item.name}</span>
                    </div>
                    <span className="dash-rank-units">{item.units}</span>
                  </div>
                  <div className="dash-progress-track">
                    <div
                      className="dash-progress-fill"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="dash-right-col">
            {/* Pending payments */}
            <div className="dash-panel dash-pending-payments">
              <div className="dash-panel-header-row">
                <h2 className="dash-panel-title">Pagamentos pendentes</h2>
                <span className="dash-pending-value">R$ 0,00</span>
              </div>
              <div className="dash-empty-state">
                <IconShield />
                <span className="dash-empty-title">Nenhum valor pendente</span>
                <span className="dash-empty-desc">
                  Excelente! Todas as comandas abertas já foram resolvidas.
                </span>
              </div>
            </div>

            {/* Attention panel */}
            <div className="dash-panel dash-attention">
              <h2 className="dash-panel-title">Precisa de atenção</h2>
              <div className="dash-alert-box">
                <IconAlert />
                <div className="dash-alert-text">
                  <span className="dash-alert-bold">
                    2 produtos com estoque baixo
                  </span>
                  <span className="dash-alert-desc">
                    Verifique os ingredientes no painel de insumos.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recent orders ── */}
        <div className="dash-panel dash-recent-orders">
          <div className="dash-orders-header">
            <div className="dash-orders-title-group">
              <h2 className="dash-orders-title">Pedidos recentes</h2>
              <p className="dash-orders-subtitle">
                Últimos pedidos registrados no sistema hoje
              </p>
            </div>
            <button className="dash-btn-view-all">Ver todos os pedidos</button>
          </div>

          <div className="dash-orders-table">
            <div className="dash-table-header">
              <span className="dash-th dash-th-id">ID</span>
              <span className="dash-th dash-th-client">Cliente</span>
              <span className="dash-th dash-th-items">Itens</span>
              <span className="dash-th dash-th-payment">Pagamento</span>
              <span className="dash-th dash-th-status">Status</span>
              <span className="dash-th dash-th-total">Total</span>
            </div>

            {recentOrders.map((order) => (
              <div className="dash-table-row" key={order.id}>
                <span className="dash-td dash-td-id">{order.id}</span>
                <span className="dash-td dash-td-client">{order.client}</span>
                <span className="dash-td dash-td-items">{order.items}</span>
                <span className="dash-td dash-td-payment">
                  <span className="dash-badge dash-badge--green">
                    {order.payment}
                  </span>
                </span>
                <span className="dash-td dash-td-status">
                  <span className="dash-badge dash-badge--green">
                    {order.status}
                  </span>
                </span>
                <span className="dash-td dash-td-total">{order.total}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
