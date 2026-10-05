import { IconAlert, IconShield } from "./AdminDashboard";
import {
  type DashboardResponse,
  formatarMargem,
  formatarPreco,
  formatarPrecoComSinal,
  idadePendencia,
  statusClass,
  statusLabel
} from "./adminDashboardHelpers";

export interface DashboardChartProps {
  data: DashboardResponse | null;
  loading: boolean;
}

export default function DashboardChart({ data, loading }: DashboardChartProps) {
  const maiorVendido = data?.maisVendidos.reduce((max, item) => Math.max(max, item.quantidade), 0);

  return (
    <div className="dash-split-row">
      {/* Best sellers */}
      <div className="dash-panel dash-best-sellers">
        <div className="dash-panel-title-group">
          <h2 className="dash-panel-title">Produtos mais vendidos</h2>
          <p className="dash-panel-subtitle">Vendas com cobertura financeira em todo o histórico</p>
        </div>
        {!loading && data && data.maisVendidos.length === 0 && (
          <p className="dash-empty-inline">Nenhuma venda confirmada até agora.</p>
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
                <span className="dash-rank-units">{item.quantidade} un.</span>
              </div>
              <div className="dash-progress-track">
                <div
                  className="dash-progress-fill"
                  style={{
                    width: `${maiorVendido ? (item.quantidade / maiorVendido) * 100 : 0}%`
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
            <p className="dash-panel-subtitle">Movimento financeiro confirmado da loja</p>
          </div>
          <strong className="dash-cash-value" data-testid="caixa-total">
            {formatarPreco(data?.financeiro.liquidoCentavos ?? 0)}
          </strong>
          <div className="dash-cash-breakdown">
            <span>Recebido: {formatarPreco(data?.financeiro.brutoCentavos ?? 0)}</span>
            <span>Reembolsado: -{formatarPreco(data?.financeiro.reembolsadoCentavos ?? 0)}</span>
          </div>
        </div>

        {/* Resultado financeiro (despesas itemizadas) */}
        <div className="dash-panel dash-result-panel">
          <div className="dash-panel-title-group">
            <h2 className="dash-panel-title">Resultado financeiro</h2>
            <p className="dash-panel-subtitle">Faturamento líquido total menos despesas</p>
          </div>
          <div className="dash-result-grid">
            <div>
              <span>Faturamento líquido</span>
              <strong>
                {formatarPreco(data?.resultadoFinanceiro?.faturamentoLiquidoCentavos ?? 0)}
              </strong>
            </div>
            <div>
              <span>Gastos</span>
              <strong>{formatarPreco(data?.resultadoFinanceiro?.despesasCentavos ?? 0)}</strong>
            </div>
            <div>
              <span>Lucro estimado</span>
              <strong
                className={
                  (data?.resultadoFinanceiro?.lucroEstimadoCentavos ?? 0) < 0
                    ? "dash-result-negativo"
                    : ""
                }
              >
                {formatarPrecoComSinal(data?.resultadoFinanceiro?.lucroEstimadoCentavos ?? 0)}
              </strong>
            </div>
            <div>
              <span>Margem estimada</span>
              <strong
                className={
                  (data?.resultadoFinanceiro?.margemEstimada ?? 0) < 0 ? "dash-result-negativo" : ""
                }
              >
                {formatarMargem(data?.resultadoFinanceiro?.margemEstimada ?? null)}
              </strong>
            </div>
          </div>
        </div>

        {/* Pending payments */}
        <div className="dash-panel dash-pending-payments" id="pagamentos-pendentes">
          <div className="dash-panel-header-row">
            <div className="dash-panel-title-group">
              <h2 className="dash-panel-title">Pagamentos pendentes</h2>
              <p className="dash-panel-subtitle">Saldo em aberto até ser totalmente resolvido</p>
            </div>
            <span className="dash-pending-value">{formatarPreco(data?.aReceber.total ?? 0)}</span>
          </div>
          {!data || data.aReceber.count === 0 ? (
            <div className="dash-empty-state">
              <IconShield />
              <span className="dash-empty-title">Nenhum valor pendente</span>
              <span className="dash-empty-desc">Todos os saldos financeiros estão resolvidos.</span>
            </div>
          ) : (
            <div className="dash-pending-list">
              {data.pagamentosPendentes.map(pedido => (
                <a
                  className="dash-pending-row"
                  href={`/admin/pedidos?pedido=${pedido.id}`}
                  key={pedido.id}
                >
                  <div className="dash-pending-main">
                    <div className="dash-pending-order">
                      <span className="dash-pending-id">RP-{pedido.id}</span>
                      <span className="dash-pending-client">{pedido.cliente_nome}</span>
                    </div>
                    <strong className="dash-pending-amount">
                      {formatarPreco(pedido.saldo_centavos)}
                    </strong>
                  </div>
                  <div className="dash-pending-meta">
                    <span className={`dash-badge ${statusClass(pedido.status_pedido)}`}>
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
              <span className="dash-empty-desc">Nenhum produto com estoque baixo no momento.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
