import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import type { FinancialOrder } from "../orders/order.finance";
import { ApiClientError } from "../shared/apiClient";
import { loadDashboardData, type DashboardData } from "./dashboard.api";
import {
  buildDashboardSummary,
  dashboardAvailableStock,
  dashboardOrderItemsCount,
  parseDashboardDate,
  sameLocalDay
} from "./dashboard.model";
import { ReceivablesPanel } from "./ReceivablesPanel";
import styles from "./DashboardPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
  active: boolean;
};

type CalendarCell = {
  date: Date;
  outside: boolean;
};

const DASHBOARD_AUTO_REFRESH_MS = 15_000;
let dashboardCache: DashboardData | null = null;

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
  if (normalized === "PAGO") return styles.tagGreen;
  if (["PENDENTE", "PARCIAL"].includes(normalized)) return styles.tagOrange;
  return styles.tagGray;
}

function orderTone(status?: string | null): string {
  const normalized = String(status || "").toUpperCase();
  if (["PRONTO", "CONCLUIDO", "CONCLUÍDO", "ENTREGUE"].includes(normalized)) return styles.tagGreen;
  if (["EM_PREPARO", "EM PREPARO", "PREPARANDO"].includes(normalized)) return styles.tagOrange;
  return styles.tagGray;
}

function humanPaymentStatus(status?: string | null): string {
  const normalized = String(status || "PENDENTE").toUpperCase();
  const labels: Record<string, string> = {
    PAGO: "Pago",
    PARCIAL: "Parcial",
    PENDENTE: "Aguardando",
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
    ENTREGUE: "Entregue",
    CANCELADO: "Cancelado",
    ARQUIVADO: "Arquivado"
  };
  return labels[normalized] || status || "Novo";
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function daySubtitle(offset: number): string {
  if (offset === 0) return "Hoje";
  if (offset === -1) return "Ontem";
  if (offset === 1) return "Amanhã";
  return offset < 0 ? `${Math.abs(offset)} dias atrás` : `Em ${offset} dias`;
}

function monthLabel(year: number, month: number): string {
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function calendarCells(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, outside: date.getMonth() !== month };
  });
}

