import type { Dispatch, SetStateAction } from "react";
import type { CancelamentoPreview } from "./CancelamentoItemPreviewModal";
import { dinheiro, METODOS } from "./cancelamentoItemHelpers";

interface Props {
  preview: CancelamentoPreview;
  saving: boolean;
  disabled: boolean;
  motivo: string;
  acao: string;
  acaoDropdownOpen: boolean;
  setMotivo: Dispatch<SetStateAction<string>>;
  setAcao: Dispatch<SetStateAction<string>>;
  setAcaoDropdownOpen: Dispatch<SetStateAction<boolean>>;
  confirmar: () => Promise<void>;
  onClose: () => void;
}

export default function CancelamentoItemPreviewSection({
  preview,
  saving,
  disabled,
  motivo,
  acao,
  acaoDropdownOpen,
  setMotivo,
  setAcao,
  setAcaoDropdownOpen,
  confirmar,
  onClose
}: Props) {
  return (
    <div className="cancelpreview-content">
      <div className="cancelpreview-product">
        <strong>{preview.item.nome}</strong>
        <span>
          {preview.item.quantidade}x · {dinheiro(preview.item.valorCentavos)}
        </span>
      </div>
      <div className="cancelpreview-values">
        <div>
          <span>Valor do item</span>
          <strong>{dinheiro(preview.financeiro.valorItemCentavos)}</strong>
        </div>
        <div>
          <span>Valor já pago associado</span>
          <strong>{dinheiro(preview.financeiro.coberturaConfirmadaCentavos)}</strong>
        </div>
        <div>
          <span>Valor ainda não pago</span>
          <strong>{dinheiro(preview.financeiro.valorNaoPagoCentavos)}</strong>
        </div>
        <div className="cancelpreview-values-refund">
          <span>Valor a devolver</span>
          <strong>{dinheiro(preview.financeiro.reembolsoNecessarioCentavos)}</strong>
        </div>
      </div>
      <div className="cancelpreview-section">
        <span className="cancelpreview-label">Pagamentos envolvidos</span>
        <div className="cancelpreview-payments">
          {preview.pagamentos
            .filter(p => p.reembolsoPropostoCentavos > 0)
            .map(p => (
              <div key={p.pagamentoAlocacaoId}>
                <span>{METODOS[p.metodo] ?? p.metodo}</span>
                <strong>
                  {dinheiro(p.reembolsoPropostoCentavos)}{" "}
                  {p.metodo === "DINHEIRO" ? "a devolver" : "a estornar"}
                </strong>
              </div>
            ))}
          {!preview.pagamentos.some(p => p.reembolsoPropostoCentavos > 0) && (
            <p className="cancelpreview-muted">Nenhum pagamento confirmado cobre este item.</p>
          )}
        </div>
      </div>
      <div className="cancelpreview-stock">
        <span className="cancelpreview-label">Estoque</span>
        <p>
          {preview.estoque.estadoAtual === "RESERVADO"
            ? `A reserva de ${preview.item.quantidade} ${preview.item.quantidade === 1 ? "unidade" : "unidades"} será liberada.`
            : preview.estoque.estadoAtual === "BAIXADO"
              ? "O produto já foi baixado. A reposição depende da confirmação física abaixo."
              : "Nenhum efeito físico é necessário."}
        </p>
      </div>
      {preview.item.estoqueEstado === "BAIXADO" && (
        <label className="cancelpreview-field">
          <span>Ação física confirmada</span>
          <div
            className={`cancelpreview-dropdown${acaoDropdownOpen ? " cancelpreview-dropdown--open" : ""}`}
          >
            <button
              type="button"
              className="cancelpreview-dropdown-trigger"
              onClick={() => setAcaoDropdownOpen(open => !open)}
              onBlur={() => setTimeout(() => setAcaoDropdownOpen(false), 150)}
              disabled={saving}
            >
              <span>
                {acao === "REPOR" ? "Produto devolvido: repor no estoque" : "Não repor no estoque"}
              </span>
              <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8" fill="none">
                <path
                  d="M1 1.5L6 6.5L11 1.5"
                  stroke="#634738"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {acaoDropdownOpen && (
              <ul className="cancelpreview-dropdown-list">
                {[
                  { value: "NAO_REPOR", label: "Não repor no estoque" },
                  { value: "REPOR", label: "Produto devolvido: repor no estoque" }
                ].map(option => (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={`cancelpreview-dropdown-option${acao === option.value ? " cancelpreview-dropdown-option--active" : ""}`}
                      onClick={() => {
                        setAcao(option.value);
                        setAcaoDropdownOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
      )}
      <label className="cancelpreview-field">
        <span>Motivo</span>
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} />
      </label>
      {preview.bloqueios.map(b => (
        <div className="cancelpreview-block" key={b.codigo}>
          {b.mensagem}
        </div>
      ))}
      <div className="cancelpreview-footer">
        <button type="button" onClick={onClose}>
          Voltar
        </button>
        <button
          type="button"
          className="cancelpreview-confirm"
          onClick={() => void confirmar()}
          disabled={disabled}
        >
          {saving ? "Confirmando..." : "Confirmar cancelamento"}
        </button>
      </div>
    </div>
  );
}
