import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { AuthSession } from "../auth/AuthGate";
import type { AdminV2Page } from "../layout/AdminShell";
import { ApiClientError } from "../shared/apiClient";
import {
  listOrders,
  updateManualPayment,
  updateOrderStatus,
  type ManualPaymentStatus,
  type OrderStatus
} from "./order.api";
import { getFinancialOrder, type FinancialOrder } from "./order.finance";
import { itemsOf } from "./order.model";
import type { Order } from "./order.schema";
import { ManualOrderDialog } from "./ManualOrderDialog";
import styles from "./OrdersPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

type FilterKey = "todos" | "hoje" | "producao" | "prontos" | "entregues";
type DrawerTab = "pedido" | "comanda";
type IconName =
  | "home"
  | "orders"
  | "products"
  | "clients"
  | "payments"
  | "settings"
  | "search"
  | "bag"
  | "truck"
  | "receipt"
  | "edit";

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

const editSelectStyle: CSSProperties = {
  width: "100%",
  height: 40,
  border: "1px solid var(--line-strong)",
  borderRadius: 9,
  padding: "0 12px",
  background: "var(--surface)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 12,
  outline: "none"
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></>,
    orders: <><rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V4h6v2"/><path d="M9 11h6"/><path d="M9 15h4"/></>,
    products: <><path d="M4 8h16"/><path d="M6 8V5h12v3"/><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8v11"/></>,
    clients: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.5 2.3-5.3 5.5-5.3S14 15.5 14.5 19"/><path d="M16 6.5a3 3 0 0 1 0 5.8"/><path d="M17.5 14.2c2 .8 3 2.3 3 4.8"/></>,
    payments: <><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 10h16"/><path d="M15 14h3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7l2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
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

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "RP";
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

function orderItems(order: Order) {
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
      <div className={styles.stack}><span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span></div>
      <div className={styles.stack}>
        <span>{product.first}</span>
        {product.extra > 0 ? <span className={styles.secondary}>+ {product.extra} itens</span> : null}
      </div>
      <div className={styles.stack}>
        {comanda ? (
          <>
            <span>Comanda {comandaNumber(order)}</span>
            <span className={cls("dotline", comanda === "Aberta" ? "open" : "closed")}><span className={styles.dot}/>{comanda}</span>
          </>
        ) : (
          <><span className={styles.secondary} style={{ margin: 0 }}>Sem comanda</span><span className={styles.secondary}>—</span></>
        )}
      </div>
      <div className={styles.stack}>
        <span><Icon name={delivery === "Entrega" ? "truck" : "bag"} className={styles["row-ico"]}/>{scheduleLabel(order)}</span>
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
        <div className={styles["mobile-title-line"]}><span className={styles["order-id"]}>#{order.id}</span><span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span></div>
        <div className={styles["mobile-meta"]}>{product.first}{product.extra > 0 ? ` · +${product.extra} itens` : ""}</div>
        <div className={styles["mobile-meta"]}>{scheduleLabel(order)} · {delivery} · {comanda ? `Comanda ${comandaNumber(order)} ${comanda.toLowerCase()}` : "Sem comanda"}</div>
        <div><span className={cls("tag", status.tone)}>{status.label}</span></div>
      </div>
      <div className={styles["mobile-right"]}>
        <span className={styles.money}>{money(order.valor_total_centavos)}</span>
        {payment.paid ? <span className={styles["payment-ok"]}><span className={styles.check}>✓</span> Pago</span> : <span className={styles["payment-pending"]}>Pendente</span>}
        <span className={styles.chev}>›</span>
      </div>
    </div>
  );
}

