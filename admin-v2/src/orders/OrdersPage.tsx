import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import { ApiClientError } from "../shared/apiClient";
import { listOrders, updateOrderStatus, type OrderStatus } from "./order.api";
import {
  buildOrdersSummary,
  filterOrders,
  itemSummary,
  itemsOf,
  type OrderFilter
} from "./order.model";
import type { Order } from "./order.schema";
import styles from "./OrdersPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NOVO: "Novo",
  PREPARANDO: "Preparando",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado"
};

const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Aguardando pagamento",
  PAGO: "Pagamento confirmado",
  EXPIRADO: "Pix expirado",
  CANCELADO: "Pagamento cancelado",
  ERRO: "Falha no pagamento",
  FALHA: "Falha no pagamento",
  REEMBOLSADO: "Reembolsado"
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: "Pix pelo site",
  PIX_EXTERNO: "Pix direto",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar"
};

function money(cents?: number | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(cents || 0) / 100
  );
}

function dateTime(value?: string | null): string {
  if (!value) return "—";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return text;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function paymentClass(status?: string | null): string {
  const value = String(status || "").toUpperCase();
  if (value === "PAGO") return styles.paid;
  if (value === "PENDENTE") return styles.pending;
  if (value === "REEMBOLSADO") return styles.refunded;
  return styles.failed;
}

function orderClass(status?: string | null): string {
  const value = String(status || "").toUpperCase();
  if (value === "ENTREGUE") return styles.delivered;
  if (value === "CANCELADO") return styles.cancelled;
  if (value === "PRONTO") return styles.ready;
  if (value === "PREPARANDO") return styles.preparing;
  return "";
}

function paymentLabel(status?: string | null): string {
  const value = String(status || "PENDENTE").toUpperCase();
  return PAYMENT_STATUS_LABELS[value] || status || "Aguardando pagamento";
}

function orderLabel(status?: string | null): string {
  const value = String(status || "NOVO").toUpperCase();
  return ORDER_STATUS_LABELS[value as OrderStatus] || status || "Novo";
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function OrderCard({
  order,
  onDetails,
  onStatusChange,
  saving,
  statusError
}: {
  order: Order;
  onDetails: () => void;
  onStatusChange: (status: OrderStatus) => void;
  saving: boolean;
  statusError: string | null;
}) {
  const payment = String(order.status_pagamento || "PENDENTE").toUpperCase();
  const status = String(order.status_pedido || "NOVO").toUpperCase() as OrderStatus;
  const manual = order.origem_pedido === "MANUAL";

  return (
    <article className={`${styles.card} ${payment === "PENDENTE" ? styles.cardPending : ""}`}>
      <div className={styles.cardTop}>
        <div>
          <span className={styles.number}>Pedido #{order.id}{manual ? " · Manual" : ""}</span>
          <h3>{order.cliente_nome || "Cliente não informado"}</h3>
          <p>{itemSummary(order)}</p>
        </div>
        <strong className={styles.cardTotal}>{money(order.valor_total_centavos)}</strong>
      </div>

      <div className={styles.badges}>
        {manual ? <span className={`${styles.badge} ${styles.manual}`}>Pedido manual</span> : null}
        <span className={`${styles.badge} ${paymentClass(payment)}`}>{paymentLabel(payment)}</span>
        <span className={`${styles.badge} ${orderClass(status)}`}>{orderLabel(status)}</span>
        <span className={styles.badge}>{order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada"}</span>
      </div>

      <div className={styles.meta}>
        <span><strong>Criado</strong>{dateTime(order.criado_em)}</span>
        <span><strong>Contato</strong>{order.cliente_whatsapp || order.cliente_email || "—"}</span>
      </div>

      <div className={styles.actions}>
        <button className={styles.secondary} type="button" onClick={onDetails}>Ver detalhes</button>
        <div className={styles.statusControl}>
          <label htmlFor={`order-status-${order.id}`}>Andamento</label>
          <select
            id={`order-status-${order.id}`}
            value={status}
            disabled={saving}
            aria-label={`Alterar andamento do pedido ${order.id}`}
            onChange={event => onStatusChange(event.target.value as OrderStatus)}
          >
            {ORDER_STATUSES.map(value => (
              <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>
            ))}
          </select>
        </div>
        {statusError ? <p className={styles.inlineError} role="alert">{statusError}</p> : null}
      </div>
    </article>
  );
}

function OrderDetails({ order, onClose }: { order: Order; onClose: () => void }) {
  const payment = String(order.status_pagamento || "PENDENTE").toUpperCase();
  const status = String(order.status_pedido || "NOVO").toUpperCase();
  const manual = order.origem_pedido === "MANUAL";
  const items = itemsOf(order);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.dialog}>
      <button className={styles.backdrop} type="button" onClick={onClose} aria-label="Fechar detalhes" />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header className={styles.dialogHead}>
          <div>
            <span>Pedido #{order.id}{manual ? " · Registrado manualmente" : ""}</span>
            <h2 id="order-detail-title">{order.cliente_nome || "Cliente não informado"}</h2>
            <p>{dateTime(order.criado_em)}</p>
          </div>
          <button className={styles.close} type="button" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <div className={styles.dialogStatus}>
          {manual ? <span className={`${styles.badge} ${styles.manual}`}>Pedido manual</span> : null}
          <span className={`${styles.badge} ${paymentClass(payment)}`}>{paymentLabel(payment)}</span>
          <span className={`${styles.badge} ${orderClass(status)}`}>{orderLabel(status)}</span>
        </div>

        <div className={styles.section}>
          <h3>Itens</h3>
          <div className={styles.items}>
            {items.map((item, index) => (
              <div className={styles.item} key={`${item.produto_id ?? "legacy"}-${index}`}>
                <div>
                  <strong>{Number(item.quantidade || 0)}× {item.produto_nome || "Produto"}</strong>
                  <span>{money(item.valor_unitario_centavos)} cada</span>
                </div>
                <strong>{money(item.valor_total_centavos)}</strong>
              </div>
            ))}
          </div>
          <div className={styles.dialogTotal}><span>Total</span><strong>{money(order.valor_total_centavos)}</strong></div>
        </div>

        <div className={styles.detailGrid}>
          <div><span>WhatsApp</span><strong>{order.cliente_whatsapp || "—"}</strong></div>
          <div><span>E-mail</span><strong>{order.cliente_email || "—"}</strong></div>
          <div><span>Recebimento</span><strong>{order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada"}</strong></div>
          <div><span>Método</span><strong>{PAYMENT_METHOD_LABELS[String(order.metodo_pagamento || "PIX")] || order.metodo_pagamento || "Pix"}</strong></div>
        </div>

        {order.observacao ? (
          <div className={styles.note}>
            <span>Observação</span>
            <p>{order.observacao}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function OrdersPage({ session, onNavigate }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("todos");
  const [selected, setSelected] = useState<Order | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<{ id: number; message: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await listOrders());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar os pedidos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const summary = useMemo(() => buildOrdersSummary(orders), [orders]);
  const visible = useMemo(() => filterOrders(orders, filter, query), [orders, filter, query]);

  async function changeStatus(order: Order, nextStatus: OrderStatus) {
    const currentStatus = String(order.status_pedido || "NOVO").toUpperCase();
    if (nextStatus === currentStatus || savingOrderId !== null) return;

    if (
      nextStatus === "CANCELADO" &&
      order.origem_pedido === "MANUAL" &&
      !window.confirm(
        "Cancelar este pedido manual também cancela o pagamento e libera ou restaura o estoque. Deseja continuar?"
      )
    ) {
      return;
    }

    setSavingOrderId(order.id);
    setStatusError(null);
    try {
      await updateOrderStatus(order.id, nextStatus);
      const refreshed = await listOrders();
      setOrders(refreshed);
      if (selected?.id === order.id) {
        setSelected(refreshed.find(item => item.id === order.id) ?? null);
      }
    } catch (err) {
      setStatusError({
        id: order.id,
        message: err instanceof ApiClientError ? err.message : "Não foi possível atualizar o pedido."
      });
    } finally {
      setSavingOrderId(null);
    }
  }

  return (
    <>
      <AdminShell
        session={session}
        activePage="pedidos"
        title="Pedidos"
        subtitle="Acompanhe vendas, pagamentos e andamento"
        onNavigate={onNavigate}
      >
        <section className={styles.view} aria-busy={loading}>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <SearchIcon />
              <input
                type="search"
                placeholder="Buscar pedido ou cliente"
                aria-label="Buscar pedido ou cliente"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </label>
            <button className={styles.secondary} type="button" onClick={() => void reload()} disabled={loading}>
              {loading ? "Atualizando…" : "Atualizar"}
            </button>
          </div>

          <div className={styles.summary}>
            <SummaryCard label="Total" value={summary.total} detail="últimos pedidos" />
            <SummaryCard label="Aguardando" value={summary.pendingPayment} detail="pagamentos pendentes" />
            <SummaryCard label="Pagos" value={summary.paid} detail="pagamentos confirmados" />
            <SummaryCard label="Manuais" value={summary.manual} detail="fora do site" />
            <SummaryCard label="Em andamento" value={summary.active} detail="até a entrega" />
            <SummaryCard label="Entregues" value={summary.delivered} detail="finalizados" />
          </div>

          <div className={styles.filters} aria-label="Filtrar pedidos">
            {([
              ["todos", "Todos"],
              ["pendentes", "Pagamento pendente"],
              ["em-andamento", "Em andamento"],
              ["concluidos", "Concluídos"]
            ] as Array<[OrderFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? styles.active : ""}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <div className={styles.error} role="alert">
              <strong>Não foi possível carregar os pedidos</strong>
              <span>{error}</span>
              <button className={styles.secondary} type="button" onClick={() => void reload()}>Tentar novamente</button>
            </div>
          ) : (
            <div className={styles.list}>
              {visible.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onDetails={() => setSelected(order)}
                  onStatusChange={status => void changeStatus(order, status)}
                  saving={savingOrderId === order.id}
                  statusError={statusError?.id === order.id ? statusError.message : null}
                />
              ))}
              {!loading && visible.length === 0 ? (
                <div className={styles.empty}>
                  <strong>Nenhum pedido encontrado</strong>
                  <span>Ajuste a busca ou os filtros para ver outros pedidos.</span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </AdminShell>

      {selected ? <OrderDetails order={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
