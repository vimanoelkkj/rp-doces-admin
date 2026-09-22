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

interface AReceberResumo extends ValorContagem {
  anteriores: number;
}

interface PendenciaPagamentoRow {
  id: number;
  cliente_nome: string;
  status_pedido: StatusPedido;
  criado_em: string;
  saldo_centavos: number;
  dias_em_aberto: number;
}

interface MaisVendidoRow {
  produtoId: number | null;
  nome: string;
  quantidade: number;
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
  aReceber: AReceberResumo;
  pagamentosPendentes: PendenciaPagamentoRow[];
  comandasAbertas: number;
  aguardandoPreparo: number;
  catalogo: { total: number; estoqueBaixo: number };
  financeiro: {
    brutoCentavos: number;
    reembolsadoCentavos: number;
    liquidoCentavos: number;
  };
  maisVendidos: MaisVendidoRow[];
  pedidosRecentes: PedidoRecenteRow[];
  resultadoFinanceiro: {
    faturamentoLiquidoCentavos: number;
    despesasCentavos: number;
    lucroEstimadoCentavos: number;
    margemEstimada: number | null;
  };
}

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatarPrecoComSinal = (centavos: number) =>
  `${centavos < 0 ? "-" : ""}${formatarPreco(Math.abs(centavos))}`;

