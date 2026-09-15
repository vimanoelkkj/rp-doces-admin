import { useState } from "react";
import AdminSidebar from "../components/AdminSidebar";
import AdminWave from "../components/AdminWave";
import PedidoDetalheModal from "./PedidoDetalheModal";
import type { OrderDetail } from "./PedidoDetalheModal";
import "./AdminPedidos.css";
import NovoPedidoModal from "./NovoPedidoModal";

/* ── Types ── */
type OrderStatus = "em_producao" | "pronto" | "entregue";
type PaymentMethod = "Dinheiro" | "Pix" | "Cartão";
type TabFilter = "todos" | "hoje" | "em_producao" | "prontos" | "entregues";

interface Order {
  id: string;
  client: string;
  status: OrderStatus;
  payment: PaymentMethod;
  total: string;
}

/* ── Mock data ── */
const ORDERS: Order[] = [
  {
    id: "RP-33",
    client: "RP",
    status: "entregue",
    payment: "Dinheiro",
    total: "R$ 40,00",
  },
  {
    id: "RP-32",
    client: "Natália da Luz",
    status: "entregue",
    payment: "Pix",
    total: "R$ 40,00",
  },
  {
    id: "RP-31",
    client: "Maria Eduarda",
    status: "entregue",
    payment: "Cartão",
    total: "R$ 15,00",
  },
  {
    id: "RP-22",
    client: "Bianca Pacheco",
    status: "entregue",
    payment: "Cartão",
    total: "R$ 20,00",
  },
  {
    id: "RP-21",
    client: "Paula Tempest",
    status: "entregue",
    payment: "Pix",
    total: "R$ 20,00",
  },
  {
    id: "RP-20",
    client: "Eliana",
    status: "entregue",
    payment: "Dinheiro",
    total: "R$ 20,00",
  },
  {
    id: "RP-19",
    client: "Silma",
    status: "entregue",
    payment: "Dinheiro",
    total: "R$ 40,00",
  },
  {
    id: "RP-18",
    client: "Márcia",
    status: "entregue",
    payment: "Pix",
    total: "R$ 40,00",
  },
];

const TABS: { key: TabFilter; label: string; count: number }[] = [
  { key: "todos", label: "Todos", count: 19 },
  { key: "hoje", label: "Hoje", count: 0 },
  { key: "em_producao", label: "Em produção", count: 0 },
  { key: "prontos", label: "Prontos", count: 0 },
  { key: "entregues", label: "Entregues", count: 19 },
];

const ITEMS_PER_PAGE = 8;
const TOTAL_ORDERS = 19;

/* ── Helpers ── */
const statusLabel = (s: OrderStatus) =>
  s === "em_producao" ? "Em produção" : s === "pronto" ? "Pronto" : "Entregue";

const statusClass = (s: OrderStatus) =>
  s === "em_producao"
    ? "ped-badge--orange"
    : s === "pronto"
      ? "ped-badge--blue"
      : "ped-badge--green";

/* ── Component ── */
export default function AdminPedidos() {
  const [activeTab, setActiveTab] = useState<TabFilter>("todos");
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");

  const totalPages = Math.ceil(TOTAL_ORDERS / ITEMS_PER_PAGE);
  const startItem = (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endItem = Math.min(currentPage * ITEMS_PER_PAGE, TOTAL_ORDERS);

  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);

  return (
    <div className="admin-layout">
      <AdminWave />
      <AdminSidebar />

      <main className="admin-main">
        {/* Header */}
        <div className="ped-header-row">
          <div className="ped-title-group">
            <h1 className="ped-title">Pedidos</h1>
            <p className="ped-subtitle">
              Gerenciamento de comandas e entregas em tempo real
            </p>
          </div>
          <div className="ped-header-actions">
            <button
              className="ped-btn-primary"
              onClick={() => setNovoPedidoOpen(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
              Novo pedido
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="ped-filters">
          <div className="ped-filter-row">
            <div className="ped-search">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="#8c7a76"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
              <input
                type="text"
                placeholder="Buscar pedido, cliente ou comanda..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="ped-shortcut">⌘K</span>
            </div>

            <div className="ped-tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`ped-tab${activeTab === tab.key ? " ped-tab--active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  <span
                    className={`ped-tab-count${activeTab === tab.key ? " ped-tab-count--active" : ""}`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Orders table */}
        <div className="ped-table-panel">
          {/* Table header */}
          <div className="ped-table-header">
            <span className="ped-th ped-th-id">Pedido</span>
            <span className="ped-th ped-th-client">Cliente</span>
            <span className="ped-th ped-th-status">Status</span>
            <span className="ped-th ped-th-payment">Pagamento</span>
            <span className="ped-th ped-th-total">Total</span>
          </div>

          {/* Table rows */}
          {ORDERS.map((order, i) => (
            <div
              key={order.id}
              className={`ped-table-row${i === ORDERS.length - 1 ? " ped-table-row--last" : ""}`}
              onClick={() =>
                setSelectedOrder({
                  id: order.id,
                  number: parseInt(order.id.replace("RP-", "")),
                  client: order.client,
                  status: "Entregue",
                  statusType: "green",
                  date: "10/09, 15:14",
                  deliveryType: "Retirada",
                  items: [
                    {
                      name: "Ninho & Nutella",
                      emoji: "🍫",
                      qty: 1,
                      unitPrice: "R$ 20,00",
                      totalPrice: "R$ 20,00",
                    },
                    {
                      name: "Prestígio cremoso",
                      emoji: "🥥",
                      qty: 1,
                      unitPrice: "R$ 20,00",
                      totalPrice: "R$ 20,00",
                    },
                  ],
                  subtotal: order.total,
                  total: order.total,
                  paymentStatus: "Pago",
                  paymentMethod: order.payment,
                })
              }
            >
              <span className="ped-td ped-td-id">{order.id}</span>
              <span className="ped-td ped-td-client">{order.client}</span>
              <span className="ped-td ped-td-status">
                <span className={`ped-badge ${statusClass(order.status)}`}>
                  {statusLabel(order.status)}
                </span>
              </span>
              <span className="ped-td ped-td-payment">
                <span className="ped-badge ped-badge--green">
                  ✓ Pago ({order.payment})
                </span>
              </span>
              <span className="ped-td ped-td-total">{order.total}</span>
            </div>
          ))}

          {/* Pagination */}
          <div className="ped-pagination">
            <span className="ped-pagination-info">
              Mostrando {startItem}-{endItem} de {TOTAL_ORDERS} pedidos
            </span>
            <div className="ped-pagination-controls">
              <button
                className="ped-page-btn ped-page-arrow"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9,2 4,7 9,12" />
                </svg>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (page) => (
                  <button
                    key={page}
                    className={`ped-page-btn ped-page-num${currentPage === page ? " ped-page-num--active" : ""}`}
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </button>
                ),
              )}
              <button
                className="ped-page-btn ped-page-arrow"
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="5,2 10,7 5,12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {selectedOrder && (
          <PedidoDetalheModal
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
          />
        )}
        <NovoPedidoModal
          open={novoPedidoOpen}
          onClose={() => setNovoPedidoOpen(false)}
        />
      </main>
    </div>
  );
}
