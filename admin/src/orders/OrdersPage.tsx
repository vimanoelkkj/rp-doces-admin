import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import { ApiClientError } from "../shared/apiClient";
import { AdminSelect } from "../shared/AdminSelect";
import { useBackLayer } from "../shared/useBackLayer";
import {
  deleteOrderItem,
  listOrders,
  reopenPaidCommand,
  updateManualPayment,
  updateOrderStatus,
  type ManualPaymentStatus,
  type OrderStatus
} from "./order.api";
import {
  getFinancialOrder,
  registerComandaPayment,
  type FinancialOrder,
  type FinancialOrderItem,
  type ManualComandaPaymentMethod
} from "./order.finance";
import { itemsOf } from "./order.model";
import type { Order, OrderItem } from "./order.schema";
import { EditOrderItemDialog } from "./EditOrderItemDialog";
import { ManualOrderDialog } from "./ManualOrderDialog";
import { ReallocateOrderItemDialog } from "./ReallocateOrderItemDialog";
import styles from "./OrdersPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
  active: boolean;
};

type FilterKey = "todos" | "hoje" | "producao" | "prontos" | "entregues";
type DrawerTab = "pedido" | "comanda";
type IconName = "search" | "bag" | "truck" | "receipt" | "edit";

const ORDER_STATUS_OPTIONS: Array<[OrderStatus, string]> = [
  ["NOVO", "Pendente"],
  ["PREPARANDO", "Em produção"],
  ["PRONTO", "Pronto"],
  ["ENTREGUE", "Entregue"],
  ["CANCELADO", "Cancelado"]
];

const PAYMENT_STATUS_OPTIONS: Array<[ManualPaymentStatus, string]> = [
  ["PENDENTE", "Pendente"],
  ["PAGO", "Pago"],
  ["CANCELADO", "Cancelado"]
];

const MANUAL_PAYMENT_METHOD_OPTIONS: Array<[ManualComandaPaymentMethod, string]> = [
  ["PIX_EXTERNO", "Pix direto"],
  ["CARTAO", "Cartão"],
  ["DINHEIRO", "Dinheiro"]
];

const FILTER_OPTIONS: Array<[FilterKey, string]> = [
  ["todos", "Todos"],
  ["hoje", "Hoje"],
  ["producao", "Em produção"],
  ["prontos", "Prontos"],
  ["entregues", "Entregues"]
];

const ORDER_AUTO_REFRESH_MS = 10_000;
let ordersCache: Order[] | null = null;

const editSelectStyle: CSSProperties = {
  width: "100%",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  border: "1px solid var(--line-strong)",
  borderRadius: 9,
  padding: "0 12px",
  background: "var(--surface)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 12,
  outline: "none",
  textAlign: "left"
};

const mobileFilterSelectStyle: CSSProperties = {
  ...editSelectStyle,
  minWidth: 0,
  borderRadius: 10,
  padding: "0 12px",
  fontWeight: 700
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    bag: <><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    truck: <><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    edit: <><path d="M4 20h4L18 10l-4-4L4 16v4Z"/><path d="M13 7l4 4"/></>
  };

  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function cls(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).map(name => styles[name as string]).join(" ");
}

