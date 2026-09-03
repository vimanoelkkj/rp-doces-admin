import { useState } from "react";
import type {
  FinancialOrder,
  ManualRefundMethod,
  OrderPayment,
  RefundInput
} from "./order.finance";
import styles from "./RefundPanel.module.css";

type Props = {
  order: FinancialOrder;
  payment: OrderPayment;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (input: RefundInput) => void;
};

function money(cents?: number | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(cents || 0) / 100
  );
}

export function RefundPanel({ order, payment, saving, onCancel, onConfirm }: Props) {
  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);
  const paidPayments = order.pagamentos.filter(item => item.status === "PAGO");
  const canReturnStock = paidPayments.length === 1;
  const defaultReturnStock = canReturnStock && String(order.status_pedido || "").toUpperCase() !== "ENTREGUE";

  const [manualMethod, setManualMethod] = useState<ManualRefundMethod>("PIX_EXTERNO");
  const [reason, setReason] = useState("");
  const [returnStock, setReturnStock] = useState(defaultReturnStock);

  function confirm() {
    if (!payment.id) return;
    onConfirm({
      pagamento_id: payment.id,
      origem: automatic ? "MERCADO_PAGO" : "MANUAL",
      metodo: automatic ? "PIX_MP" : manualMethod,
      motivo: reason.trim(),
      devolver_estoque: canReturnStock && returnStock
    });
  }

  return (
    <div className={styles.panel} role="group" aria-label={`Reembolso de ${money(payment.valor_centavos)}`}>
      <div className={styles.heading}>
        <div>
          <span>Reembolso integral</span>
          <strong>{money(payment.valor_centavos)}{automatic ? " pelo Mercado Pago" : ""}</strong>
        </div>
        <button type="button" className={styles.close} onClick={onCancel} disabled={saving} aria-label="Fechar reembolso">×</button>
      </div>

      <p className={styles.explanation}>
        {automatic
          ? "O sistema só marcará este pagamento como reembolsado depois que o Mercado Pago confirmar o estorno."
          : "Confirme somente depois de devolver o dinheiro ao cliente. O sistema registrará este estorno como manual."}
      </p>

      {!automatic ? (
        <label className={styles.field}>
          <span>Como o valor foi devolvido</span>
          <select value={manualMethod} onChange={event => setManualMethod(event.target.value as ManualRefundMethod)} disabled={saving}>
            <option value="PIX_EXTERNO">Pix direto</option>
            <option value="DINHEIRO">Dinheiro</option>
            <option value="CARTAO">Cartão</option>
            <option value="OUTRO">Outro</option>
          </select>
        </label>
      ) : null}

      <label className={styles.field}>
        <span>Motivo</span>
        <textarea
          value={reason}
          onChange={event => setReason(event.target.value)}
          maxLength={300}
          placeholder="Ex.: cliente desistiu do pedido"
          disabled={saving}
        />
      </label>

      <label className={`${styles.stockChoice} ${!canReturnStock ? styles.disabled : ""}`}>
        <input
          type="checkbox"
          checked={returnStock}
          onChange={event => setReturnStock(event.target.checked)}
          disabled={saving || !canReturnStock}
        />
        <span>
          <strong>Devolver itens ao estoque</strong>
          <small>
            {canReturnStock
              ? String(order.status_pedido || "").toUpperCase() === "ENTREGUE"
                ? "Desmarcado por padrão porque o pedido já foi entregue."
                : "Use quando os produtos não foram entregues e podem voltar à venda."
              : "Disponível apenas ao reembolsar o último pagamento confirmado."}
          </small>
        </span>
      </label>

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel} disabled={saving}>Voltar</button>
        <button type="button" className={styles.danger} onClick={confirm} disabled={saving || !payment.id}>
          {saving ? (automatic ? "Solicitando…" : "Registrando…") : "Confirmar reembolso"}
        </button>
      </div>
    </div>
  );
}
