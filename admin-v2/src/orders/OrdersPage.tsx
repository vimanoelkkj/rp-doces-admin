import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthSession } from "../auth/AuthGate";
import type { AdminV2Page } from "../layout/AdminShell";
import { ApiClientError } from "../shared/apiClient";
import { listOrders, updateOrderStatus, type OrderStatus } from "./order.api";
import { getFinancialOrder, type FinancialOrder } from "./order.finance";
import { itemsOf } from "./order.model";
import type { Order } from "./order.schema";
import { ManualOrderDialog } from "./ManualOrderDialog";
import styles from "./OrdersPage.module.css";

type Props = { session: AuthSession; onNavigate: (page: AdminV2Page) => void };
type FilterKey = "todos" | "hoje" | "producao" | "prontos" | "entregues";
type IconName = "dashboard" | "products" | "orders" | "users" | "store" | "bell" | "sun" | "moon" | "search" | "bag" | "truck" | "receipt" | "edit";

function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></>,
    orders: <><rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V4h6v2M9 11h6M9 15h4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M4 20c0-3 2.2-5 5-5s5 2 5 5M17 7v6M14 10h6"/></>,
    store: <><path d="M4 9h16l-2-5H6L4 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    bell: <><path d="M6 17h12l-1.4-2V10a4.6 4.6 0 0 0-9.2 0v5L6 17Z"/><path d="M10 20h4"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    bag: <><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    truck: <><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    edit: <><path d="M4 20h4L18 10l-4-4L4 16v4Z"/><path d="M13 7l4 4"/></>
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
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
  const d = parseDate(value);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function scheduleLabel(order: Order) {
  const d = parseDate(order.criado_em);
  if (!d) return "—";
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(d);
  if (isToday(order.criado_em)) return `Hoje, ${time}`;
  const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
  return `${date}, ${time}`;
}

function orderStatus(order: Order): { label: string; tone: "gray" | "orange" | "green" | "purple" | "pink" } {
  switch (String(order.status_pedido || "NOVO").toUpperCase()) {
    case "PREPARANDO": return { label: "Em produção", tone: "orange" };
    case "PRONTO": return { label: "Pronto", tone: "green" };
    case "ENTREGUE": return { label: "Entregue", tone: "purple" };
    case "CANCELADO": return { label: "Cancelado", tone: "pink" };
    default: return { label: "Confirmado", tone: "gray" };
  }
}

function paymentStatus(order: Order) {
  const status = String(order.status_pagamento || "PENDENTE").toUpperCase();
  if (status === "PAGO") return { label: "Pago", className: styles.paymentOk };
  if (status === "PARCIAL") return { label: "Parcial", className: styles.paymentPartial };
  if (status === "REEMBOLSADO") return { label: "Estornado", className: styles.paymentRefunded };
  return { label: "Pendente", className: styles.paymentPending };
}

function paymentMethod(order: Order) {
  const method = String(order.metodo_pagamento || "").toUpperCase();
  if (method.includes("PIX")) return "Pix";
  if (method.includes("CART")) return "Cartão";
  if (method.includes("DINHEIRO")) return "Dinheiro";
  return method ? order.metodo_pagamento : "—";
}

function itemSummary(order: Order) {
  const items = itemsOf(order);
  const first = items[0]?.produto_nome || order.produto_nome || "Pedido sem itens";
  return items.length > 1 ? `${first} · +${items.length - 1} itens` : first;
}

