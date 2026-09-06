import { useEffect, useRef, useState } from "react";
import type { OrderStatus } from "./order.api";
import styles from "./OrderStatusSelect.module.css";

const STATUS_LABELS: Record<OrderStatus, string> = {
  NOVO: "Novo",
  PREPARANDO: "Preparando",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado"
};

const STATUSES = Object.keys(STATUS_LABELS) as OrderStatus[];

type Props = {
  orderId: number;
  value: OrderStatus;
  disabled?: boolean;
  onChange: (status: OrderStatus) => void;
};

export function OrderStatusSelect({ orderId, value, disabled = false, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className={styles.control} ref={rootRef}>
      <span className={styles.label}>Andamento</span>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Alterar andamento do pedido ${orderId}`}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
      >
        <span>{STATUS_LABELS[value]}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>

      {open ? (
        <div className={styles.menu} role="listbox" aria-label={`Andamento do pedido ${orderId}`}>
          {STATUSES.map(status => {
            const current = status === value;
            return (
              <button
                key={status}
                className={`${styles.option} ${current ? styles.optionCurrent : ""} ${
                  status === "CANCELADO" ? styles.optionDanger : ""
                }`}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => {
                  setOpen(false);
                  if (!current) onChange(status);
                }}
              >
                <span>{STATUS_LABELS[status]}</span>
                {current ? <span className={styles.check}>✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
