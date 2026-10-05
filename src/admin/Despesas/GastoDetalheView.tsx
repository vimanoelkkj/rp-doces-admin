import { DESPESA_UNIDADE_LABEL } from "../../../shared/despesas";
import { formatarDataBr, formatarPreco, formatarValorUnitario } from "./formatarDespesas";
import type { DespesaView } from "./gastoModalHelpers";

interface GastoDetalheViewProps {
  despesa: DespesaView;
  erro: string | null;
  cancelando: boolean;
  onCancelarDespesa: () => void;
  onEditar: () => void;
  onClose: () => void;
}

export default function GastoDetalheView({
  despesa,
  erro,
  cancelando,
  onCancelarDespesa,
  onEditar,
  onClose
}: GastoDetalheViewProps) {
  return (
    <div className="gasto-body">
      <div className="gasto-detalhe-grid">
        <div>
          <span>Status</span>
          <strong
            className={`gasto-status-pill gasto-status-pill--${despesa.status.toLowerCase()}`}
          >
            {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
          </strong>
        </div>
        <div>
          <span>Fornecedor</span>
          <strong>{despesa.fornecedor || "Sem fornecedor"}</strong>
        </div>
        <div>
          <span>Data</span>
          <strong>{formatarDataBr(despesa.dataCompetencia)}</strong>
        </div>
        {despesa.observacao && (
          <div className="gasto-detalhe-span2">
            <span>Observação</span>
            <strong>{despesa.observacao}</strong>
          </div>
        )}
      </div>

      <div className="gasto-detalhe-itens">
        <h3>Itens</h3>
        {despesa.itens.map(item => (
          <div className="gasto-detalhe-item" key={item.id}>
            <div>
              <strong>{item.descricao}</strong>
              <span>
                {item.quantidade.toLocaleString("pt-BR")} {DESPESA_UNIDADE_LABEL[item.unidade]} ×{" "}
                {formatarValorUnitario(item.valorUnitarioCentavos)}
              </span>
            </div>
            <strong>{formatarPreco(item.valorTotalCentavos)}</strong>
          </div>
        ))}
      </div>

      <div className="gasto-total-row">
        <span>Total da despesa</span>
        <strong>{formatarPreco(despesa.totalCentavos)}</strong>
      </div>

      {erro && (
        <p role="alert" className="gasto-error">
          {erro}
        </p>
      )}

      <footer className="gasto-footer gasto-footer--detalhe">
        {despesa.status === "ATIVA" && (
          <>
            <button
              type="button"
              className="gasto-btn-cancel"
              onClick={onCancelarDespesa}
              disabled={cancelando}
            >
              {cancelando ? "Excluindo…" : "Excluir despesa"}
            </button>
            <button type="button" className="gasto-btn-save" onClick={onEditar}>
              Editar
            </button>
          </>
        )}
        {despesa.status === "CANCELADA" && (
          <button type="button" className="gasto-btn-cancel" onClick={onClose}>
            Fechar
          </button>
        )}
      </footer>
    </div>
  );
}
