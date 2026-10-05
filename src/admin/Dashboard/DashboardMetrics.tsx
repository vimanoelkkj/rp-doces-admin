import { type DashboardResponse, formatarPreco } from "./adminDashboardHelpers";

export interface DashboardMetricsProps {
  data: DashboardResponse | null;
}

export default function DashboardMetrics({ data }: DashboardMetricsProps) {
  return (
    <div className="dash-kpi-strip">
      <div className="dash-kpi-card">
        <span className="dash-kpi-label">Recebido hoje</span>
        <div className="dash-kpi-value-group">
          <span className="dash-kpi-value">{formatarPreco(data?.recebidoHoje.total ?? 0)}</span>
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
          <span className="dash-kpi-value">{formatarPreco(data?.aReceber.total ?? 0)}</span>
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
          <span className="dash-kpi-value">{data?.comandasAbertas ?? 0}</span>
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
          <span className="dash-kpi-value">{data?.aguardandoPreparo ?? 0}</span>
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
              <span className="dash-kpi-warning-dot" style={{ background: "#c28343" }} />
              <span className="dash-kpi-warning-text">
                {data.catalogo.estoqueBaixo} estoque baixo
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
