import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import type { FinancialOrder } from "../orders/order.finance";
import { ApiClientError } from "../shared/apiClient";
import { loadDashboardData, type DashboardData } from "./dashboard.api";
import {
  buildDashboardSummary,
  dashboardOrderItemsCount,
  parseDashboardDate,
  sameLocalDay
} from "./dashboard.model";
import { ReceivablesPanel } from "./ReceivablesPanel";
import styles from "./DashboardPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

function money(cents: number): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function time(value?: string | null): string {
  const date = parseDashboardDate(value);
  return date ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function paymentTone(status?: string | null): string {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAGO") return styles.pillSuccess;
  if (["PENDENTE", "PARCIAL"].includes(normalized)) return styles.pillWarning;
  if (["CANCELADO", "FALHA", "REEMBOLSADO"].includes(normalized)) return styles.pillDanger;
  return "";
}

function orderTone(status?: string | null): string {
  const normalized = String(status || "").toUpperCase();
  if (["PRONTO", "CONCLUIDO", "CONCLUÍDO"].includes(normalized)) return styles.pillSuccess;
  if (normalized === "NOVO") return styles.pillBrand;
  if (["EM_PREPARO", "EM PREPARO", "PREPARANDO"].includes(normalized)) return styles.pillWarning;
  return "";
}

function humanPaymentStatus(status?: string | null): string {
  const normalized = String(status || "PENDENTE").toUpperCase();
  const labels: Record<string, string> = {
    PAGO: "Pago",
    PARCIAL: "Pagamento parcial",
    PENDENTE: "Aguardando pagamento",
    CANCELADO: "Cancelado",
    FALHA: "Falha",
    REEMBOLSADO: "Reembolsado"
  };
  return labels[normalized] || status || "Pendente";
}

function humanOrderStatus(status?: string | null): string {
  const normalized = String(status || "NOVO").toUpperCase();
  const labels: Record<string, string> = {
    NOVO: "Novo",
    EM_PREPARO: "Em preparo",
    "EM PREPARO": "Em preparo",
    PREPARANDO: "Em preparo",
    PRONTO: "Pronto",
    CONCLUIDO: "Concluído",
    "CONCLUÍDO": "Concluído",
    CANCELADO: "Cancelado",
    ARQUIVADO: "Arquivado"
  };
  return labels[normalized] || status || "Novo";
}

function CustomerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.4" r="3.1" />
      <path d="M6.2 18.6c.9-2.9 3-4.5 5.8-4.5s4.9 1.6 5.8 4.5" />
    </svg>
  );
}

function RecentOrder({ order }: { order: FinancialOrder }) {
  const itemCount = dashboardOrderItemsCount(order);

  return (
    <article className={styles.order}>
      <div className={styles.orderId} data-label="Pedido">
        <strong>RP-{order.id}</strong>
        <span>{time(order.criado_em)}</span>
      </div>
      <div className={styles.customer} data-label="Cliente">
        <span className={styles.customerAvatar} aria-hidden="true"><CustomerIcon /></span>
        <span>
          <strong>{order.cliente_nome || "Cliente"}</strong>
          <small>{order.cliente_whatsapp || order.cliente_email || ""}</small>
        </span>
      </div>
      <div data-label="Itens">{itemCount} {itemCount === 1 ? "item" : "itens"}</div>
      <div data-label="Pagamento">
        <span className={`${styles.pill} ${paymentTone(order.status_financeiro)}`}>
          {humanPaymentStatus(order.status_financeiro)}
        </span>
      </div>
      <div data-label="Andamento">
        <span className={`${styles.pill} ${orderTone(order.status_pedido)}`}>
          {humanOrderStatus(order.status_pedido)}
        </span>
      </div>
      <div className={styles.total} data-label="Total">{money(order.valor_total_centavos)}</div>
    </article>
  );
}