// Nunca "0%"/NaN%/Infinity%: sem faturamento no período, a margem é
// indefinida, não zero.
const formatarMargem = (margem: number | null) =>
  margem === null ? "—" : `${margem.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

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

const idadePendencia = (dias: number) =>
  dias <= 0 ? "Hoje" : dias === 1 ? "Desde ontem" : `Há ${dias} dias`;

/* ── Component ── */
export default function AdminDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () => setRefreshKey(key => key + 1);
    window.addEventListener("pedido-anulado", atualizar);
    return () => window.removeEventListener("pedido-anulado", atualizar);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/admin/dashboard?date=${formatDateISO(selectedDate)}&today=${formatDateISO(new Date())}`,
    )
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
  }, [selectedDate, refreshKey]);

  const maiorVendido = data?.maisVendidos.reduce(
    (max, item) => Math.max(max, item.quantidade),
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
          <button
            type="button"
            className="dash-kpi-card dash-kpi-card--interactive"
            onClick={() =>
              document
                .getElementById("pagamentos-pendentes")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
            disabled={!data || data.aReceber.count === 0}
          >
            <span className="dash-kpi-label-row">
              <span className="dash-kpi-label">A receber</span>
              <span className="dash-kpi-live">Atual</span>
            </span>
            <div className="dash-kpi-value-group">
              <span className="dash-kpi-value">
                {formatarPreco(data?.aReceber.total ?? 0)}
              </span>
              <span className="dash-kpi-desc">
                {!data || data.aReceber.count === 0
                  ? "Nenhuma pendência em aberto"
                  : `${data.aReceber.count} pendência(s) em aberto${data.aReceber.anteriores > 0 ? ` • ${data.aReceber.anteriores} anterior(es)` : ""}`}
              </span>
            </div>
          </button>
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
              <h2 className="dash-panel-title">Produtos mais vendidos</h2>
              <p className="dash-panel-subtitle">
                Vendas com cobertura financeira em todo o histórico
              </p>
            </div>
            {!loading && data && data.maisVendidos.length === 0 && (
              <p className="dash-empty-inline">
                Nenhuma venda confirmada até agora.
              </p>
            )}
            <div className="dash-ranked-list">
              {data?.maisVendidos.map((item, i) => (
                <div
                  className="dash-rank-row"
                  key={item.produtoId === null ? `historico:${item.nome}` : item.produtoId}
                >
                  <div className="dash-rank-meta">
                    <div className="dash-rank-label">
                      <span className="dash-rank-number">{i + 1}</span>
                      <span className="dash-rank-name">{item.nome}</span>
                    </div>
                    <span className="dash-rank-units">
                      {item.quantidade} un.
                    </span>
                  </div>
                  <div className="dash-progress-track">
                    <div
                      className="dash-progress-fill"
                      style={{
                        width: `${maiorVendido ? (item.quantidade / maiorVendido) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="dash-right-col">
            <div className="dash-panel dash-cash-total">
              <div className="dash-panel-title-group">
                <h2 className="dash-panel-title">Caixa total</h2>
                <p className="dash-panel-subtitle">
                  Movimento financeiro confirmado da loja
                </p>
              </div>
              <strong className="dash-cash-value" data-testid="caixa-total">
                {formatarPreco(data?.financeiro.liquidoCentavos ?? 0)}
              </strong>
              <div className="dash-cash-breakdown">
                <span>
                  Recebido: {formatarPreco(data?.financeiro.brutoCentavos ?? 0)}
                </span>
                <span>
                  Reembolsado: -{formatarPreco(data?.financeiro.reembolsadoCentavos ?? 0)}
                </span>
              </div>
            </div>

            {/* Resultado financeiro (despesas itemizadas) */}
            <div className="dash-panel dash-result-panel">
              <div className="dash-panel-title-group">
                <h2 className="dash-panel-title">Resultado financeiro</h2>
                <p className="dash-panel-subtitle">
                  Faturamento líquido total menos despesas
                </p>
              </div>
              <div className="dash-result-grid">
                <div>
                  <span>Faturamento líquido</span>
                  <strong>{formatarPreco(data?.resultadoFinanceiro?.faturamentoLiquidoCentavos ?? 0)}</strong>
                </div>
                <div>
                  <span>Gastos</span>
                  <strong>{formatarPreco(data?.resultadoFinanceiro?.despesasCentavos ?? 0)}</strong>
                </div>
                <div>
                  <span>Lucro estimado</span>
                  <strong className={(data?.resultadoFinanceiro?.lucroEstimadoCentavos ?? 0) < 0 ? "dash-result-negativo" : ""}>
                    {formatarPrecoComSinal(data?.resultadoFinanceiro?.lucroEstimadoCentavos ?? 0)}
                  </strong>
                </div>
                <div>
                  <span>Margem estimada</span>
                  <strong className={(data?.resultadoFinanceiro?.margemEstimada ?? 0) < 0 ? "dash-result-negativo" : ""}>
                    {formatarMargem(data?.resultadoFinanceiro?.margemEstimada ?? null)}
                  </strong>
                </div>
              </div>
            </div>

            {/* Pending payments */}
            <div
              className="dash-panel dash-pending-payments"
              id="pagamentos-pendentes"
            >
              <div className="dash-panel-header-row">
                <div className="dash-panel-title-group">
                  <h2 className="dash-panel-title">Pagamentos pendentes</h2>
                  <p className="dash-panel-subtitle">
                    Saldo em aberto até ser totalmente resolvido
                  </p>
                </div>
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
                    Todos os saldos financeiros estão resolvidos.
                  </span>
                </div>
              ) : (
                <div className="dash-pending-list">
                  {data.pagamentosPendentes.map((pedido) => (
                    <a
                      className="dash-pending-row"
                      href={`/admin/pedidos?pedido=${pedido.id}`}
                      key={pedido.id}
                    >
                      <div className="dash-pending-main">
                        <div className="dash-pending-order">
                          <span className="dash-pending-id">RP-{pedido.id}</span>
                          <span className="dash-pending-client">
                            {pedido.cliente_nome}
                          </span>
                        </div>
                        <strong className="dash-pending-amount">
                          {formatarPreco(pedido.saldo_centavos)}
                        </strong>
                      </div>
                      <div className="dash-pending-meta">
                        <span
                          className={`dash-badge ${statusClass(pedido.status_pedido)}`}
                        >
                          {statusLabel(pedido.status_pedido)}
                        </span>
                        <span
                          className={`dash-pending-age${pedido.dias_em_aberto > 0 ? " dash-pending-age--late" : ""}`}
                        >
                          {idadePendencia(pedido.dias_em_aberto)}
                        </span>
                      </div>
                    </a>
                  ))}
                  {data.aReceber.count > data.pagamentosPendentes.length && (
                    <a className="dash-pending-more" href="/admin/pedidos">
                      +{data.aReceber.count - data.pagamentosPendentes.length} outra(s) pendência(s)
                    </a>
                  )}
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