function comandaState(order: Order) {
  if (!order.status_comanda) return null;
  return String(order.status_comanda).toUpperCase() === "ENCERRADA" ? "Fechada" : "Aberta";
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
  const [activeTab, setActiveTab] = useState<"pedido" | "comanda">("pedido");
  const [financial, setFinancial] = useState<FinancialOrder | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches));
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState<OrderStatus>("NOVO");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setOrders(await listOrders()); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : "Não foi possível carregar os pedidos."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { setPage(1); }, [filter, query]);
  useEffect(() => {
    if (!selected || activeTab !== "comanda") return;
    let alive = true;
    setFinancialLoading(true);
    void getFinancialOrder(selected.id).then(value => { if (alive) setFinancial(value); }).catch(() => { if (alive) setFinancial(null); }).finally(() => { if (alive) setFinancialLoading(false); });
    return () => { alive = false; };
  }, [selected, activeTab]);

  const counts = useMemo(() => ({
    todos: orders.length,
    hoje: orders.filter(order => isToday(order.criado_em)).length,
    producao: orders.filter(order => String(order.status_pedido).toUpperCase() === "PREPARANDO").length,
    prontos: orders.filter(order => String(order.status_pedido).toUpperCase() === "PRONTO").length,
    entregues: orders.filter(order => String(order.status_pedido).toUpperCase() === "ENTREGUE").length
  }), [orders]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return orders.filter(order => {
      const status = String(order.status_pedido || "").toUpperCase();
      const filterOk = filter === "todos" ||
        (filter === "hoje" && isToday(order.criado_em)) ||
        (filter === "producao" && status === "PREPARANDO") ||
        (filter === "prontos" && status === "PRONTO") ||
        (filter === "entregues" && status === "ENTREGUE");
      if (!filterOk) return false;
      if (!term) return true;
      return [`${order.id}`, order.cliente_nome || "", itemSummary(order), `comanda ${order.id}`].join(" ").toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [orders, filter, query]);

  const perPage = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);

  function openOrder(order: Order) {
    setSelected(order); setActiveTab("pedido"); setFinancial(null); setEditing(false);
    setEditStatus(String(order.status_pedido || "NOVO").toUpperCase() as OrderStatus);
  }

  async function saveEdit() {
    if (!selected || saving) return;
    const current = String(selected.status_pedido || "NOVO").toUpperCase();
    if (editStatus === current) { setEditing(false); return; }
    setSaving(true);
    try {
      await updateOrderStatus(selected.id, editStatus);
      const refreshed = await listOrders();
      setOrders(refreshed);
      const updated = refreshed.find(order => order.id === selected.id) || null;
      setSelected(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Não foi possível atualizar o pedido.");
    } finally { setSaving(false); }
  }

  const navItems: Array<{ key: AdminV2Page; label: string; icon: IconName }> = [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "produtos", label: "Produtos", icon: "products" },
    { key: "pedidos", label: "Pedidos", icon: "orders" },
    { key: "admins", label: "Administradores", icon: "users" },
    { key: "loja", label: "Loja", icon: "store" }
  ];

  return (
    <div className={styles.pageRoot}>
      <div className={styles.app}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}><div className={styles.brandRp}>R&amp;P</div><div className={styles.brandDoces}>DOCES</div></div>
          <nav className={styles.nav} aria-label="Navegação principal">
            {navItems.map(item => (
              <button key={item.key} type="button" className={`${styles.navItem} ${item.key === "pedidos" ? styles.navActive : ""}`} onClick={() => item.key !== "pedidos" && onNavigate(item.key)}>
                <span className={styles.ico}><Icon name={item.icon}/></span><span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className={styles.navSpacer}/>
          <div className={styles.notifWrap}>
            <button className={styles.notifToggle} type="button" aria-label="Notificações" onClick={() => setNotifOpen(value => !value)}>
              <span className={styles.ico}><Icon name="bell"/></span><span>Notificações</span><span className={styles.notifDot}/>
            </button>
            {notifOpen ? <div className={styles.notifPopover}><h3>Notificações</h3><p>Receba um aviso quando um novo pedido for pago.</p><div className={styles.notifStatus}><strong>Ativas neste navegador</strong><span>Você receberá avisos de novos pedidos pagos.</span></div><button className={styles.secondaryBtn} type="button">Desativar notificações</button></div> : null}
          </div>
          <button className={`${styles.themeToggle} ${dark ? styles.isDark : ""}`} type="button" aria-label="Alternar tema claro/escuro" onClick={() => setDark(value => !value)}>
            <span className={styles.ico}><Icon name={dark ? "moon" : "sun"}/></span><span>Tema</span>
          </button>
          <div className={styles.profile}>
            {user.avatar_url ? <img className={styles.avatarImage} src={user.avatar_url} alt=""/> : <div className={styles.avatar}>{initials(user.nome)}</div>}
            <div className={styles.profileText}><div className={styles.profileName}>{user.nome}</div><div className={styles.profileRole}>{user.papel}</div></div><div className={styles.profileCaret}>⌄</div>
          </div>
        </aside>

        <main className={styles.content}>
          <div className={styles.workspace}>
            <section className={styles.main} aria-busy={loading}>
              <header className={styles.pageHeader}>
                <h1 className={styles.pageTitle}>Pedidos</h1>
                <div className={styles.pageHeaderActions}>
                  <label className={styles.search}><span className={styles.searchIcon}><Icon name="search"/></span><input type="search" placeholder="Buscar pedido, cliente ou comanda..." value={query} onChange={event => setQuery(event.target.value)}/></label>
                  <button className={styles.primaryBtn} type="button" onClick={() => setManualOrderOpen(true)}>+ Novo pedido</button>
                </div>
              </header>

              <div className={styles.ordersCard}>
                <div className={styles.filters}>
                  {([['todos','Todos'],['hoje','Hoje'],['producao','Em produção'],['prontos','Prontos'],['entregues','Entregues']] as Array<[FilterKey,string]>).map(([key,label]) => <button key={key} className={`${styles.filter} ${filter === key ? styles.filterActive : ""}`} type="button" onClick={() => setFilter(key)}>{label} <span className={styles.count}>{counts[key]}</span></button>)}
                </div>

                {error ? <div className={styles.error}><strong>Não foi possível carregar os pedidos</strong><span>{error}</span><button className={styles.secondaryBtn} type="button" onClick={() => void reload()}>Tentar novamente</button></div> : <div className={styles.table}>
                  <div className={styles.thead}><div>Pedido</div><div>Cliente</div><div>Comanda</div><div>Retirada / Entrega</div><div>Status</div><div>Pagamento</div><div>Total</div><div/></div>
                  {visible.map(order => {
                    const status = orderStatus(order); const payment = paymentStatus(order); const comanda = comandaState(order); const selectedRow = selected?.id === order.id;
                    return <div key={order.id} className={`${styles.orderRow} ${selectedRow ? styles.selected : ""}`} onClick={() => openOrder(order)}>
                      <div className={styles.orderId}>#{order.id}</div>
                      <div className={styles.stack}><span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span><span className={styles.secondary}>{itemSummary(order)}</span></div>
                      <div className={styles.stack}>{comanda ? <><span>Comanda #{order.id}</span><span className={`${styles.dotline} ${comanda === "Aberta" ? styles.open : styles.closed}`}><span className={styles.dot}/>{comanda}</span></> : <><span className={styles.secondary}>Sem comanda</span><span className={styles.secondary}>—</span></>}</div>
                      <div className={styles.stack}><span><Icon name={order.tipo_entrega === "ENTREGA" ? "truck" : "bag"} className={styles.rowIco}/>{scheduleLabel(order)}</span><span className={styles.secondary}>{order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada"}</span></div>
                      <div><span className={`${styles.tag} ${styles[`tag${status.tone[0].toUpperCase()}${status.tone.slice(1)}`]}`}>{status.label}</span></div>
                      <div className={styles.stack}>{payment.label === "Pago" ? <span className={styles.paymentOk}><span className={styles.check}>✓</span> Pago</span> : <span className={payment.className}>{payment.label}</span>}<span className={styles.secondary}>{payment.label === "Pendente" ? "—" : paymentMethod(order)}</span></div>
                      <div className={styles.money}>{money(order.valor_total_centavos)}</div><div className={styles.chev}>›</div>
                      <div className={styles.mobileMain}><div className={styles.mobileTitleLine}><span className={styles.orderId}>#{order.id}</span><span className={styles.primary}>{order.cliente_nome || "Cliente não informado"}</span></div><div className={styles.mobileMeta}>{itemSummary(order)}</div><div className={styles.mobileMeta}>{scheduleLabel(order)} · {order.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada"}{comanda ? ` · Comanda #${order.id} ${comanda.toLowerCase()}` : " · Sem comanda"}</div><div><span className={`${styles.tag} ${styles[`tag${status.tone[0].toUpperCase()}${status.tone.slice(1)}`]}`}>{status.label}</span></div></div>
                      <div className={styles.mobileRight}><span className={styles.money}>{money(order.valor_total_centavos)}</span>{payment.label === "Pago" ? <span className={styles.paymentOk}><span className={styles.check}>✓</span> Pago</span> : <span className={payment.className}>{payment.label}</span>}<span className={styles.chev}>›</span></div>
                    </div>;
                  })}
                  {!loading && visible.length === 0 ? <div className={styles.empty}>Nenhum pedido encontrado.</div> : null}
                </div>}
                <footer className={styles.tableFooter}><span>{filtered.length ? `Mostrando ${(page-1)*perPage+1}–${Math.min(page*perPage,filtered.length)} de ${filtered.length} pedidos` : "0 pedidos"}</span><div className={styles.pagination}><button className={styles.pageBtn} type="button" onClick={() => setPage(value => Math.max(1,value-1))}>‹</button>{Array.from({length: pages},(_,i)=>i+1).slice(0,5).map(value => <button key={value} className={`${styles.pageBtn} ${page===value?styles.pageActive:""}`} type="button" onClick={() => setPage(value)}>{value}</button>)}<button className={styles.pageBtn} type="button" onClick={() => setPage(value => Math.min(pages,value+1))}>›</button></div></footer>
              </div>
            </section>
          </div>
        </main>
      </div>

      <button className={`${styles.drawerBackdrop} ${selected ? styles.openBackdrop : ""}`} type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)}/>
      <aside className={`${styles.drawer} ${selected ? styles.drawerOpen : ""} ${editing ? styles.editing : ""}`} aria-hidden={!selected}>
        {selected ? <>
          <div className={styles.drawerHead}><div><h2>Pedido #{selected.id}</h2><div className={styles.drawerClient}>{selected.cliente_nome || "Cliente não informado"}</div><div className={styles.drawerTags}>{comandaState(selected) ? <span className={`${styles.tag} ${styles.tagPurple}`}>Comanda #{selected.id}</span> : null}<span className={`${styles.tag} ${styles[`tag${orderStatus(selected).tone[0].toUpperCase()}${orderStatus(selected).tone.slice(1)}`]}`}>{orderStatus(selected).label}</span></div></div><button className={styles.close} type="button" aria-label="Fechar" onClick={() => setSelected(null)}>×</button></div>
          <div className={styles.drawerMeta}><span><Icon name={selected.tipo_entrega === "ENTREGA" ? "truck" : "bag"} className={styles.rowIco}/>{scheduleLabel(selected)}</span><span className={styles.bullet}/><span>{selected.tipo_entrega === "ENTREGA" ? "Entrega" : "Retirada"}</span></div>
          {!editing ? <div className={styles.tabs}><button className={`${styles.tab} ${activeTab === "pedido" ? styles.tabActive : ""}`} type="button" onClick={() => setActiveTab("pedido")}>Pedido</button><button className={`${styles.tab} ${activeTab === "comanda" ? styles.tabActive : ""}`} type="button" onClick={() => setActiveTab("comanda")}>Comanda</button></div> : null}

          {!editing && activeTab === "pedido" ? <div className={styles.pedidoPanel}><section className={styles.drawerSection}><h3 className={styles.sectionTitle}>Itens do pedido</h3>{itemsOf(selected).map((item,index)=><div className={styles.lineItem} key={`${item.produto_id||'item'}-${index}`}><span>{item.produto_nome || "Produto"}</span><span className={styles.qty}>{item.quantidade}x</span><span className={styles.price}>{money(item.valor_total_centavos)}</span></div>)}<div className={styles.totalRow}><span>Total do pedido</span><span>{money(selected.valor_total_centavos)}</span></div></section><section className={styles.drawerSection}><h3 className={styles.sectionTitle}>Pagamento</h3><div className={styles.paymentRow}><div className={styles.paymentLeft}>{paymentStatus(selected).label === "Pago" ? <span className={`${styles.tag} ${styles.tagGreen}`}>✓ &nbsp; Pago</span> : <span className={`${styles.tag} ${styles.tagOrange}`}>{paymentStatus(selected).label}</span>}<span className={styles.method}>Método</span></div><div className={styles.paymentLeftEnd}><span>&nbsp;</span><span className={styles.method}>{paymentMethod(selected)}</span></div></div></section><section className={`${styles.drawerSection} ${styles.lastSection}`}><h3 className={styles.sectionTitle}>Observações</h3><div className={styles.note}>{selected.observacao || "—"}</div></section></div> : null}

          {!editing && activeTab === "comanda" ? <div className={`${styles.comandaPanel} ${styles.comandaActive}`}><section className={styles.drawerSection}><h3 className={styles.sectionTitle}>Comanda #{selected.id} · {comandaState(selected) || "Aberta"}</h3>{financialLoading ? <div className={styles.note}>Carregando comanda...</div> : (financial?.itens || itemsOf(selected)).map((item,index)=><div className={styles.comandaItem} key={`${item.id||item.produto_id||'item'}-${index}`}><div><strong>{item.produto_nome || "Produto"}</strong><div className={styles.comandaStatus}>Pedido #{selected.id}{"status_financeiro" in item ? ` · ${String(item.status_financeiro).toLowerCase()}` : ""}</div></div><div>{money(item.valor_total_centavos)}</div></div>)}<div className={styles.comandaSummary}><div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Total da comanda</span><span>{money(financial?.valor_total_centavos ?? selected.valor_total_centavos)}</span></div><div className={`${styles.summaryRow} ${styles.summaryPaid}`}><span>Pago</span><span>{money(financial?.valor_pago_centavos ?? (String(selected.status_pagamento).toUpperCase()==="PAGO"?selected.valor_total_centavos:0))}</span></div><div className={`${styles.summaryRow} ${styles.summaryPending}`}><span>Pendente</span><span>{money(financial?.saldo_centavos ?? (String(selected.status_pagamento).toUpperCase()==="PAGO"?0:selected.valor_total_centavos))}</span></div></div></section></div> : null}

          {editing ? <div className={styles.pedidoEdit}><section className={styles.drawerSection}><div className={styles.field}><label className={styles.fieldLabel}>Status do pedido</label><select className={styles.formControl} value={editStatus} onChange={event => setEditStatus(event.target.value as OrderStatus)}><option value="NOVO">Confirmado</option><option value="PREPARANDO">Em produção</option><option value="PRONTO">Pronto</option><option value="ENTREGUE">Entregue</option><option value="CANCELADO">Cancelado</option></select></div></section><section className={styles.drawerSection}><h3 className={styles.sectionTitle}>Itens do pedido</h3>{itemsOf(selected).map((item,index)=><div className={styles.editItemRow} key={`${item.produto_id||'item'}-${index}`}><span className={styles.editItemName}>{item.produto_nome || "Produto"}</span><span className={styles.editItemQty}><button type="button" disabled>−</button><input value={item.quantidade} readOnly/><button type="button" disabled>+</button></span><span className={styles.editItemPrice}>{money(item.valor_total_centavos)}</span><button type="button" className={styles.editItemRemove} disabled>×</button></div>)}<div className={styles.totalRow}><span>Total do pedido</span><span>{money(selected.valor_total_centavos)}</span></div></section><section className={styles.drawerSection}><h3 className={styles.sectionTitle}>Pagamento</h3><div className={styles.fieldRow}><div className={styles.field}><label className={styles.fieldLabel}>Status</label><select className={styles.formControl} value={paymentStatus(selected).label} disabled><option>{paymentStatus(selected).label}</option></select></div><div className={styles.field}><label className={styles.fieldLabel}>Método</label><select className={styles.formControl} value={paymentMethod(selected) || "—"} disabled><option>{paymentMethod(selected) || "—"}</option></select></div></div></section><section className={`${styles.drawerSection} ${styles.lastSection}`}><div className={styles.field}><label className={styles.fieldLabel}>Observações</label><textarea className={styles.formControl} value={selected.observacao || ""} readOnly/></div></section></div> : null}

          {!editing ? <div className={`${styles.drawerActions} ${styles.viewActions}`}><button className={styles.primaryBtn} type="button" onClick={() => setActiveTab("comanda")}><Icon name="receipt" className={styles.btnIco}/>Ver comanda</button><button className={styles.secondaryBtn} type="button" onClick={() => setEditing(true)}><Icon name="edit" className={styles.btnIco}/>Editar pedido</button></div> : <div className={`${styles.drawerActions} ${styles.editActions}`}><button className={styles.primaryBtn} type="button" disabled={saving} onClick={() => void saveEdit()}>{saving ? "Salvando..." : "Salvar alterações"}</button><button className={styles.secondaryBtn} type="button" onClick={() => setEditing(false)}>Cancelar</button></div>}
        </> : null}
      </aside>

      {manualOrderOpen ? <ManualOrderDialog onClose={() => setManualOrderOpen(false)} onCreated={async () => { setQuery(""); setFilter("todos"); await reload(); setManualOrderOpen(false); }}/>: null}
    </div>
  );
}