export function DashboardPage({ session, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadDashboardData());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const summary = useMemo(
    () => data ? buildDashboardSummary(data.orders, data.products) : null,
    [data]
  );

  const financial = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const paidToday = data.orders.flatMap(order =>
      order.pagamentos.filter(payment =>
        payment.status === "PAGO" &&
        sameLocalDay(parseDashboardDate(payment.pago_em || payment.atualizado_em), now)
      )
    );
    const receivables = data.orders.filter(
      order => order.saldo_centavos > 0 && order.status_pedido !== "CANCELADO"
    );
    const openCommands = data.orders.filter(
      order => !["ENTREGUE", "CANCELADO"].includes(String(order.status_pedido || "").toUpperCase())
    );

    return {
      receivedToday: paidToday.reduce((sum, payment) => sum + payment.valor_centavos, 0),
      receivedTodayCount: paidToday.length,
      receivableTotal: receivables.reduce((sum, order) => sum + order.saldo_centavos, 0),
      receivableCount: receivables.length,
      openCommandsCount: openCommands.length
    };
  }, [data]);

  return (
    <AdminShell
      session={session}
      activePage="dashboard"
      title="Dashboard"
      subtitle="Visão geral da operação"
      onNavigate={onNavigate}
    >
      {loading && !summary ? (
        <section className={styles.dashboard} aria-label="Carregando dashboard">
          <div className={styles.metrics}>
            {Array.from({ length: 5 }, (_, index) => <span className={styles.skeleton} key={index} />)}
          </div>
          <div className={`${styles.panel} ${styles.skeleton} ${styles.skeletonLarge}`} />
        </section>
      ) : error && !summary ? (
        <section className={`${styles.panel} ${styles.error}`}>
          <strong>Não conseguimos carregar o dashboard.</strong>
          <span>{error}</span>
          <button className={styles.retry} type="button" onClick={() => void reload()}>Tentar novamente</button>
        </section>
      ) : summary && financial && data ? (
        <section className={styles.dashboard} aria-label="Resumo da operação">
          <div className={styles.metrics}>
            <article className={`${styles.metric} ${styles.featured}`}>
              <span className={styles.metricLabel}>Recebido hoje</span>
              <strong>{money(financial.receivedToday)}</strong>
              <small>{financial.receivedTodayCount} pagamento{financial.receivedTodayCount === 1 ? " confirmado" : "s confirmados"}</small>
            </article>
            <article className={`${styles.metric} ${financial.receivableCount ? styles.warning : styles.success}`}>
              <span className={styles.metricLabel}>A receber</span>
              <strong>{money(financial.receivableTotal)}</strong>
              <small>{financial.receivableCount} cliente{financial.receivableCount === 1 ? "" : "s"} com saldo pendente</small>
            </article>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>Comandas abertas</span>
              <strong>{financial.openCommandsCount}</strong>
              <small>Clientes ainda em atendimento</small>
            </article>
            <article className={`${styles.metric} ${summary.waitingPreparationCount ? styles.warning : styles.success}`}>
              <span className={styles.metricLabel}>Aguardando preparo</span>
              <strong>{summary.waitingPreparationCount}</strong>
              <small>Pedidos pagos que ainda estão novos</small>
            </article>
            <article className={`${styles.metric} ${summary.soldOutCount || summary.lowStockCount ? styles.warning : styles.success}`}>
              <span className={styles.metricLabel}>Catálogo</span>
              <strong>{summary.productCount}</strong>
              <small>{summary.soldOutCount} esgotado{summary.soldOutCount === 1 ? "" : "s"} · {summary.lowStockCount} estoque baixo</small>
            </article>
          </div>

          <ReceivablesPanel orders={data.orders} onOpenOrder={() => onNavigate("pedidos")} />

          <div className={styles.grid}>
            <section className={styles.panel}>
              <header className={styles.sectionHead}>
                <div>
                  <strong>Pedidos recentes</strong>
                  <span>Últimas movimentações da loja</span>
                </div>
                <button className={styles.link} type="button" onClick={() => onNavigate("pedidos")}>Ver pedidos</button>
              </header>

              {summary.recentOrders.length ? (
                <div>
                  <div className={styles.ordersHead} aria-hidden="true">
                    <span>Pedido</span><span>Cliente</span><span>Itens</span><span>Pagamento</span><span>Andamento</span><span>Total</span>
                  </div>
                  {data.orders.slice(0, 6).map(order => <RecentOrder key={order.id} order={order} />)}
                </div>
              ) : (
                <div className={styles.empty}>
                  <strong>Nenhum pedido por aqui ainda.</strong>
                  <span>Os pedidos mais recentes aparecerão nesta área.</span>
                </div>
              )}
            </section>

            <aside className={`${styles.panel} ${styles.attention}`}>
              <header className={styles.sectionHead}>
                <div>
                  <strong>Precisa de atenção</strong>
                  <span>Pontos que podem exigir uma ação</span>
                </div>
              </header>
              {summary.attention.length ? (
                <ul>
                  {summary.attention.map(item => <li key={item}><span className={styles.dot} />{item}</li>)}
                </ul>
              ) : (
                <div className={styles.attentionOk}>
                  <span>✓</span>
                  <div>
                    <strong>Tudo tranquilo por aqui</strong>
                    <small>Nenhuma pendência operacional detectada.</small>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      ) : null}
    </AdminShell>
  );
}
