import { createPortal } from "react-dom";
import { useBackLayer } from "../shared/useBackLayer";
import styles from "./StoreDiagnosticsConfirmDialog.module.css";

export type DiagnosticConfirmKind = "PIX" | "REFUND" | "ORDER" | "DISCARD_ORDER";

type Props = {
  kind: DiagnosticConfirmKind;
  productName?: string;
  quantity?: number;
  orderId?: number | null;
  onClose: () => void;
  onConfirm: () => void;
};

const COPY: Record<DiagnosticConfirmKind, {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  confirm: string;
  danger?: boolean;
}> = {
  PIX: {
    eyebrow: "Pix real de diagnóstico",
    title: "Gerar Pix de R$ 0,10?",
    description: "Este teste cria uma cobrança Pix real usando a credencial de diagnóstico.",
    note: "O valor não entra no faturamento nem fica associado a um pedido de cliente.",
    confirm: "Gerar Pix"
  },
  REFUND: {
    eyebrow: "Reembolso de diagnóstico",
    title: "Reembolsar este Pix?",
    description: "O sistema solicitará o reembolso real do Pix de diagnóstico já confirmado.",
    note: "A operação fica registrada no diagnóstico e não altera pedidos ou faturamento.",
    confirm: "Solicitar reembolso",
    danger: true
  },
  ORDER: {
    eyebrow: "Pedido de teste",
    title: "Criar pedido de teste?",
    description: "Será criada uma comanda real de diagnóstico para validar estoque e os fluxos de pedido.",
    note: "O pedido fica fora das métricas de venda, mas usa e reserva estoque real para o teste ser fiel.",
    confirm: "Criar pedido"
  },
  DISCARD_ORDER: {
    eyebrow: "Limpeza do diagnóstico",
    title: "Descartar pedido de teste?",
    description: "O sistema desfará o estado criado pelo diagnóstico sem gerar reembolso fictício.",
    note: "Estoque físico baixado volta ao produto, reservas do teste são removidas e pagamentos simulados são apagados. Pagamento externo real bloqueia esta ação.",
    confirm: "Descartar teste",
    danger: true
  }
};

export function StoreDiagnosticsConfirmDialog({ kind, productName, quantity = 1, orderId, onClose, onConfirm }: Props) {
  const copy = COPY[kind];
  const close = useBackLayer(true, () => {
    onClose();
    return true;
  }, "store-diagnostics-confirm");

  function confirm() {
    close();
    onConfirm();
  }

  return createPortal(
    <div className={styles.dialog}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar confirmação"
        onClick={close}
      />

      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-confirm-title"
        aria-describedby="diagnostics-confirm-description"
      >
        <div className={styles.eyebrow}>{copy.eyebrow}</div>
        <h2 className={styles.title} id="diagnostics-confirm-title">{copy.title}</h2>
        <p className={styles.description} id="diagnostics-confirm-description">{copy.description}</p>

        {kind === "PIX" ? (
          <div className={styles.summary}>
            <span>Valor real</span>
            <strong>R$ 0,10</strong>
          </div>
        ) : null}

        {kind === "ORDER" ? (
          <div className={styles.summary}>
            <span>{quantity}x produto</span>
            <strong>{productName || "Produto selecionado"}</strong>
          </div>
        ) : null}

        {kind === "DISCARD_ORDER" && orderId ? (
          <div className={styles.summary}>
            <span>Pedido de diagnóstico</span>
            <strong>#{orderId}</strong>
          </div>
        ) : null}

        <div className={`${styles.note} ${copy.danger ? styles.dangerNote : ""}`}>
          <span className={styles.noteIcon} aria-hidden="true">!</span>
          <span>{copy.note}</span>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancel} type="button" onClick={close}>Cancelar</button>
          <button
            className={`${styles.confirm} ${copy.danger ? styles.dangerConfirm : ""}`}
            type="button"
            autoFocus
            onClick={confirm}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
