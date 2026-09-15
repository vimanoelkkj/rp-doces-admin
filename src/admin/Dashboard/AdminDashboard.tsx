import { useEffect, useState } from "react";
import DatePickerDropdown from "./DatePickerDropdown";
import "./AdminDashboard.css";

/* ── Icon components ── */
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

/* ── Types (espelham o retorno de GET /api/admin/dashboard) ── */
type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

interface ValorContagem {
  count: number;
  total: number;
}

interface MaisVendidoRow {
  nome: string;
  emoji: string | null;
  unidades: number;
}

interface PedidoRecenteRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: StatusPedido;
  itens_count: number;
}

interface DashboardResponse {
  data: string;
  recebidoHoje: ValorContagem;
  aReceber: ValorContagem;
  comandasAbertas: number;
  aguardandoPreparo: number;
  catalogo: { total: number; estoqueBaixo: number };
  maisVendidos: MaisVendidoRow[];
  pedidosRecentes: PedidoRecenteRow[];
}

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

function formatDateISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const statusLabel = (s: StatusPedido) =>
  s === "ENTREGUE"
    ? "Entregue"
    : s === "PRONTO"
      ? "Pronto"
      : "Em produção";

const statusClass = (s: StatusPedido) =>
  s === "ENTREGUE"
    ? "dash-badge--green"
    : s === "PRONTO"
      ? "dash-badge--blue"
      : "dash-badge--orange";

function isToday(d: Date): boolean {
  const now = new Date();
  return formatDateISO(d) === formatDateISO(now);
}

