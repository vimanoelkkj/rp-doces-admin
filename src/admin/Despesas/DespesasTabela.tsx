import { formatarDataBr, formatarPreco } from "./formatarDespesas";
import type { DespesaListItem } from "./adminDespesasHelpers";

interface DespesasTabelaProps {
  despesas: DespesaListItem[];
  carregando: boolean;
  onSelectDespesa: (id: number) => void;
}

export default function DespesasTabela({
  despesas,
  carregando,
  onSelectDespesa
}: DespesasTabelaProps) {
  return (
    <div className="desp-table-panel">
      <table className="desp-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Fornecedor</th>
            <th>Itens</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {despesas.map(despesa => (
            <tr
              key={despesa.id}
              className="desp-table-row"
              onClick={() => onSelectDespesa(despesa.id)}
            >
              <td>{formatarDataBr(despesa.dataCompetencia)}</td>
              <td>
                <strong>{despesa.fornecedor || "Sem fornecedor"}</strong>
              </td>
              <td>
                {despesa.itemCount} {despesa.itemCount === 1 ? "item" : "itens"}
              </td>
              <td>
                <strong>{formatarPreco(despesa.totalCentavos)}</strong>
              </td>
              <td>
                <span className={`desp-status desp-status--${despesa.status.toLowerCase()}`}>
                  {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="desp-cards-mobile">
        {despesas.map(despesa => (
          <button
            type="button"
            key={despesa.id}
            className="desp-card-mobile"
            onClick={() => onSelectDespesa(despesa.id)}
          >
            <div className="desp-card-mobile-row">
              <span>{formatarDataBr(despesa.dataCompetencia)}</span>
              <span className={`desp-status desp-status--${despesa.status.toLowerCase()}`}>
                {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
              </span>
            </div>
            <strong>{despesa.fornecedor || "Sem fornecedor"}</strong>
            <div className="desp-card-mobile-row">
              <span>
                {despesa.itemCount} {despesa.itemCount === 1 ? "item" : "itens"}
              </span>
              <strong>{formatarPreco(despesa.totalCentavos)}</strong>
            </div>
          </button>
        ))}
      </div>

      {!carregando && despesas.length === 0 && (
        <p className="desp-empty desp-empty--table">Nenhuma despesa encontrada no período.</p>
      )}
    </div>
  );
}