function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sameDashboard(left: DashboardData | null, right: DashboardData) {
  if (!left) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function RecentOrder({ order }: { order: FinancialOrder }) {
  const itemCount = dashboardOrderItemsCount(order);

  return (
    <article className={styles.orderRow}>
      <div>
        <span className={styles.orderId}>RP-{order.id}</span>
        <span className={styles.orderTime}>{time(order.criado_em)}</span>
      </div>
      <div className={styles.orderClient}>
        <strong>{order.cliente_nome || "Cliente"}</strong>
        <small>{order.cliente_whatsapp || order.cliente_email || "—"}</small>
      </div>
      <div className={styles.orderItems}>{itemCount} {itemCount === 1 ? "item" : "itens"}</div>
      <span className={`${styles.tag} ${paymentTone(order.status_financeiro)}`}>
        {humanPaymentStatus(order.status_financeiro)}
      </span>
      <span className={`${styles.tag} ${orderTone(order.status_pedido)}`}>
        {humanOrderStatus(order.status_pedido)}
      </span>
      <div className={styles.orderTotal}>{money(order.valor_total_centavos)}</div>
    </article>
  );
}

export function DashboardPage({ session, onNavigate, active }: Props) {
  const [data, setData] = useState<DashboardData | null>(() => dashboardCache);
  const [loading, setLoading] = useState(() => dashboardCache === null);
  const [error, setError] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const anchorDate = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  const selectedDate = useMemo(() => {
    const date = new Date(anchorDate);
    date.setDate(anchorDate.getDate() + dayOffset);
    return date;
  }, [anchorDate, dayOffset]);
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const calendarRef = useRef<HTMLDivElement>(null);
  const autoRefreshInFlightRef = useRef(false);

  const reload = useCallback(async (silent = false) => {
    const foreground = !silent && dashboardCache === null;
    if (foreground) setLoading(true);
    if (!silent) setError(null);

    try {
      const next = await loadDashboardData();
      const previous = dashboardCache;
      dashboardCache = next;
      if (!sameDashboard(previous, next)) {
        setData(next);
      }
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar o dashboard.");
      }
    } finally {
      if (foreground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const refresh = (silent: boolean) => {
      if (!alive || document.visibilityState !== "visible" || autoRefreshInFlightRef.current) return;
      autoRefreshInFlightRef.current = true;
      void reload(silent).finally(() => {
        autoRefreshInFlightRef.current = false;
      });
    };

    refresh(dashboardCache !== null);

    const intervalId = window.setInterval(() => refresh(true), DASHBOARD_AUTO_REFRESH_MS);
    const handleResume = () => refresh(true);

    window.addEventListener("focus", handleResume);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [active, reload]);

  useEffect(() => {
    if (!calendarOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!calendarRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [calendarOpen]);

  const summary = useMemo(
    () => data ? buildDashboardSummary(data.orders, data.products) : null,
    [data]
  );

  const financial = useMemo(() => {
    if (!data) return null;
    const paidOnSelectedDay = data.orders.flatMap(order =>
      order.pagamentos.filter(payment =>
        payment.status === "PAGO" &&
        sameLocalDay(parseDashboardDate(payment.pago_em || payment.atualizado_em), selectedDate)
      )
    );
    const receivables = data.orders.filter(
      order => order.saldo_centavos > 0 && order.status_pedido !== "CANCELADO"
    );
    const openCommands = data.orders.filter(
      order => String(order.status_comanda || "ABERTA").toUpperCase() === "ABERTA" &&
        String(order.status_pedido || "").toUpperCase() !== "CANCELADO"
    );

    return {
      received: paidOnSelectedDay.reduce((sum, payment) => sum + payment.valor_centavos, 0),
      receivedCount: paidOnSelectedDay.length,
      receivableTotal: receivables.reduce((sum, order) => sum + order.saldo_centavos, 0),
      receivableCount: receivables.length,
      openCommandsCount: openCommands.length
    };
  }, [data, selectedDate]);

  const topFlavors = useMemo(() => {
    if (!data) return [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const productById = new Map(data.products.map(product => [product.id, product]));
    const counts = new Map<string, { name: string; category: string; count: number }>();

    data.orders.forEach(order => {
      const paidAt = parseDashboardDate(order.pago_em || order.atualizado_em || order.criado_em);
      if (order.status_financeiro !== "PAGO" || !paidAt || paidAt.getTime() < cutoff) return;

      order.itens.forEach(item => {
        const name = item.produto_nome || "Produto";
        const product = item.produto_id ? productById.get(item.produto_id) : undefined;
        const category = product?.categoria_nome || product?.categoria || "Catálogo";
        const key = `${item.produto_id || name}`;
        const current = counts.get(key) || { name, category, count: 0 };
        current.count += Number(item.quantidade || 0);
        counts.set(key, current);
      });
    });

    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  }, [data]);

  const attention = useMemo(() => {
    if (!data || !summary || !financial) return [];
    const messages: string[] = [];
    if (financial.receivableCount) {
      messages.push(`${financial.receivableCount} cliente${financial.receivableCount === 1 ? "" : "s"} com saldo pendente (${money(financial.receivableTotal)} no total)`);
    }
    const soldOut = data.products.filter(product => product.ativo && dashboardAvailableStock(product) <= 0);
    if (soldOut.length) {
      messages.push(`${soldOut.length} produto${soldOut.length === 1 ? " esgotado" : "s esgotados"}: ${soldOut.slice(0, 2).map(product => product.nome).join(", ")}`);
    }
    if (summary.waitingPreparationCount) {
      messages.push(`${summary.waitingPreparationCount} pedido${summary.waitingPreparationCount === 1 ? " pago aguardando" : "s pagos aguardando"} início do preparo`);
    }
    if (!messages.length && summary.lowStockCount) {
      messages.push(`${summary.lowStockCount} produto${summary.lowStockCount === 1 ? "" : "s"} com estoque baixo`);
    }
    return messages;
  }, [data, financial, summary]);

  const cells = useMemo(() => calendarCells(viewYear, viewMonth), [viewMonth, viewYear]);
  const topFlavorTotal = topFlavors.reduce((sum, flavor) => sum + flavor.count, 0);
  const maxFlavor = Math.max(...topFlavors.map(flavor => flavor.count), 1);
  const currentMonthIndex = anchorDate.getFullYear() * 12 + anchorDate.getMonth();
  const viewMonthIndex = viewYear * 12 + viewMonth;
  const viewingCurrentMonth = viewMonthIndex >= currentMonthIndex;

  function openCalendar() {
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
    setCalendarOpen(open => !open);
  }

  function selectCalendarDate(date: Date) {
    const dayMs = 24 * 60 * 60 * 1000;
    const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (normalized.getTime() > anchorDate.getTime()) return;
    const offset = Math.round((normalized.getTime() - anchorDate.getTime()) / dayMs);
    setDayOffset(Math.min(0, offset));
    setViewYear(normalized.getFullYear());
    setViewMonth(normalized.getMonth());
    setCalendarOpen(false);
  }

  function goToNextMonth() {
    if (viewingCurrentMonth) return;
    if (viewMonth === 11) {
      setViewYear(year => year + 1);
      setViewMonth(0);
      return;
    }
    setViewMonth(month => month + 1);
  }

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
            {Array.from({ length: 5 }, (_, index) => <span className={styles.skeletonMetric} key={index} />)}
          </div>
          <div className={`${styles.panel} ${styles.skeletonPanel}`} />
        </section>
      ) : error && !summary ? (
        <section className={`${styles.panel} ${styles.error}`}>
          <strong>Não conseguimos carregar o dashboard.</strong>
          <span>{error}</span>
          <button className={styles.secondaryButton} type="button" onClick={() => void reload()}>Tentar novamente</button>
        </section>
      ) : summary && financial && data ? (
        <section className={styles.dashboard} aria-label="Resumo da operação">
          <div className={styles.dayNav}>
            <div className={styles.dayNavTitle}>
              <strong>Resultados por dia</strong>
              <span>{daySubtitle(dayOffset)}</span>
            </div>
            <div className={styles.dayNavControls}>
              <button className={styles.dayArrow} type="button" aria-label="Dia anterior" onClick={() => setDayOffset(offset => offset - 1)}>‹</button>
              <div className={styles.calendarWrap} ref={calendarRef}>
                <button className={styles.dayDate} type="button" onClick={openCalendar}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
                  <span>{formatDate(selectedDate)}</span>
                </button>
                {calendarOpen ? (
                  <div className={styles.calendarPopover}>
                    <div className={styles.calendarHead}>
                      <button type="button" aria-label="Mês anterior" onClick={() => setViewMonth(month => month === 0 ? (setViewYear(year => year - 1), 11) : month - 1)}>‹</button>
                      <span>{monthLabel(viewYear, viewMonth)}</span>
                      <button type="button" aria-label="Próximo mês" disabled={viewingCurrentMonth} onClick={goToNextMonth}>›</button>
                    </div>
                    <div className={styles.weekdays}>
                      {['dom','seg','ter','qua','qui','sex','sáb'].map(day => <span key={day}>{day}</span>)}
                    </div>
                    <div className={styles.calendarGrid}>
                      {cells.map(cell => {
                        const future = cell.date.getTime() > anchorDate.getTime();
                        return (
                          <button
                            key={cell.date.toISOString()}
                            type="button"
                            disabled={future}
                            aria-disabled={future}
                            className={`${styles.calendarDay} ${cell.outside ? styles.outside : ""} ${sameDate(cell.date, selectedDate) ? styles.selected : ""} ${sameDate(cell.date, anchorDate) ? styles.today : ""}`}
                            onClick={() => selectCalendarDate(cell.date)}
                          >
                            {cell.date.getDate()}
                          </button>
                        );
                      })}
                    </div>
                    <button className={styles.calendarClear} type="button" onClick={() => { setDayOffset(0); setCalendarOpen(false); }}>Limpar</button>
                  </div>
                ) : null}
              </div>
              <button
                className={styles.dayArrow}
                type="button"
                aria-label="Próximo dia"
                disabled={dayOffset >= 0}
                onClick={() => setDayOffset(offset => Math.min(0, offset + 1))}
              >›</button>
              <button className={`${styles.secondaryButton} ${dayOffset === 0 ? styles.currentDay : ""}`} type="button" onClick={() => setDayOffset(0)}>Hoje</button>
            </div>
          </div>

          <div className={styles.metrics}>
            <article className={`${styles.metric} ${styles.featured}`}>
              <span className={styles.metricLabel}>{dayOffset === 0 ? "Recebido hoje" : "Recebido no dia"}</span>
              <strong>{money(financial.received)}</strong>
              <small>{financial.receivedCount} pagamento{financial.receivedCount === 1 ? " confirmado" : "s confirmados"}</small>
            </article>
            <article className={`${styles.metric} ${financial.receivableCount ? styles.warning : ""}`}>
              <span className={styles.metricLabel}>A receber</span>
              <strong>{money(financial.receivableTotal)}</strong>
              <small>{financial.receivableCount} cliente{financial.receivableCount === 1 ? "" : "s"} com saldo pendente</small>
            </article>
            <article className={styles.metric}>
              <span className={styles.metricLabel}>Comandas abertas</span>
              <strong>{financial.openCommandsCount}</strong>
              <small>Clientes ainda em atendimento</small>
            </article>
            <article className={`${styles.metric} ${summary.waitingPreparationCount ? styles.warning : ""}`}>
              <span className={styles.metricLabel}>Aguardando preparo</span>
              <strong>{summary.waitingPreparationCount}</strong>
              <small>Pedidos pagos que ainda estão novos</small>
            </article>
            <article className={`${styles.metric} ${summary.soldOutCount || summary.lowStockCount ? styles.warning : ""}`}>
              <span className={styles.metricLabel}>Catálogo</span>
              <strong>{summary.productCount}</strong>
              <small>{summary.soldOutCount} esgotado{summary.soldOutCount === 1 ? "" : "s"} · {summary.lowStockCount} estoque baixo</small>
            </article>
          </div>

          <div className={`${styles.gridTwo} ${styles.topGrid}`}>
            <section className={styles.panel} aria-label="Sabores de bolo mais vendidos">
              <header className={styles.panelHead}>
                <div>
                  <strong>Sabores de bolo mais vendidos</strong>
                  <span>Últimos 30 dias · pedidos pagos · {topFlavorTotal} unidades no Top 4</span>
                </div>
              </header>
              {topFlavors.length ? topFlavors.map((flavor, index) => (
                <div className={styles.flavorRow} key={`${flavor.name}-${index}`}>
                  <div className={styles.flavorRank}>{index + 1}</div>
                  <div className={styles.flavorInfo}>
                    <strong>{flavor.name}</strong>
                    <span className={styles.flavorCategory}>{flavor.category}</span>
                    <div className={styles.flavorBarTrack}>
                      <div className={styles.flavorBarFill} style={{ width: `${Math.round((flavor.count / maxFlavor) * 100)}%` }} />
                    </div>
                  </div>
                  <div className={styles.flavorCount}>
                    <strong>{flavor.count} un.</strong>
                    <small>≈ {(flavor.count / 4.3).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/sem</small>
                  </div>
                </div>
              )) : (
                <div className={styles.emptyCompact}>Ainda não há vendas pagas suficientes para formar o ranking.</div>
              )}
            </section>

            <ReceivablesPanel orders={data.orders} onOpenOrder={() => onNavigate("pedidos")} />
          </div>

          <div className={styles.gridTwo}>
            <section className={styles.panel}>
              <header className={styles.panelHead}>
                <div>
                  <strong>Pedidos recentes</strong>
                  <span>Últimas movimentações da loja</span>
                </div>
                <button className={styles.panelLink} type="button" onClick={() => onNavigate("pedidos")}>Ver pedidos</button>
              </header>

              {data.orders.length ? data.orders.slice(0, 4).map(order => <RecentOrder key={order.id} order={order} />) : (
                <div className={styles.emptyCompact}>Os pedidos mais recentes aparecerão nesta área.</div>
              )}
            </section>

            <aside className={styles.panel}>
              <header className={styles.panelHead}>
                <div>
                  <strong>Precisa de atenção</strong>
                  <span>Pontos que podem exigir uma ação</span>
                </div>
              </header>
              {attention.length ? (
                <ul className={styles.attentionList}>
                  {attention.map(item => <li key={item}><span className={styles.dot} />{item}</li>)}
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
