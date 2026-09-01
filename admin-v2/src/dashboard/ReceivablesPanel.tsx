import { useMemo, useState } from "react";
import type { FinancialOrder } from "../orders/order.finance";
import styles from "./ReceivablesPanel.module.css";

type Props = {
  orders: FinancialOrder[];
  onOpenOrder: (order: FinancialOrder) => void;
};

function money(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

function itemStateLabel(status: FinancialOrder["itens"][number]["status_financeiro"]): string {
  if (status === "PAGO") return "Pago";
  if (status === "PARCIAL") return "Parcial";
  return "Pendente";
}

function itemStateClass(status: FinancialOrder["itens"][number]["status_financeiro"]): string {
  if (status === "PAGO") return styles.paid;
  if (status === "PARCIAL") return styles.partial;
  return styles.pending;
}

export function ReceivablesPanel({ orders, onOpenOrder }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const receivables = useMemo(
    () => orders.filter(order => order.saldo_centavos > 0 && order.status_pedido !== "CANCELADO"),
    [orders]
  );
  const pendingTotal = useMemo(
    () => receivables.reduce((sum, order) => sum + order.saldo_centavos, 0),
    [receivables]
  );

  return (
    <section className={styles.panel} aria-label="Pagamentos pendentes">
      <header className={styles.head}>
        <div>
          <strong>Pagamentos pendentes</strong>
          <span>{receivables.length} cliente{receivables.length === 1 ? "" : "s"} com saldo a receber</span>
        </div>
        <span className={styles.totalPending}>{money(pendingTotal)}</span>
      </header>

      {receivables.length ? (
        <div className={styles.list}>
          {receivables.slice(0, 6).map(order => {
            const expanded = expandedId === order.id;
            return (
              <article className={styles.row} key={order.id}>
                <button
                  className={styles.trigger}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`receivable-${order.id}`}
                  onClick={() => setExpandedId(current => current === order.id ? null : order.id)}
                >
                  <span className={styles.customer}>
                    <strong>{order.cliente_nome || "Cliente não informado"}</strong>
                    <small>Pedido #{order.id} · {order.itens.length} item{order.itens.length === 1 ? "" : "s"}</small>
                  </span>
                  <span className={styles.balance}>{money(order.saldo_centavos)} pendentes</span>
                  <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 9 5 5 5-5" />
                  </svg>
                </button>

                {expanded ? (
                  <div className={styles.details} id={`receivable-${order.id}`}>
                    <div className={styles.items}>
                      {order.itens.map(item => (
                        <div className={styles.item} key={item.id}>
                          <span className={styles.itemCopy}>
                            <strong>{item.quantidade}× {item.produto_nome || "Produto"}</strong>
                            <small>
                              {item.status_financeiro === "PAGO"
                                ? `${money(item.valor_pago_centavos)} pagos`
                                : item.status_financeiro === "PARCIAL"
                                  ? `${money(item.valor_pago_centavos)} pagos · ${money(item.saldo_centavos)} pendentes`
                                  : `${money(item.saldo_centavos)} pendentes`}
                            </small>
                          </span>
                          <span className={styles.itemValue}>{money(item.valor_total_centavos)}</span>
                          <span className={`${styles.state} ${itemStateClass(item.status_financeiro)}`}>
                            {itemStateLabel(item.status_financeiro)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className={styles.summary}>
                      <span>Total<strong>{money(order.valor_total_centavos)}</strong></span>
                      <span>Pago<strong>{money(order.valor_pago_centavos)}</strong></span>
                      <span>Restante<strong>{money(order.saldo_centavos)}</strong></span>
                      <button className={styles.open} type="button" onClick={() => onOpenOrder(order)}>
                        Abrir comanda
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>Nenhum valor pendente</strong>
          <span>As comandas com saldo a receber aparecerão aqui.</span>
        </div>
      )}
    </section>
  );
}
