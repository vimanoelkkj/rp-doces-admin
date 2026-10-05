import { useEffect, useState } from "react";
import DatePickerDropdown from "./DatePickerDropdown";
import { type DashboardResponse, formatDateISO, parseDateISO } from "./adminDashboardHelpers";
import DashboardMetrics from "./DashboardMetrics";
import DashboardChart from "./DashboardChart";
import DashboardRecentOrders from "./DashboardRecentOrders";
import "./AdminDashboard.css";

/* ── Icon components (preservados aqui para conformidade com admin-svg-accessibility) ── */
export const IconShield = () => (
  <svg
    aria-hidden="true"
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

export const IconAlert = () => (
  <svg
    aria-hidden="true"
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

/* ── Component ── */
export default function AdminDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  // null = "hoje" da loja, decidido pelo backend (não pelo relógio/fuso do
  // navegador). Uma data escolhida no calendário é enviada explicitamente.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () => setRefreshKey(key => key + 1);
    window.addEventListener("pedido-anulado", atualizar);
    return () => window.removeEventListener("pedido-anulado", atualizar);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey é gatilho manual: "pedido-anulado" o incrementa para refazer o fetch
  useEffect(() => {
    setLoading(true);
    fetch(selectedDate ? `/api/admin/dashboard?date=${selectedDate}` : "/api/admin/dashboard")
      .then(async response => {
        if (!response.ok) throw new Error("Falha ao carregar dashboard");
        return response.json() as Promise<DashboardResponse>;
      })
      .then(result => {
        setData(result);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedDate, refreshKey]);

  const hojeLoja = data?.hoje ?? null;
  const dataExibida = selectedDate ?? hojeLoja;
  const exibindoHoje = selectedDate === null || selectedDate === hojeLoja;

  return (
    <main className="admin-main">
      {/* ── Header row ── */}
      <div className="dash-header-row">
        <div className="dash-title-group">
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">Visão geral das operações da R&P Doces</p>
        </div>
        <div className="dash-header-actions">
          <DatePickerDropdown
            // Antes da primeira resposta ainda não há "hoje" da loja; o
            // relógio local é só um placeholder visual até ela chegar.
            value={dataExibida ? parseDateISO(dataExibida) : new Date()}
            today={hojeLoja ? parseDateISO(hojeLoja) : undefined}
            onChange={d => setSelectedDate(formatDateISO(d))}
          />
          <button type="button" className="dash-btn-today" onClick={() => setSelectedDate(null)}>
            Hoje
          </button>
        </div>
      </div>

      {/* ── Results banner ── */}
      <div className="dash-results-banner">
        <span className="dash-results-bold">Resultados por dia</span>
        <span className="dash-results-dot" />
        <span className="dash-results-light">
          {exibindoHoje || !dataExibida
            ? "Atualizado em tempo real"
            : `Dados de ${dataExibida.split("-").reverse().join("/")}`}
        </span>
      </div>

      {error && <p className="dash-error">{error}</p>}

      <DashboardMetrics data={data} />

      <DashboardChart data={data} loading={loading} />

      <DashboardRecentOrders orders={data?.pedidosRecentes} loading={loading} />
    </main>
  );
}