export function OrdersPage({ session, onNavigate }: Props) {
  const { user } = session;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todos");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<DrawerTab>("pedido");
  const [financial, setFinancial] = useState<FinancialOrder | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<OrderStatus>("NOVO");
  const [draftPayment, setDraftPayment] = useState<ManualPaymentStatus>("PENDENTE");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = useCallback(async (preferredOrderId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const next = await listOrders();
      setOrders(next);
      setSelected(current => {
        if (preferredOrderId) return next.find(order => order.id === preferredOrderId) || next[0] || null;
        return current ? next.find(order => order.id === current.id) || next[0] || null : next[0] || null;
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar os pedidos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPage(1); }, [filter, query]);

  useEffect(() => {
    if (!selected || activeTab !== "comanda") return;
    let alive = true;
    setFinancialLoading(true);
    void getFinancialOrder(selected.id)
      .then(value => { if (alive) setFinancial(value); })
      .catch(() => { if (alive) setFinancial(null); })
      .finally(() => { if (alive) setFinancialLoading(false); });
    return () => { alive = false; };
  }, [selected, activeTab]);

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

  const financialItems = financial?.itens || [];
  const comandaItems = financialItems.length ? financialItems : selectedItems;
  const paidCents = financial?.valor_pago_centavos ?? (selectedPayment?.paid ? Number(selected?.valor_total_centavos || 0) : 0);
  const pendingCents = financial?.saldo_centavos ?? (selectedPayment?.paid ? 0 : Number(selected?.valor_total_centavos || 0));

  function openOrder(order: Order) {
    setSelected(order);
    setDrawerOpen(true);
    setActiveTab("pedido");
    setFinancial(null);
    setEditing(false);
    setEditError(null);
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
    if (!selected || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const currentStatus = normalizeOrderStatus(selected);
      if (draftStatus !== currentStatus) {
        await updateOrderStatus(selected.id, draftStatus);
      }

      if (selected.origem_pedido === "MANUAL") {
        const currentPayment = normalizeManualPayment(selected);
        if (draftPayment !== currentPayment) {
          await updateManualPayment(selected.id, draftPayment);
        }
      }

      await reload(selected.id);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : "Não foi possível salvar as alterações do pedido.");
    } finally {
      setSavingEdit(false);
    }
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, pageName?: AdminV2Page) {
    event.preventDefault();
    if (pageName) onNavigate(pageName);
  }

  return (
    <div className={styles.pageRoot}>
      <div className={styles.app}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <div className={styles["brand-rp"]}>R&amp;P</div>
            <div className={styles["brand-doces"]}>DOCES</div>
          </div>

          <nav className={styles.nav}>
            <a className={styles["nav-item"]} href="#dashboard" onClick={event => navigate(event, "dashboard")}>
              <span className={styles.ico}><Icon name="home"/></span><span>Início</span>
            </a>
            <a className={cls("nav-item", "active")} href="#pedidos" onClick={event => event.preventDefault()}>
              <span className={styles.ico}><Icon name="orders"/></span><span>Pedidos</span>
            </a>
            <a className={styles["nav-item"]} href="#produtos" onClick={event => navigate(event, "produtos")}>
              <span className={styles.ico}><Icon name="products"/></span><span>Produtos</span>
            </a>
            <a className={styles["nav-item"]} href="#" onClick={event => event.preventDefault()}>
              <span className={styles.ico}><Icon name="clients"/></span><span>Clientes</span>
            </a>
            <a className={styles["nav-item"]} href="#" onClick={event => event.preventDefault()}>
              <span className={styles.ico}><Icon name="payments"/></span><span>Pagamentos</span>
            </a>

            <div className={styles["nav-divider"]}/>

            <a className={styles["nav-item"]} href="#" onClick={event => event.preventDefault()}>
              <span className={styles.ico}><Icon name="settings"/></span><span>Configurações</span>
            </a>
          </nav>

          <div className={styles["nav-spacer"]}/>

          <div className={styles.profile}>
            <div className={styles.avatar}>{initials(user.nome)}</div>
            <div className={styles["profile-text"]}>
              <div className={styles["profile-name"]}>{user.nome}</div>
              <div className={styles["profile-role"]}>Administrador</div>
            </div>
            <div className={styles["profile-caret"]}>⌄</div>
          </div>
        </aside>

        <main className={styles.content}>
          <div className={styles.workspace}>
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
                <div className={styles.filters}>
                  {([
                    ["todos", "Todos"],
                    ["hoje", "Hoje"],
                    ["producao", "Em produção"],
                    ["prontos", "Prontos"],
                    ["entregues", "Entregues"]
                  ] as Array<[FilterKey, string]>).map(([key, label]) => (
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
                        selected={selected?.id === order.id}
                        onSelect={() => openOrder(order)}
                      />
                    ))}

                    {!loading && visible.length === 0 ? <div className={styles.empty}>Nenhum pedido encontrado.</div> : null}
                  </div>
                )}

                <footer className={styles["table-footer"]}>
                  <span>
                    {filtered.length
                      ? `Mostrando ${(page - 1) * perPage + 1}–${Math.min(page * perPage, filtered.length)} de ${filtered.length} pedidos`
                      : "Mostrando 0 pedidos"}
                  </span>
                  <div className={styles.pagination}>
                    <button className={styles["page-btn"]} type="button" onClick={() => setPage(value => Math.max(1, value - 1))}>‹</button>
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
                    <button className={styles["page-btn"]} type="button" onClick={() => setPage(value => Math.min(pages, value + 1))}>›</button>
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
                    <button className={styles.close} type="button" aria-label="Fechar" onClick={() => { setDrawerOpen(false); setEditing(false); }}>×</button>
                  </div>

                  <div className={styles["drawer-meta"]}>
                    <span><Icon name={selectedDelivery === "Entrega" ? "truck" : "bag"} className={styles["row-ico"]}/>{scheduleLabel(selected)}</span>
                    <span className={styles.bullet}/>
                    <span>{selectedDelivery}</span>
                  </div>

                  <div className={styles.tabs}>
                    <button className={cls("tab", activeTab === "pedido" && "active")} type="button" onClick={() => setActiveTab("pedido")}>Pedido</button>
                    <button className={cls("tab", activeTab === "comanda" && "active")} type="button" onClick={() => { setEditing(false); setActiveTab("comanda"); }}>Comanda</button>
                  </div>

                  <div className={cls("pedido-panel", activeTab !== "pedido" && "hidden")}>
                    <section className={styles["drawer-section"]}>
                      <h3 className={styles["section-title"]}>Itens do pedido</h3>
                      {selectedItems.map((item, index) => (
                        <div className={styles["line-item"]} key={`${item.produto_id || "item"}-${index}`}>
                          <span>{item.produto_nome || "Produto"}</span>
                          <span className={styles.qty}>{item.quantidade}x</span>
                          <span className={styles.price}>{money(item.valor_total_centavos)}</span>
                        </div>
                      ))}
                      <div className={styles["total-row"]}><span>Total do pedido</span><span>{money(selected.valor_total_centavos)}</span></div>
                    </section>

                    {editing ? (
                      <>
                        <section className={styles["drawer-section"]}>
                          <h3 className={styles["section-title"]}>Status do pedido</h3>
                          <select value={draftStatus} onChange={event => setDraftStatus(event.target.value as OrderStatus)} style={editSelectStyle} disabled={savingEdit}>
                            {ORDER_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </section>

                        <section className={styles["drawer-section"]}>
                          <h3 className={styles["section-title"]}>Pagamento</h3>
                          {selectedIsManual ? (
                            <select value={draftPayment} onChange={event => setDraftPayment(event.target.value as ManualPaymentStatus)} style={editSelectStyle} disabled={savingEdit}>
                              {PAYMENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
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
                              {selectedPayment?.paid ? <span className={cls("tag", "green")}>✓ &nbsp; Pago</span> : <span className={cls("tag", "orange")}>Pendente</span>}
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
                      <h3 className={styles["section-title"]}>Comanda {comandaNumber(selected)} · {selectedComanda || "Aberta"}</h3>
                      {financialLoading ? <div className={styles.note}>Carregando comanda...</div> : comandaItems.map((item, index) => {
                        const itemWithFinance = item as { status_financeiro?: string; adicionado_por_usuario_id?: number | null };
                        const status = String(itemWithFinance.status_financeiro || (selectedPayment?.paid ? "PAGO" : "PENDENTE")).toLowerCase();
                        const source = itemWithFinance.adicionado_por_usuario_id ? "Adicionado depois" : `Pedido #${selected.id}`;
                        return (
                          <div className={styles["comanda-item"]} key={`${item.produto_id || "item"}-${index}`}>
                            <div><strong>{item.produto_nome || "Produto"}</strong><div className={styles["comanda-status"]}>{source} · {status}</div></div>
                            <div>{money(item.valor_total_centavos)}</div>
                          </div>
                        );
                      })}
                      <div className={styles["comanda-summary"]}>
                        <div className={cls("summary-row", "total")}><span>Total da comanda</span><span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span></div>
                        <div className={cls("summary-row", "paid")}><span>Pago</span><span>{money(paidCents)}</span></div>
                        <div className={cls("summary-row", "pending")}><span>Pendente</span><span>{money(pendingCents)}</span></div>
                      </div>
                    </section>
                  </div>

                  {activeTab === "pedido" && editing ? (
                    <div className={styles["drawer-actions"]}>
                      {editError ? <div className={styles.note} role="alert" style={{ color: "var(--pink-strong)" }}>{editError}</div> : null}
                      <button className={styles["primary-btn"]} type="button" disabled={savingEdit} onClick={() => void saveEditing()}>
                        {savingEdit ? "Salvando..." : "Salvar alterações"}
                      </button>
                      <button className={styles["secondary-btn"]} type="button" disabled={savingEdit} onClick={cancelEditing}>Cancelar</button>
                    </div>
                  ) : (
                    <div className={styles["drawer-actions"]}>
                      <button className={styles["primary-btn"]} type="button" onClick={() => setActiveTab("comanda")}>
                        <Icon name="receipt" className={styles["btn-ico"]}/>Ver comanda
                      </button>
                      <div className={styles["secondary-actions"]}>
                        <button className={styles["secondary-btn"]} type="button" onClick={startEditing}><Icon name="edit" className={styles["btn-ico"]}/>Editar pedido</button>
                        <button className={styles["more-btn"]} type="button" aria-label="Mais ações">⋮</button>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </aside>
          </div>
        </main>
      </div>

      {manualOrderOpen ? (
        <ManualOrderDialog
          onClose={() => setManualOrderOpen(false)}
          onCreated={async id => {
            setQuery("");
            setFilter("todos");
            setPage(1);
            await reload(id);
            setDrawerOpen(true);
            setActiveTab("pedido");
            setEditing(false);
            setManualOrderOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
