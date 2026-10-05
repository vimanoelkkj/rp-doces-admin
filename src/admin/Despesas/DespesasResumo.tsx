import { DESPESA_CATEGORIA_LABEL } from "../../../shared/despesas";
import { formatarMargem, formatarPreco, formatarPrecoComSinal } from "./formatarDespesas";
import type { DespesasResponse, ResultadoFinanceiro } from "./adminDespesasHelpers";

interface DespesasResumoProps {
  resultado?: ResultadoFinanceiro;
  resumo?: DespesasResponse["resumo"];
}

export default function DespesasResumo({ resultado, resumo }: DespesasResumoProps) {
  return (
    <>
      <section className="desp-kpi-strip" aria-label="Resultado financeiro">
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Faturamento líquido</span>
          <strong className="desp-kpi-value">
            {resultado ? formatarPreco(resultado.faturamentoLiquidoCentavos) : "—"}
          </strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Gastos</span>
          <strong className="desp-kpi-value">
            {resultado ? formatarPreco(resultado.despesasCentavos) : "—"}
          </strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Lucro estimado</span>
          <strong
            className={`desp-kpi-value ${resultado && resultado.lucroEstimadoCentavos < 0 ? "desp-kpi-value--negativo" : ""}`}
          >
            {resultado ? formatarPrecoComSinal(resultado.lucroEstimadoCentavos) : "—"}
          </strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Margem estimada</span>
          <strong
            className={`desp-kpi-value ${resultado && (resultado.margemEstimada ?? 0) < 0 ? "desp-kpi-value--negativo" : ""}`}
          >
            {resultado ? formatarMargem(resultado.margemEstimada) : "—"}
          </strong>
        </article>
      </section>

      <section className="desp-insights">
        <article className="desp-card desp-categoria-card">
          <div className="desp-card-heading">
            <h2>Gastos por categoria</h2>
            <span>{resumo ? formatarPreco(resumo.totalCentavos) : "—"}</span>
          </div>
          {resumo && resumo.porCategoria.length > 0 ? (
            <div className="desp-categoria-list">
              {resumo.porCategoria.map(categoria => (
                <div className="desp-categoria-row" key={categoria.categoria}>
                  <span>{DESPESA_CATEGORIA_LABEL[categoria.categoria]}</span>
                  <div className="desp-progress">
                    <i style={{ width: `${Math.min(100, categoria.percentual)}%` }} />
                  </div>
                  <strong>{formatarPreco(categoria.valorCentavos)}</strong>
                  <em>{categoria.percentual.toFixed(1).replace(".", ",")}%</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="desp-empty">Nenhum gasto no período.</p>
          )}
        </article>

        <article className="desp-card desp-ranking-card">
          <div className="desp-card-heading">
            <h2>Itens com maior gasto</h2>
          </div>
          {resumo && resumo.rankingItens.length > 0 ? (
            <ol className="desp-ranking">
              {resumo.rankingItens.map((item, index) => (
                <li key={item.descricao}>
                  <b>{index + 1}</b>
                  <span>{item.descricao}</span>
                  <strong>{formatarPreco(item.valorCentavos)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="desp-empty">Nenhum item no período.</p>
          )}
        </article>
      </section>
    </>
  );
}