function money(cents?: number | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(value?: string | null) {
  const date = parseDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function scheduleLabel(order: Order) {
  const date = parseDate(order.criado_em);
  if (!date) return "—";
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (isToday(order.criado_em)) return `Hoje, ${time}`;
  return `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date)}, ${time}`;
}

function orderStatus(order: Order): { label: string; tone: "orange" | "green" | "purple" | "pink" } {
  switch (String(order.status_pedido || "NOVO").toUpperCase()) {
    case "PREPARANDO": return { label: "Em produção", tone: "orange" };
    case "PRONTO": return { label: "Pronto", tone: "green" };
    case "ENTREGUE": return { label: "Entregue", tone: "purple" };
    case "CANCELADO": return { label: "Cancelado", tone: "pink" };
    default: return { label: "Pendente", tone: "orange" };
  }
}

function paymentInfo(order: Order) {
  const status = String(order.status_pagamento || "PENDENTE").toUpperCase();
  if (status === "PAGO") return { paid: true, label: "Pago" };
  return { paid: false, label: "Pendente" };
}

function paymentMethod(order: Order) {
  const method = String(order.metodo_pagamento || "").toUpperCase();
  if (method.includes("PIX")) return "Pix";
  if (method.includes("CART")) return "Cartão";
  if (method.includes("DINHEIRO")) return "Dinheiro";
  return order.metodo_pagamento || "—";
}

function orderItems(order: Order): OrderItem[] {
  const items = itemsOf(order);
  if (items.length) return items;
  return [{
    produto_id: order.produto_id,
    produto_nome: order.produto_nome,
    quantidade: order.quantidade,
    valor_unitario_centavos: order.valor_unitario_centavos,
    valor_total_centavos: order.valor_total_centavos
  }];
}

function productSummary(order: Order) {
  const items = orderItems(order);
  const first = items[0]?.produto_nome || "Pedido sem itens";
  return { first, extra: Math.max(0, items.length - 1) };
}

function comandaState(order: Order) {
  const state = String(order.status_comanda || "").toUpperCase();
  if (!state) return null;
  return state === "ENCERRADA" ? "Fechada" : "Aberta";
}

function comandaNumber(order: Order) {
  return `#${order.id}`;
}

function normalizeOrderStatus(order: Order): OrderStatus {
  const value = String(order.status_pedido || "NOVO").toUpperCase();
  return ORDER_STATUS_OPTIONS.some(([status]) => status === value) ? value as OrderStatus : "NOVO";
}

function normalizeManualPayment(order: Order): ManualPaymentStatus {
  const value = String(order.status_pagamento || "PENDENTE").toUpperCase();
  return PAYMENT_STATUS_OPTIONS.some(([status]) => status === value) ? value as ManualPaymentStatus : "PENDENTE";
}

function sameOrder(left?: Order | null, right?: Order | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameOrders(left: Order[] | null, right: Order[]) {
  if (!left || left.length !== right.length) return false;
  return left.every((order, index) => sameOrder(order, right[index]));
}

function OrderRow({
  order,
  selected,
  onSelect
}: {
  order: Order;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = orderStatus(order);
  const payment = paymentInfo(order);
  const product = productSummary(order);
  const comanda = comandaState(order);
  const delivery = order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada";

  return (
    <div
      className={cls("order-row", selected && "selected")}
      data-order={order.id}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
    >
      <div className={styles["order-id"]}>#{order.id}</div>
      <div className={styles.stack}>
        <span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span>
      </div>
      <div className={styles.stack}>
        <span>{product.first}</span>
        {product.extra > 0 ? <span className={styles.secondary}>+ {product.extra} itens</span> : null}
      </div>
      <div className={styles.stack}>
        {comanda ? (
          <>
            <span>Comanda {comandaNumber(order)}</span>
            <span className={cls("dotline", comanda === "Aberta" ? "open" : "closed")}>
              <span className={styles.dot}/>{comanda}
            </span>
          </>
        ) : (
          <>
            <span className={styles.secondary} style={{ margin: 0 }}>Sem comanda</span>
            <span className={styles.secondary}>—</span>
          </>
        )}
      </div>
      <div className={styles.stack}>
        <span>
          <Icon name={delivery === "Entrega" ? "truck" : "bag"} className={styles["row-ico"]}/>
          {scheduleLabel(order)}
        </span>
        <span className={styles.secondary}>{delivery}</span>
      </div>
      <div><span className={cls("tag", status.tone)}>{status.label}</span></div>
      <div className={styles.stack}>
        {payment.paid ? (
          <span className={styles["payment-ok"]}><span className={styles.check}>✓</span> Pago</span>
        ) : (
          <span className={styles["payment-pending"]}>Pendente</span>
        )}
        <span className={styles.secondary}>{payment.paid ? paymentMethod(order) : "—"}</span>
      </div>
      <div className={styles.money}>{money(order.valor_total_centavos)}</div>
      <div className={styles.chev}>›</div>

      <div className={styles["mobile-main"]}>
        <div className={styles["mobile-title-line"]}>
          <span className={styles["order-id"]}>#{order.id}</span>
          <span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span>
        </div>
        <div className={styles["mobile-meta"]}>{product.first}{product.extra > 0 ? ` · +${product.extra} itens` : ""}</div>
        <div className={styles["mobile-meta"]}>
          {scheduleLabel(order)} · {delivery} · {comanda ? `Comanda ${comandaNumber(order)} ${comanda.toLowerCase()}` : "Sem comanda"}
        </div>
        <div><span className={cls("tag", status.tone)}>{status.label}</span></div>
      </div>
      <div className={styles["mobile-right"]}>
        <span className={styles.money}>{money(order.valor_total_centavos)}</span>
        {payment.paid
          ? <span className={styles["payment-ok"]}><span className={styles.check}>✓</span> Pago</span>
          : <span className={styles["payment-pending"]}>Pendente</span>}
        <span className={styles.chev}>›</span>
      </div>
    </div>
  );
}

export function OrdersPage({ session, onNavigate, active }: Props) {
  const [orders, setOrders] = useState<Order[]>(() => ordersCache ?? []);
  const [loading, setLoading] = useState(() => ordersCache === null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("pedido");
  const [financial, setFinancial] = useState<FinancialOrder | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<OrderItem | null>(null);
  const [deletingItemBusy, setDeletingItemBusy] = useState(false);
  const [deleteItemError, setDeleteItemError] = useState<string | null>(null);
  const [reallocatingItem, setReallocatingItem] = useState<FinancialOrderItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<OrderStatus>("NOVO");
  const [draftPayment, setDraftPayment] = useState<ManualPaymentStatus>("PENDENTE");
  const [savingEdit, setSavingEdit] = useState(false);
  const [reopeningCommand, setReopeningCommand] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [registeringPayment, setRegisteringPayment] = useState(false);
  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null);
  const [registerPaymentMethod, setRegisterPaymentMethod] = useState<ManualComandaPaymentMethod>("DINHEIRO");
  const editingRef = useRef(false);
  const savingEditRef = useRef(false);
  const autoRefreshInFlightRef = useRef(false);

  function updateSavingEdit(value: boolean) {
    savingEditRef.current = value;
    setSavingEdit(value);
  }

  const closeDrawer = useBackLayer(
    drawerOpen,
    () => {
      if (savingEditRef.current || editingItem || deletingItem || reallocatingItem) return false;
      setDrawerOpen(false);
      setEditing(false);
      setEditingItem(null);
      return true;
    },
    "order-drawer"
  );

  const reload = useCallback(async (
    preferredOrderId?: number,
    silent = false,
    preserveSelected = false
  ) => {
    const foreground = !silent && ordersCache === null;
    if (foreground) setLoading(true);
    if (!silent) setError(null);

    try {
      const next = await listOrders();
      const previous = ordersCache;
      ordersCache = next;

      if (!sameOrders(previous, next)) {
        setOrders(next);
      }

      if (!preserveSelected) {
        setSelected(current => {
          if (preferredOrderId) {
            const preferred = next.find(order => order.id === preferredOrderId);
            if (!preferred) return current;
            return sameOrder(current, preferred) ? current : preferred;
          }

          if (!current) return null;
          const refreshed = next.find(order => order.id === current.id) || null;
          return sameOrder(current, refreshed) ? current : refreshed;
        });
      }

      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar os pedidos.");
      }
    } finally {
      if (foreground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const refresh = (silent: boolean) => {
      if (!alive || document.visibilityState !== "visible" || autoRefreshInFlightRef.current) return;
      autoRefreshInFlightRef.current = true;
      void reload(
        undefined,
        silent,
        editingRef.current || savingEditRef.current
      ).finally(() => {
        autoRefreshInFlightRef.current = false;
      });
    };

    refresh(ordersCache !== null);

    const intervalId = window.setInterval(() => refresh(true), ORDER_AUTO_REFRESH_MS);
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
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (!selected || activeTab !== "comanda") return;
    let alive = true;
    setFinancialLoading(true);
    void getFinancialOrder(selected.id)
      .then(value => {
        if (alive) setFinancial(value);
      })
      .catch(() => {
        if (alive) setFinancial(null);
      })
      .finally(() => {
        if (alive) setFinancialLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, activeTab]);

  useEffect(() => {
    if (!drawerOpen || editingItem || deletingItem || reallocatingItem) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || savingEditRef.current) return;
      closeDrawer();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, editingItem, deletingItem, reallocatingItem, closeDrawer]);

  useEffect(() => {
    if (!deletingItem) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deletingItemBusy) return;
      event.preventDefault();
      setDeletingItem(null);
      setDeleteItemError(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletingItem, deletingItemBusy]);

  const counts = useMemo(() => ({
    todos: orders.length,
    hoje: orders.filter(order => isToday(order.criado_em)).length,
    producao: orders.filter(order => String(order.status_pedido || "").toUpperCase() === "PREPARANDO").length,
    prontos: orders.filter(order => String(order.status_pedido || "").toUpperCase() === "PRONTO").length,
    entregues: orders.filter(order => String(order.status_pedido || "").toUpperCase() === "ENTREGUE").length
  }), [orders]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return orders.filter(order => {
      const status = String(order.status_pedido || "").toUpperCase();
      const filterMatches =
        filter === "todos" ||
        (filter === "hoje" && isToday(order.criado_em)) ||
        (filter === "producao" && status === "PREPARANDO") ||
        (filter === "prontos" && status === "PRONTO") ||
        (filter === "entregues" && status === "ENTREGUE");

      if (!filterMatches) return false;
      if (!term) return true;

      const product = productSummary(order);
      return [
        String(order.id),
        order.cliente_nome || "",
        product.first,
        `comanda ${order.id}`
      ].join(" ").toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [orders, filter, query]);

  const perPage = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);
  const selectedStatus = selected ? orderStatus(selected) : null;
  const selectedPayment = selected ? paymentInfo(selected) : null;
  const selectedComanda = selected ? comandaState(selected) : null;
  const selectedDelivery = selected?.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada";
  const selectedItems = selected ? orderItems(selected) : [];
  const selectedIsManual = selected?.origem_pedido === "MANUAL";
  const selectedIsDiagnostic = Boolean(selected?.pedido_teste);

  useEffect(() => {
    setPage(current => Math.min(current, pages));
  }, [pages]);

  const financialItems = financial?.itens || [];
  const comandaItems = financialItems.length ? financialItems : selectedItems;
  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));
  const selectedCommandClosed = String(selected?.status_comanda || "ABERTA").toUpperCase() === "ENCERRADA";
  const selectedCanceled = String(selected?.status_pedido || "").toUpperCase() === "CANCELADO" ||
    String(selected?.status_pagamento || "").toUpperCase() === "CANCELADO";
  const canReopenCommand = Boolean(selected && selectedCommandClosed && (paidCents > 0 || (selectedIsManual && selectedCanceled)));

  function openOrder(order: Order) {
    setSelected(order);
    setDrawerOpen(true);
    setActiveTab("pedido");
    setFinancial(null);
    setEditing(false);
    setEditingItem(null);
    setDeletingItem(null);
    setReallocatingItem(null);
    setDeleteItemError(null);
    setEditError(null);
    setRegisterPaymentError(null);
    setRegisterPaymentMethod("DINHEIRO");
  }

  function startEditing() {
    if (!selected) return;
    setDraftStatus(normalizeOrderStatus(selected));
    setDraftPayment(normalizeManualPayment(selected));
    setActiveTab("pedido");
    setEditError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditError(null);
  }

  async function saveEditing() {
    if (!selected || savingEditRef.current) return;

    const currentStatus = normalizeOrderStatus(selected);
    const currentPayment = selected.origem_pedido === "MANUAL" && !selected.pedido_teste
      ? normalizeManualPayment(selected)
      : null;
    const statusChanged = draftStatus !== currentStatus;
    const paymentChanged = currentPayment !== null && draftPayment !== currentPayment;

    if (!statusChanged && !paymentChanged) {
      setEditError(null);
      setEditing(false);
      return;
    }

    updateSavingEdit(true);
    setEditError(null);
    try {
      if (statusChanged) {
        await updateOrderStatus(selected.id, draftStatus);
      }

      if (paymentChanged) {
        await updateManualPayment(selected.id, draftPayment);
      }

      await reload(selected.id);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : "Não foi possível salvar as alterações do pedido.");
    } finally {
      updateSavingEdit(false);
    }
  }

  async function reopenSelectedCommand() {
    if (!selected || reopeningCommand) return;
    setReopeningCommand(true);
    setEditError(null);
    try {
      if (paidCents > 0) {
        await reopenPaidCommand(selected.id);
      } else {
        await updateManualPayment(selected.id, "PENDENTE");
      }
      await reload(selected.id);
      setFinancial(null);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : "Não foi possível reabrir a comanda.");
    } finally {
      setReopeningCommand(false);
    }
  }

  async function registerSelectedDiagnosticPayment() {
    if (!selected || !selectedIsDiagnostic || registeringPayment || pendingCents <= 0) return;
    setRegisteringPayment(true);
    setRegisterPaymentError(null);
    try {
      await registerComandaPayment(selected.id, {
        metodo: registerPaymentMethod,
        valor_centavos: pendingCents
      });
      await reload(selected.id);
      const refreshedFinancial = await getFinancialOrder(selected.id, true);
      setFinancial(refreshedFinancial);
    } catch (err) {
      setRegisterPaymentError(
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Não foi possível registrar o pagamento do teste."
      );
    } finally {
      setRegisteringPayment(false);
    }
  }

  async function confirmDeleteItem() {
    if (!selected || !deletingItem?.id || deletingItemBusy) return;
    setDeletingItemBusy(true);
    setDeleteItemError(null);
    try {
      await deleteOrderItem(selected.id, deletingItem.id);
      await reload(selected.id);
      const refreshedFinancial = await getFinancialOrder(selected.id, true);
      setFinancial(refreshedFinancial);
      setDeletingItem(null);
    } catch (err) {
      setDeleteItemError(err instanceof ApiClientError ? err.message : "Não foi possível excluir o item da comanda.");
    } finally {
      setDeletingItemBusy(false);
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
        hideHeader
        fullWidth
      >
        <div className={styles.pageRoot}>
          <div className={cls("workspace", drawerOpen && "drawer-open")}>
            <section className={styles.main}>
              <header className={styles["page-header"]}>
                <h1 className={styles["page-title"]}>Pedidos</h1>
                <label className={styles.search}>
                  <span className={cls("icon", "ico")}><Icon name="search"/></span>
                  <input
                    type="search"
                    placeholder="Buscar pedido, cliente ou comanda..."
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                  <span className={styles.shortcut}>⌘ K</span>
                </label>
                <button
                  className={styles["primary-btn"]}
                  type="button"
                  style={{ height: 44, padding: "0 16px", whiteSpace: "nowrap" }}
                  onClick={() => setManualOrderOpen(true)}
                >
                  + Novo pedido
                </button>
              </header>

              <div className={styles["orders-card"]} aria-busy={loading}>
                <div className={styles["mobile-filter"]}>
                  <span>Filtrar pedidos</span>
                  <AdminSelect
                    value={filter}
                    ariaLabel="Filtrar pedidos"
                    style={mobileFilterSelectStyle}
                    options={FILTER_OPTIONS.map(([key, label]) => ({
                      value: key,
                      label: `${label} · ${counts[key]}`
                    }))}
                    onChange={value => setFilter(value)}
                  />
                </div>

                <div className={styles.filters}>
                  {FILTER_OPTIONS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={cls("filter", filter === key && "active")}
                      onClick={() => setFilter(key)}
                    >
                      {label} <span className={styles.count}>{counts[key]}</span>
                    </button>
                  ))}
                </div>

                {error ? (
                  <div className={styles.error}>
                    <strong>Não foi possível carregar os pedidos</strong>
                    <span>{error}</span>
                    <button type="button" onClick={() => void reload()}>Tentar novamente</button>
                  </div>
                ) : (
                  <div className={styles.table}>
                    <div className={styles.thead}>
                      <div>Pedido</div>
                      <div>Cliente</div>
                      <div>Produtos</div>
                      <div>Comanda</div>
                      <div>Retirada / Entrega</div>
                      <div>Status</div>
                      <div>Pagamento</div>
                      <div>Total</div>
                      <div/>
                    </div>

                    {visible.map(order => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        selected={drawerOpen && selected?.id === order.id}
                        onSelect={() => openOrder(order)}
                      />
                    ))}

                    {!loading && visible.length === 0
                      ? <div className={styles.empty}>Nenhum pedido encontrado.</div>
                      : null}
                  </div>
                )}

                <footer className={styles["table-footer"]}>
                  <span>
                    {filtered.length
                      ? `Mostrando ${(page - 1) * perPage + 1}–${Math.min(page * perPage, filtered.length)} de ${filtered.length} pedidos`
                      : "Mostrando 0 pedidos"}
                  </span>
                  <div className={styles.pagination}>
                    <button
                      className={styles["page-btn"]}
                      type="button"
                      onClick={() => setPage(value => Math.max(1, value - 1))}
                    >
                      ‹
                    </button>
                    {Array.from({ length: pages }, (_, index) => index + 1).slice(0, 5).map(value => (
                      <button
                        key={value}
                        className={cls("page-btn", page === value && "active")}
                        type="button"
                        onClick={() => setPage(value)}
                      >
                        {value}
                      </button>
                    ))}
                    <button
                      className={cls("page-btn")}
                      type="button"
                      onClick={() => setPage(value => Math.min(pages, value + 1))}
                    >
                      ›
                    </button>
                  </div>
                </footer>
              </div>
            </section>

            <aside className={cls("drawer", drawerOpen && "open")} id="drawer">
              {selected ? (
                <>
                  <div className={styles["drawer-head"]}>
                    <div>
                      <h2>Pedido #{selected.id}</h2>
                      <div className={styles["drawer-client"]}>{selected.cliente_nome || "Cliente não informado"}</div>
                      <div className={styles["drawer-tags"]}>
                        {selectedComanda ? <span className={cls("tag", "purple")}>Comanda {comandaNumber(selected)}</span> : null}
                        {selectedStatus ? <span className={cls("tag", selectedStatus.tone)}>{selectedStatus.label}</span> : null}
                      </div>
                    </div>
                    <button
                      className={styles.close}
                      type="button"
                      aria-label="Fechar"
                      onClick={closeDrawer}
                      disabled={savingEdit || Boolean(editingItem) || Boolean(deletingItem) || Boolean(reallocatingItem)}
                    >
                      ×
                    </button>
                  </div>

                  <div className={styles["drawer-meta"]}>
                    <span>
                      <Icon name={selectedDelivery === "Entrega" ? "truck" : "bag"} className={styles["row-ico"]}/>
                      {scheduleLabel(selected)}
                    </span>
                    <span className={styles.bullet}/>
                    <span>{selectedDelivery}</span>
                  </div>

                  <div className={styles.tabs}>
                    <button
                      className={cls("tab", activeTab === "pedido" && "active")}
                      type="button"
                      onClick={() => setActiveTab("pedido")}
                    >
                      Pedido
                    </button>
                    <button
                      className={cls("tab", activeTab === "comanda" && "active")}
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditingItem(null);
                        setActiveTab("comanda");
                      }}
                    >
                      Comanda
                    </button>
                  </div>

                  <div className={cls("pedido-panel", activeTab !== "pedido" && "hidden")}>
                    <section className={styles["drawer-section"]}>
                      <h3 className={styles["section-title"]}>Itens do pedido</h3>
                      {selectedItems.map((item, index) => {
                        const canEditItem = Boolean(item.id) &&
                          String(selected.status_comanda || "ABERTA").toUpperCase() === "ABERTA" &&
                          String(selected.status_pedido || "").toUpperCase() !== "CANCELADO";
                        return (
                          <div className={styles["line-item"]} key={`${item.id || item.produto_id || "item"}-${index}`}>
                            <span style={{ display: "grid", gap: 7 }}>
                              <span>{item.produto_nome || "Produto"}</span>
                              {canEditItem ? (
                                <button
                                  className={styles["secondary-btn"]}
                                  type="button"
                                  style={{ width: "fit-content", height: 28, padding: "0 10px", color: "var(--pink-strong)" }}
                                  onClick={() => setEditingItem(item)}
                                >
                                  Trocar
                                </button>
                              ) : null}
                            </span>
                            <span className={styles.qty}>{item.quantidade}x</span>
                            <span className={styles.price}>{money(item.valor_total_centavos)}</span>
                          </div>
                        );
                      })}
                      <div className={styles["total-row"]}>
                        <span>Total do pedido</span>
                        <span>{money(selected.valor_total_centavos)}</span>
                      </div>
                    </section>

                    {editing ? (
                      <>
                        <section className={styles["drawer-section"]}>
                          <h3 className={styles["section-title"]}>Status do pedido</h3>
                          <AdminSelect
                            value={draftStatus}
                            ariaLabel="Status do pedido"
                            style={editSelectStyle}
                            disabled={savingEdit}
                            options={ORDER_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
                            onChange={value => setDraftStatus(value)}
                          />
                        </section>

                        <section className={styles["drawer-section"]}>
                          <h3 className={styles["section-title"]}>Pagamento</h3>
                          {selectedIsDiagnostic ? (
                            <div className={styles.note}>
                              Pedido de teste: registre o pagamento pela aba Comanda para escolher a forma de pagamento.
                            </div>
                          ) : selectedIsManual ? (
                            <AdminSelect
                              value={draftPayment}
                              ariaLabel="Status do pagamento"
                              style={editSelectStyle}
                              disabled={savingEdit}
                              options={PAYMENT_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
                              onChange={value => setDraftPayment(value)}
                            />
                          ) : (
                            <div className={styles.note}>O pagamento deste pedido é controlado pela comanda financeira.</div>
                          )}
                        </section>

                        <section className={cls("drawer-section", "last-drawer-section")}>
                          <h3 className={styles["section-title"]}>Observações</h3>
                          <div className={styles.note}>{selected.observacao || "—"}</div>
                        </section>
                      </>
                    ) : (
                      <>
                        <section className={styles["drawer-section"]}>
                          <h3 className={styles["section-title"]}>Pagamento</h3>
                          <div className={styles["payment-row"]}>
                            <div className={styles["payment-left"]}>
                              {selectedPayment?.paid
                                ? <span className={cls("tag", "green")}>✓ &nbsp; Pago</span>
                                : <span className={cls("tag", "orange")}>Pendente</span>}
                              <span className={styles.method}>Método</span>
                            </div>
                            <div className={cls("payment-left", "payment-left-end")}>
                              <span>&nbsp;</span>
                              <span className={styles.method}>{selectedPayment?.paid ? paymentMethod(selected) : "—"}</span>
                            </div>
                          </div>
                        </section>

                        <section className={cls("drawer-section", "last-drawer-section")}>
                          <h3 className={styles["section-title"]}>Observações</h3>
                          <div className={styles.note}>{selected.observacao || "—"}</div>
                        </section>
                      </>
                    )}
                  </div>

                  <div className={cls("comanda-panel", activeTab === "comanda" && "active")}>
                    <section className={styles["drawer-section"]}>
                      <h3 className={styles["section-title"]}>
                        Comanda {comandaNumber(selected)} · {selectedComanda || "Aberta"}
                      </h3>
                      {financialLoading ? (
                        <div className={styles.note}>Carregando comanda...</div>
                      ) : (
                        comandaItems.map((item, index) => {
                          const financialItem = financialItems.find(candidate => candidate.id === item.id);
                          const itemWithFinance = item as OrderItem & {
                            status_financeiro?: string;
                            valor_pago_centavos?: number;
                            saldo_centavos?: number;
                            adicionado_por_usuario_id?: number | null;
                          };
                          const status = String(
                            itemWithFinance.status_financeiro || (selectedPayment?.paid ? "PAGO" : "PENDENTE")
                          ).toLowerCase();
                          const source = itemWithFinance.adicionado_por_usuario_id
                            ? "Adicionado depois"
                            : `Pedido #${selected.id}`;
                          const comandaEditable =
                            String(selected.status_comanda || "ABERTA").toUpperCase() === "ABERTA" &&
                            String(selected.status_pedido || "").toUpperCase() !== "CANCELADO";
                          const reallocationCandidates = financialItem
                            ? financialItems.filter(candidate => candidate.id !== financialItem.id && Number(candidate.saldo_centavos || 0) > 0)
                            : [];
                          const canReallocateItem = Boolean(financialItem) &&
                            Number(financialItem?.valor_pago_centavos || 0) > 0 &&
                            reallocationCandidates.length > 0 &&
                            comandaEditable;
                          const canDeleteItem = Boolean(financial) &&
                            Boolean(item.id) &&
                            comandaItems.length > 1 &&
                            Number(itemWithFinance.valor_pago_centavos || 0) <= 0 &&
                            !item.estoque_baixado_em &&
                            comandaEditable;

                          return (
                            <div
                              className={styles["comanda-item"]}
                              key={`${item.id || item.produto_id || "item"}-${index}`}
                            >
                              <div>
                                <strong>{item.produto_nome || "Produto"}</strong>
                                <div className={styles["comanda-status"]}>{source} · {status}</div>
                              </div>
                              <div style={{ display: "grid", justifyItems: "end", gap: 7 }}>
                                <div>{money(item.valor_total_centavos)}</div>
                                {canReallocateItem && financialItem ? (
                                  <button
                                    className={styles["secondary-btn"]}
                                    type="button"
                                    style={{ height: 27, padding: "0 9px", color: "var(--pink-strong)" }}
                                    onClick={() => setReallocatingItem(financialItem)}
                                  >
                                    Corrigir item
                                  </button>
                                ) : canDeleteItem ? (
                                  <button
                                    className={styles["secondary-btn"]}
                                    type="button"
                                    style={{ height: 27, padding: "0 9px", color: "var(--danger)" }}
                                    onClick={() => {
                                      setDeleteItemError(null);
                                      setDeletingItem(item);
                                    }}
                                  >
                                    Excluir
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div className={styles["comanda-summary"]}>
                        <div className={cls("summary-row", "total")}>
                          <span>Total da comanda</span>
                          <span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span>
                        </div>
                        <div className={cls("summary-row", "paid")}>
                          <span>Pago</span>
                          <span>{money(paidCents)}</span>
                        </div>
                        <div className={cls("summary-row", "pending")}>
                          <span>Pendente</span>
                          <span>{money(pendingCents)}</span>
                        </div>
                      </div>

                      {selectedIsDiagnostic && !selectedCommandClosed && pendingCents > 0 ? (
                        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                          <div className={styles.note}>
                            <strong style={{ display: "block", marginBottom: 6, color: "var(--text)" }}>Registrar pagamento do teste</strong>
                            Escolha a forma de pagamento. Nada é cobrado de verdade neste fluxo manual.
                          </div>
                          <AdminSelect
                            value={registerPaymentMethod}
                            ariaLabel="Forma de pagamento do pedido de teste"
                            style={editSelectStyle}
                            disabled={registeringPayment}
                            options={MANUAL_PAYMENT_METHOD_OPTIONS.map(([value, label]) => ({ value, label }))}
                            onChange={value => setRegisterPaymentMethod(value)}
                          />
                          {registerPaymentError ? (
                            <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>
                              {registerPaymentError}
                            </div>
                          ) : null}
                          <button
                            className={styles["primary-btn"]}
                            type="button"
                            disabled={registeringPayment}
                            onClick={() => void registerSelectedDiagnosticPayment()}
                          >
                            {registeringPayment ? "Registrando..." : `Registrar ${money(pendingCents)} como pago`}
                          </button>
                        </div>
                      ) : null}
                    </section>
                  </div>

                  {activeTab === "pedido" && editing ? (
                    <div className={styles["drawer-actions"]}>
                      {editError ? (
                        <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>
                          {editError}
                        </div>
                      ) : null}
                      <button
                        className={styles["primary-btn"]}
                        type="button"
                        disabled={savingEdit}
                        onClick={() => void saveEditing()}
                      >
                        {savingEdit ? "Salvando..." : "Salvar alterações"}
                      </button>
                      <button
                        className={styles["secondary-btn"]}
                        type="button"
                        disabled={savingEdit}
                        onClick={cancelEditing}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className={styles["drawer-actions"]}>
                      {editError ? (
                        <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>
                          {editError}
                        </div>
                      ) : null}
                      <div className={styles["secondary-actions"]} style={{ gridTemplateColumns: "1fr" }}>
                        {canReopenCommand ? (
                          <button
                            className={styles["primary-btn"]}
                            type="button"
                            disabled={reopeningCommand}
                            onClick={() => void reopenSelectedCommand()}
                          >
                            {reopeningCommand ? "Reabrindo..." : "Reabrir comanda"}
                          </button>
                        ) : (
                          <button
                            className={styles["secondary-btn"]}
                            type="button"
                            onClick={startEditing}
                          >
                            <Icon name="edit" className={styles["btn-ico"]}/>Editar pedido
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </aside>
          </div>
        </div>
      </AdminShell>

      {manualOrderOpen ? (
        <ManualOrderDialog
          onClose={() => setManualOrderOpen(false)}
          onCreated={async () => {
            setQuery("");
            setFilter("todos");
            setPage(1);
            await reload();
            setDrawerOpen(false);
            setActiveTab("pedido");
            setEditing(false);
            setEditingItem(null);
          }}
        />
      ) : null}

      {selected && editingItem ? (
        <EditOrderItemDialog
          order={selected}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={async () => {
            await reload(selected.id);
            setFinancial(null);
          }}
        />
      ) : null}

      {selected && financial && reallocatingItem ? (
        <ReallocateOrderItemDialog
          orderId={selected.id}
          item={reallocatingItem}
          candidates={financial.itens.filter(candidate =>
            candidate.id !== reallocatingItem.id && Number(candidate.saldo_centavos || 0) > 0
          )}
          onClose={() => setReallocatingItem(null)}
          onSaved={async () => {
            await reload(selected.id);
            const refreshedFinancial = await getFinancialOrder(selected.id, true);
            setFinancial(refreshedFinancial);
            setReallocatingItem(null);
          }}
        />
      ) : null}

      {selected && deletingItem ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            display: "grid",
            placeItems: "center",
            padding: 20,
            fontFamily: '"Manrope", system-ui, sans-serif'
          }}
        >
          <button
            type="button"
            aria-label="Fechar confirmação"
            disabled={deletingItemBusy}
            onClick={() => {
              setDeletingItem(null);
              setDeleteItemError(null);
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              padding: 0,
              background: "rgba(30,20,16,.42)",
              backdropFilter: "blur(5px)",
              cursor: deletingItemBusy ? "wait" : "pointer"
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-item-title"
            style={{
              position: "relative",
              zIndex: 1,
              width: "min(410px, 100%)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              padding: 22,
              background: "var(--surface)",
              color: "var(--text)",
              boxShadow: "0 24px 70px rgba(63,43,34,.20)"
            }}
          >
            <div style={{ color: "var(--danger)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" }}>
              Remover da comanda
            </div>
            <h2 id="delete-item-title" style={{ margin: "7px 0 0", fontSize: 19, letterSpacing: "-.3px" }}>
              Excluir {deletingItem.produto_nome || "este produto"}?
            </h2>
            <p style={{ margin: "9px 0 0", color: "var(--muted)", fontSize: 11.5, lineHeight: 1.55 }}>
              {deletingItem.quantidade}x deste item será removido da comanda. A reserva de estoque correspondente será liberada e os totais serão recalculados.
            </p>
            {deleteItemError ? (
              <div role="alert" style={{ marginTop: 14, color: "var(--danger)", fontSize: 11, fontWeight: 700 }}>
                {deleteItemError}
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
              <button
                className={styles["secondary-btn"]}
                type="button"
                disabled={deletingItemBusy}
                onClick={() => {
                  setDeletingItem(null);
                  setDeleteItemError(null);
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={deletingItemBusy}
                onClick={() => void confirmDeleteItem()}
                style={{
                  height: 42,
                  border: "1px solid var(--danger)",
                  borderRadius: 9,
                  background: "var(--danger)",
                  color: "#fff",
                  font: "inherit",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: deletingItemBusy ? "wait" : "pointer",
                  opacity: deletingItemBusy ? .65 : 1
                }}
              >
                {deletingItemBusy ? "Excluindo..." : "Excluir item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
