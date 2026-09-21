import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import "./ExcluirPedidoModal.css";

export default function ExcluirPedidoModal({ orderId, liquidoCentavos, onClose, onDeleted }: {
  orderId: number; liquidoCentavos: number; onClose: () => void; onDeleted: () => void;
}) {
  const [devolver, setDevolver] = useState<boolean | null>(null);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const modalProps = useAdminModal(true, () => { if (!savingRef.current) onClose(); });

  async function excluir(event: React.FormEvent) {
    event.preventDefault();
    if (devolver === null || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/pedidos/${orderId}/anulacao`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devolverEstoque: devolver, motivo }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir o pedido.");
      window.dispatchEvent(new window.CustomEvent("pedido-anulado", { detail: { pedidoId: orderId } }));
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir pedido. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className="excluir-pedido-overlay" {...modalProps} role="dialog" aria-modal="true" aria-labelledby="excluir-pedido-title">
      <form className="excluir-pedido-card" onSubmit={excluir}>
        <h2 id="excluir-pedido-title" className="excluir-pedido-title">Excluir Pedido #{orderId}?</h2>
        <p className="excluir-pedido-text">
          Este pedido será removido das telas e dos totais atuais. O histórico financeiro continuará registrado.
        </p>

        <div className="excluir-pedido-stat">
          <span className="excluir-pedido-stat-label">Valor que deixará de contar nos totais</span>
          <strong className="excluir-pedido-stat-value">
            {(liquidoCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </strong>
        </div>

        <fieldset className="excluir-pedido-fieldset" disabled={saving}>
          <legend className="excluir-pedido-legend">Devolver produtos ao estoque?</legend>
          <label className="excluir-pedido-radio">
            <input type="radio" name="devolverEstoque" checked={devolver === true}
              onChange={() => setDevolver(true)} required />
            Sim, devolver ao estoque
          </label>
          <label className="excluir-pedido-radio">
            <input type="radio" name="devolverEstoque" checked={devolver === false}
              onChange={() => setDevolver(false)} required />
            Não, manter estoque como está
          </label>
        </fieldset>

        <label className="excluir-pedido-field">
          <span>Motivo da exclusão (opcional)</span>
          <textarea
            className="excluir-pedido-textarea"
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            maxLength={300}
            disabled={saving}
          />
        </label>

        {error && <p role="alert" className="excluir-pedido-error">{error}</p>}

        <div className="excluir-pedido-actions">
          <button type="button" className="excluir-pedido-cancel" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="excluir-pedido-danger" disabled={saving || devolver === null}>
            {saving ? "Excluindo..." : "Excluir pedido"}
          </button>
        </div>
      </form>
    </div>, document.body,
  );
}