/* ── Component ── */
export default function AdminDashboard() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/dashboard?date=${formatDateISO(selectedDate)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar dashboard");
        return response.json() as Promise<DashboardResponse>;
      })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const maiorVendido = data?.maisVendidos.reduce(
    (max, item) => Math.max(max, item.unidades),
    0,
  );

  return (
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
            <DatePickerDropdown value={selectedDate} onChange={setSelectedDate} />
            <button
              className="dash-btn-today"
              onClick={() => setSelectedDate(new Date())}
            >
              Hoje
            </button>
          </div>
        </div>

        {/* ── Results banner ── */}
        <div className="dash-results-banner">
          <span className="dash-results-bold">Resultados por dia</span>
          <span className="dash-results-dot" />
          <span className="dash-results-light">
            {isToday(selectedDate)
              ? "Atualizado em tempo real"
              : `Dados de ${formatDateISO(selectedDate).split("-").reverse().join("/")}`}
          </span>
        </div>

        {error && <p className="dash-error">{error}</p>}

        {/* ── KPI strip ── */}
        <div className="dash-kpi-strip">
          <div className="dash-kpi-card">
            <span className="dash-kpi-label">Recebido hoje</span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">
                {formatarPreco(data?.recebidoHoje.total ?? 0)}
              </span>
              <span className="dash-kpi-desc">
                {data?.recebidoHoje.count ?? 0} pagamento(s) confirmado(s)
              </span>
            </div>
          </div>
          <div className="dash-kpi-card">
            <span className="dash-kpi-label">A receber</span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">
                {formatarPreco(data?.aReceber.total ?? 0)}
              </span>
              <span className="dash-kpi-desc">
                {data?.aReceber.count ?? 0} faturamento(s) agendado(s)
              </span>
            </div>
          </div>
          <div className="dash-kpi-card">
            <span className="dash-kpi-label">Comandas abertas</span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">
                {data?.comandasAbertas ?? 0}
              </span>
              <span className="dash-kpi-desc">
                {!data || data.comandasAbertas === 0
                  ? "Nenhuma mesa em atendimento"
                  : `${data.comandasAbertas} comanda(s) em atendimento`}
              </span>
            </div>
          </div>
          <div className="dash-kpi-card">
            <span className="dash-kpi-label">Aguardando preparo</span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">
                {data?.aguardandoPreparo ?? 0}
              </span>
              <span className="dash-kpi-desc">
                {!data || data.aguardandoPreparo === 0
                  ? "Todos os pedidos já despachados"
                  : `${data.aguardandoPreparo} pedido(s) aguardando`}
              </span>
            </div>
          </div>
          <div className="dash-kpi-card">
            <span className="dash-kpi-label">Catálogo</span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">{data?.catalogo.total ?? 0}</span>
              {data && data.catalogo.estoqueBaixo > 0 && (
                <div className="dash-kpi-warning">
                  <span
                    className="dash-kpi-warning-dot"
                    style={{ background: "#c28343" }}
                  />
                  <span className="dash-kpi-warning-text">
                    {data.catalogo.estoqueBaixo} estoque baixo
                  </span>
                </div>
              )}
            </div>
          </div>
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
            {!loading && data && data.maisVendidos.length === 0 && (
              <p className="dash-empty-inline">
                Nenhuma venda registrada nesse dia.
              </p>
            )}
            <div className="dash-ranked-list">
              {data?.maisVendidos.map((item, i) => (
                <div className="dash-rank-row" key={item.nome}>
                  <div className="dash-rank-meta">
                    <div className="dash-rank-label">
                      <span className="dash-rank-number">{i + 1}</span>
                      <span className="dash-rank-name">
                        {item.nome} {item.emoji}
                      </span>
                    </div>
                    <span className="dash-rank-units">{item.unidades} un.</span>
                  </div>
                  <div className="dash-progress-track">
                    <div
                      className="dash-progress-fill"
                      style={{
                        width: `${maiorVendido ? (item.unidades / maiorVendido) * 100 : 0}%`,
                      }}
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
                <span className="dash-pending-value">
                  {formatarPreco(data?.aReceber.total ?? 0)}
                </span>
              </div>
              {!data || data.aReceber.count === 0 ? (
                <div className="dash-empty-state">
                  <IconShield />
                  <span className="dash-empty-title">
                    Nenhum valor pendente
                  </span>
                  <span className="dash-empty-desc">
                    Excelente! Todas as comandas abertas já foram resolvidas.
                  </span>
                </div>
              ) : (
                <div className="dash-alert-box">
                  <IconAlert />
                  <div className="dash-alert-text">
                    <span className="dash-alert-bold">
                      {data.aReceber.count} pagamento(s) pendente(s)
                    </span>
                    <span className="dash-alert-desc">
                      Aguardando confirmação do Pix.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Attention panel */}
            <div className="dash-panel dash-attention">
              <h2 className="dash-panel-title">Precisa de atenção</h2>
              {data && data.catalogo.estoqueBaixo > 0 ? (
                <div className="dash-alert-box">
                  <IconAlert />
                  <div className="dash-alert-text">
                    <span className="dash-alert-bold">
                      {data.catalogo.estoqueBaixo} produto(s) com estoque baixo
                    </span>
                    <span className="dash-alert-desc">
                      Verifique os ingredientes no painel de insumos.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="dash-empty-state">
                  <IconShield />
                  <span className="dash-empty-title">Tudo em dia</span>
                  <span className="dash-empty-desc">
                    Nenhum produto com estoque baixo no momento.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Recent orders ── */}
        <div className="dash-panel dash-recent-orders">
          <div className="dash-orders-header">
            <div className="dash-orders-title-group">
              <h2 className="dash-orders-title">Pedidos recentes</h2>
              <p className="dash-orders-subtitle">
                Últimos pedidos registrados no sistema nesse dia
              </p>
            </div>
            <a className="dash-btn-view-all" href="/admin/pedidos">
              Ver todos os pedidos
            </a>
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

            {!loading && data && data.pedidosRecentes.length === 0 && (
              <p className="dash-empty-inline">
                Nenhum pedido registrado nesse dia.
              </p>
            )}

            {data?.pedidosRecentes.map((order) => (
              <div className="dash-table-row" key={order.id}>
                <span className="dash-td dash-td-id">RP-{order.id}</span>
                <span className="dash-td dash-td-client">
                  {order.cliente_nome}
                </span>
                <span className="dash-td dash-td-items">
                  {order.itens_count} item(s)
                </span>
                <span className="dash-td dash-td-payment">
                  <span className="dash-badge dash-badge--green">Pago</span>
                </span>
                <span className="dash-td dash-td-status">
                  <span
                    className={`dash-badge ${statusClass(order.status_pedido)}`}
                  >
                    {statusLabel(order.status_pedido)}
                  </span>
                </span>
                <span className="dash-td dash-td-total">
                  {formatarPreco(order.valor_total_centavos)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
  );
}
