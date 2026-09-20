import { createPortal } from "react-dom";
import { useAdminModal } from "./useAdminModal";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Substitui window.confirm por um modal no visual do site — empilha sobre
 * qualquer outro modal aberto (useAdminModal cuida de Esc/foco/pilha). */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const modalProps = useAdminModal(true, onCancel);

  return createPortal(
    <div className="confirmdlg-overlay" {...modalProps}>
      <div className="confirmdlg-card" role="alertdialog" aria-modal="true" aria-labelledby="confirmdlg-title">
        <h2 id="confirmdlg-title" className="confirmdlg-title">{title}</h2>
        <p className="confirmdlg-message">{message}</p>
        <div className="confirmdlg-actions">
          <button type="button" className="confirmdlg-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === "danger" ? "confirmdlg-btn-danger" : "confirmdlg-btn-confirm"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
