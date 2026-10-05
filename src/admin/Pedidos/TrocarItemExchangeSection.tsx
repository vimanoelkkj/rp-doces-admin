import {
  labels,
  money,
  remoteCanRun,
  remoteLabel,
  type Exchange,
  type RefundLeg
} from "./trocarItemHelpers";

interface Props {
  exchange: Exchange;
  saving: boolean;
  refund: (leg: RefundLeg) => Promise<void>;
  onClose: () => void;
}

export default function TrocarItemExchangeSection({ exchange, saving, refund, onClose }: Props) {
  return (
    <div className="cancelpreview-content">
      <div className="cancelpreview-success">
        <strong>{exchange.status.replace(/_/g, " ")}</strong>
        <span>
          {exchange.status === "AGUARDANDO_COBRANCA"
            ? "A troca foi aplicada. A diferença pode ser cobrada pelo Pix da comanda."
            : exchange.status === "AGUARDANDO_REEMBOLSO"
              ? "O produto atual permanece ativo até as devoluções terminarem."
              : "Troca concluída."}
        </span>
      </div>
      {exchange.financeiro && (
        <div className="cancelpreview-values">
          <div>
            <span>Total atual</span>
            <strong>{money(exchange.financeiro.totalCentavos)}</strong>
          </div>
          <div>
            <span>Pago líquido</span>
            <strong>{money(exchange.financeiro.liquidoCentavos)}</strong>
          </div>
          <div>
            <span>Saldo</span>
            <strong>{money(exchange.financeiro.saldoCentavos)}</strong>
          </div>
          <div>
            <span>Estoque origem</span>
            <strong>{exchange.estoqueOrigemEstado}</strong>
          </div>
        </div>
      )}
      {(exchange.reembolsosConfirmados?.length ?? 0) > 0 && (
        <div className="cancelpreview-section">
          <span className="cancelpreview-label">Devoluções confirmadas</span>
          {exchange.reembolsosConfirmados?.map(refund => (
            <div className="cancelpreview-refund-leg" key={refund.id}>
              <div>
                <strong>{labels[refund.metodo] ?? refund.metodo}</strong>
                <span>{money(refund.valorCentavos)}</span>
              </div>
              <span>Confirmado</span>
            </div>
          ))}
        </div>
      )}
      {exchange.refundsPendentes.map(leg => (
        <div className="cancelpreview-refund-leg" key={leg.pagamentoAlocacaoId}>
          <div>
            <strong>{labels[leg.metodo] ?? leg.metodo}</strong>
            <span>{money(leg.valorCentavos)}</span>
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
          {exchange.reembolsoPendenteCentavos
            ? `Pendente: ${money(exchange.reembolsoPendenteCentavos)}`
            : "Sem devoluções pendentes"}
        </span>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
