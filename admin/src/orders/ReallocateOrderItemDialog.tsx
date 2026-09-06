import { useMemo, useState } from "react";
import { ApiClientError } from "../shared/apiClient";
import { AdminSelect } from "../shared/AdminSelect";
import { useBackLayer } from "../shared/useBackLayer";
import { reallocateOrderItemPayment } from "./order.api";
import type { FinancialOrderItem } from "./order.finance";
import styles from "./ReallocateOrderItemDialog.module.css";

type Props = {
  orderId: number;
  item: FinancialOrderItem;
  candidates: FinancialOrderItem[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

export function ReallocateOrderItemDialog({ orderId, item, candidates, onClose, onSaved }: Props) {
  const [targetId, setTargetId] = useState(() => String(candidates[0]?.id || ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useBackLayer(
    true,
    () => {
      if (saving) return false;
      onClose();
      return true;
    },
    "reallocate-order-item"
  );

  const target = useMemo(
    () => candidates.find(candidate => String(candidate.id) === targetId) || candidates[0],
    [candidates, targetId]
  );

  const paid = Number(item.valor_pago_centavos || 0);
  const targetBalance = Number(target?.saldo_centavos || 0);
  const transferred = Math.min(paid, targetBalance);
  const remaining = Math.max(0, targetBalance - transferred);
  const credit = Math.max(0, paid - transferred);

  async function submit() {
    if (!target || saving) return;
    setSaving(true);
    setError(null);
    try {
      await reallocateOrderItemPayment(orderId, item.id, target.id);
      await onSaved();
      close();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível corrigir o item pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.dialog}>
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar correção"
        disabled={saving}
        onClick={close}
      />

      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="reallocate-title">
        <div className={styles.kicker}>Corrigir item pago</div>
        <h2 className={styles.title} id="reallocate-title">
          {item.produto_nome || "Produto"}
        </h2>
        <p className={styles.description}>
          Este item recebeu {money(paid)}, mas outro produto foi levado pela cliente. Escolha abaixo qual item deve receber esse pagamento.
        </p>

        <div className={styles.box}>
          <span className={styles.label}>Produto que a cliente levou</span>
          <AdminSelect
            value={targetId}
            ariaLabel="Produto que a cliente levou"
            className={styles.select}
            disabled={saving}
            options={candidates.map(candidate => ({
              value: String(candidate.id),
              label: `${candidate.produto_nome || "Produto"} · ${money(candidate.saldo_centavos)} pendente`
            }))}
            onChange={setTargetId}
          />
        </div>

        {target ? (
          <div className={styles.preview}>
            <div className={styles.row}>
              <span>Pagamento realocado</span>
              <strong className={styles.good}>{money(transferred)}</strong>
            </div>
            {remaining > 0 ? (
              <div className={styles.row}>
                <span>Ainda ficará pendente</span>
                <strong className={styles.warn}>{money(remaining)}</strong>
              </div>
            ) : null}
            {credit > 0 ? (
              <div className={styles.row}>
                <span>Crédito que sobra na comanda</span>
                <strong className={styles.good}>{money(credit)}</strong>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className={styles.note}>
          Ao confirmar, o produto antigo será removido da comanda. Se ele já tinha sido baixado, sua quantidade volta ao estoque. O produto escolhido será marcado como o produto efetivamente levado e terá a baixa física aplicada.
        </p>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <div className={styles.actions}>
          <button className={styles.cancel} type="button" disabled={saving} onClick={close}>
            Voltar
          </button>
          <button className={styles.confirm} type="button" disabled={saving || !target} onClick={() => void submit()}>
            {saving ? "Corrigindo..." : "Confirmar correção"}
          </button>
        </div>
      </div>
    </div>
  );
}
