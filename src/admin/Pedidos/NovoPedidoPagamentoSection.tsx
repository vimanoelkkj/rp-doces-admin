import { useDropdown } from "../components/useDropdown";
import {
  METODO_OPTIONS,
  STATUS_OPTIONS,
  type NovoPedidoPagamentoSectionProps
} from "./novoPedidoHelpers";
import { IconChevron } from "./NovoPedidoProductRow";

export default function NovoPedidoPagamentoSection({
  fieldId,
  metodoPagamento,
  statusPagamento,
  onSelectMetodo,
  onSelectStatus
}: NovoPedidoPagamentoSectionProps) {
  const payMethodDd = useDropdown();
  const payStatusDd = useDropdown();

  return (
    <div className="nped-row-2">
      <div className="nped-field">
        <label id={`${fieldId}-metodo-label`} htmlFor={`${fieldId}-metodo`}>
          Forma de pagamento
        </label>
        <div
          className={`nped-dropdown ${payMethodDd.open ? "nped-dropdown--open" : ""}`}
          ref={payMethodDd.ref}
        >
          <button
            id={`${fieldId}-metodo`}
            type="button"
            className="nped-dropdown-trigger"
            aria-labelledby={`${fieldId}-metodo-label ${fieldId}-metodo-value`}
            onClick={() => payMethodDd.setOpen(!payMethodDd.open)}
          >
            <span id={`${fieldId}-metodo-value`}>
              {METODO_OPTIONS.find(m => m.value === metodoPagamento)?.label}
            </span>
            <IconChevron open={payMethodDd.open} />
          </button>
          {payMethodDd.open && (
            <ul className="nped-dropdown-list">
              {METODO_OPTIONS.filter(
                m => statusPagamento !== "PAGO" || m.value !== "A_COMBINAR"
              ).map(m => (
                <li key={m.value}>
                  <button
                    type="button"
                    className={`nped-dropdown-option ${metodoPagamento === m.value ? "nped-dropdown-option--active" : ""}`}
                    onClick={() => {
                      onSelectMetodo(m.value);
                      payMethodDd.setOpen(false);
                    }}
                  >
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="nped-field">
        <label id={`${fieldId}-status-label`} htmlFor={`${fieldId}-status`}>
          Situação do pagamento
        </label>
        <div
          className={`nped-dropdown ${payStatusDd.open ? "nped-dropdown--open" : ""}`}
          ref={payStatusDd.ref}
        >
          <button
            id={`${fieldId}-status`}
            type="button"
            className="nped-dropdown-trigger"
            aria-labelledby={`${fieldId}-status-label ${fieldId}-status-value`}
            onClick={() => payStatusDd.setOpen(!payStatusDd.open)}
          >
            <span id={`${fieldId}-status-value`}>
              {STATUS_OPTIONS.find(s => s.value === statusPagamento)?.label}
            </span>
            <IconChevron open={payStatusDd.open} />
          </button>
          {payStatusDd.open && (
            <ul className="nped-dropdown-list">
              {STATUS_OPTIONS.filter(
                s => metodoPagamento !== "A_COMBINAR" || s.value !== "PAGO"
              ).map(s => (
                <li key={s.value}>
                  <button
                    type="button"
                    className={`nped-dropdown-option ${statusPagamento === s.value ? "nped-dropdown-option--active" : ""}`}
                    onClick={() => {
                      onSelectStatus(s.value);
                      payStatusDd.setOpen(false);
                    }}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
