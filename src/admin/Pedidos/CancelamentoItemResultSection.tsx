import type { Cancelamento } from "./CancelamentoItemPreviewModal";
import {
  dinheiro,
  METODOS,
  remoteCanRun,
  remoteLabel,
  statusLabel,
  type Perna
} from "./cancelamentoItemHelpers";

interface Props {
  cancelamento: Cancelamento;
  saving: boolean;
  refund: (leg: Perna) => Promise<void>;
  onClose: () => void;
}

export default function CancelamentoItemResultSection({
  cancelamento,
  saving,
  refund,
  onClose
}: Props) {
  return (
    <div className="cancelpreview-content">
      <div className="cancelpreview-success">
        <strong>{statusLabel(cancelamento.status)}</strong>
        {cancelamento.status !== "CONCLUIDO" && (
          <span>O item continua ativo até todas as devoluções serem resolvidas.</span>
        )}
      </div>
      {cancelamento.financeiro && (
        <div className="cancelpreview-values">
          <div>
            <span>Total atual</span>
            <strong>{dinheiro(cancelamento.financeiro.totalCentavos)}</strong>
          </div>
          <div>
            <span>Pago líquido</span>
            <strong>{dinheiro(cancelamento.financeiro.liquidoCentavos)}</strong>
          </div>
          <div>
            <span>Saldo</span>
            <strong>{dinheiro(cancelamento.financeiro.saldoCentavos)}</strong>
          </div>
          <div>
            <span>Estoque do item</span>
            <strong>{cancelamento.estoqueEstado}</strong>
          </div>
        </div>
      )}
      {(cancelamento.reembolsosConfirmados?.length ?? 0) > 0 && (
        <div className="cancelpreview-section">
          <span className="cancelpreview-label">Devoluções confirmadas</span>
          {cancelamento.reembolsosConfirmados?.map(refund => (
            <div className="cancelpreview-refund-leg" key={refund.id}>
              <div>
                <strong>{METODOS[refund.metodo] ?? refund.metodo}</strong>
                <span>{dinheiro(refund.valorCentavos)}</span>
              </div>
              <span>Confirmado</span>
            </div>
          ))}
        </div>
      )}
      {cancelamento.pernasPendentes.map(leg => (
        <div className="cancelpreview-refund-leg" key={leg.pagamentoAlocacaoId}>
          <div>
            <strong>{METODOS[leg.metodo] ?? leg.metodo}</strong>
            <span>{dinheiro(leg.valorCentavos)}</span>
          </div>
          {leg.confirmacaoManualPermitida ? (
            <button type="button" onClick={() => void refund(leg)} disabled={saving}>
              Confirmar devolução
            </button>
          ) : (
            <div>
              {leg.refundRemoto?.status === "INCONCLUSIVO" && (
                <span>Não foi possível confirmar o resultado do estorno.</span>
              )}
              {leg.refundRemoto?.status === "RECUSADO" && (
                <span>
                  O Mercado Pago recusou esta tentativa. Revise antes de iniciar outra operação.
                </span>
              )}
              {remoteCanRun(leg) ? (
                <button type="button" onClick={() => void refund(leg)} disabled={saving}>
                  {remoteLabel(leg)}
                </button>
              ) : (
                <span>{remoteLabel(leg)}</span>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="cancelpreview-footer">
        <span>
          {cancelamento.reembolsoPendenteCentavos > 0
            ? `Pendente: ${dinheiro(cancelamento.reembolsoPendenteCentavos)}`
            : "Fluxo concluído"}
        </span>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
