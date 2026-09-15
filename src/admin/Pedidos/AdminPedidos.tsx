import { useEffect, useState } from "react";
import AdminSidebar from "../components/AdminSidebar";
import AdminWave from "../components/AdminWave";
import PedidoDetalheModal from "./PedidoDetalheModal";
import "./AdminPedidos.css";
import NovoPedidoModal from "./NovoPedidoModal";

/* ── Types (espelham o retorno de GET /api/admin/pedidos) ── */
type StatusPreparo =
  | "RECEBIDO"
  | "EM_PREPARACAO"
  | "PRONTO_PARA_RETIRADA"
  | "RETIRADO";

type TabFilter = "todos" | "hoje" | "em_producao" | "prontos" | "entregues";

interface PedidoListItem {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_preparo: StatusPreparo;
  criado_em: string;
}

interface Counts {
  todos: number;
  hoje: number;
  em_producao: number;
  prontos: number;
  entregues: number;
}

interface PedidosResponse {
  pedidos: PedidoListItem[];
  total: number;
  page: number;
  totalPages: number;
  counts: Counts;
}

const TABS: { key: TabFilter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "hoje", label: "Hoje" },
  { key: "em_producao", label: "Em produção" },
  { key: "prontos", label: "Prontos" },
  { key: "entregues", label: "Entregues" },
];

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const statusLabel = (s: StatusPreparo) =>
  s === "RETIRADO"
    ? "Entregue"
    : s === "PRONTO_PARA_RETIRADA"
      ? "Pronto"
      : "Em produção";

const statusClass = (s: StatusPreparo) =>
  s === "RETIRADO"
    ? "ped-badge--green"
    : s === "PRONTO_PARA_RETIRADA"
      ? "ped-badge--blue"
      : "ped-badge--orange";

/* ── Component ── */
export default function AdminPedidos() {
  const [activeTab, setActiveTab] = useState<TabFilter>("todos");
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [data, setData] = useState<PedidosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);

  // Debounce da busca
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Volta pra página 1 quando o filtro muda
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, debouncedSearch]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      status: activeTab,
      page: String(currentPage),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);

    fetch(`/api/admin/pedidos?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar pedidos");
        return response.json() as Promise<PedidosResponse>;
      })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeTab, currentPage, debouncedSearch]);

  const pedidos = data?.pedidos ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const counts = data?.counts;
  const startItem = total === 0 ? 0 : (currentPage - 1) * 8 + 1;
  const endItem = Math.min(currentPage * 8, total);

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
                    {counts ? counts[tab.key] : 0}
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

          {error && <div className="ped-empty-message">{error}</div>}
          {!error && !loading && pedidos.length === 0 && (
            <div className="ped-empty-message">Nenhum pedido encontrado.</div>
          )}

          {/* Table rows */}
          {pedidos.map((pedido, i) => (
            <div
              key={pedido.id}
              className={`ped-table-row${i === pedidos.length - 1 ? " ped-table-row--last" : ""}`}
              onClick={() => setSelectedOrderId(pedido.id)}
            >
              <span className="ped-td ped-td-id">RP-{pedido.id}</span>
              <span className="ped-td ped-td-client">
                {pedido.cliente_nome}
              </span>
              <span className="ped-td ped-td-status">
                <span
                  className={`ped-badge ${statusClass(pedido.status_preparo)}`}
                >
                  {statusLabel(pedido.status_preparo)}
                </span>
              </span>
              <span className="ped-td ped-td-payment">
                <span className="ped-badge ped-badge--green">
                  ✓ Pago (Pix)
                </span>
              </span>
              <span className="ped-td ped-td-total">
                {formatarPreco(pedido.valor_total_centavos)}
              </span>
            </div>
          ))}

          {/* Pagination */}
          <div className="ped-pagination">
            <span className="ped-pagination-info">
              Mostrando {startItem}-{endItem} de {total} pedidos
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
        {selectedOrderId !== null && (
          <PedidoDetalheModal
            orderId={selectedOrderId}
            onClose={() => setSelectedOrderId(null)}
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
