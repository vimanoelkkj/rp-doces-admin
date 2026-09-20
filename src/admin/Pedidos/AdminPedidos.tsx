import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PedidoDetalheModal from "./PedidoDetalheModal";
import "./AdminPedidos.css";
import NovoPedidoModal from "./NovoPedidoModal";
import { formatarFinanceiroTexto, type FinanceiroPedido } from "./formatarFinanceiro";

/* ── Types (espelham o retorno de GET /api/admin/pedidos) ── */
type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

type TabFilter =
  | "todos"
  | "hoje"
  | "novos"
  | "em_producao"
  | "prontos"
  | "entregues"
  | "arquivados";

interface PedidoListItem {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: StatusPedido;
  criado_em: string;
  financeiro: FinanceiroPedido;
}

interface Counts {
  todos: number;
  hoje: number;
  novos: number;
  em_producao: number;
  prontos: number;
  entregues: number;
  arquivados: number;
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
  { key: "novos", label: "Novos" },
  { key: "em_producao", label: "Em produção" },
  { key: "prontos", label: "Prontos" },
  { key: "entregues", label: "Entregues" },
  { key: "arquivados", label: "Arquivados" },
];

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const STATUS_LABEL: Record<StatusPedido, string> = {
  NOVO: "Novo",
  PREPARANDO: "Em produção",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

export const statusLabel = (status: StatusPedido) => STATUS_LABEL[status];

const STATUS_CLASS: Record<StatusPedido, string> = {
  NOVO: "ped-badge--orange",
  PREPARANDO: "ped-badge--orange",
  PRONTO: "ped-badge--blue",
  ENTREGUE: "ped-badge--green",
  CANCELADO: "ped-badge--red",
};

const statusClass = (status: StatusPedido) => STATUS_CLASS[status];

/* ── Component ── */
export default function AdminPedidos() {
  const [activeTab, setActiveTab] = useState<TabFilter>("todos");
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [data, setData] = useState<PedidosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageCacheRef = useRef<Map<number, PedidosResponse>>(new Map());
  const inFlightRef = useRef<Map<number, Promise<PedidosResponse>>>(new Map());
  const requestVersionRef = useRef(0);

  // HUMAN-14: as notificações levam ao pedido exato via `?pedido=<id>`, que é
  // o destino real da ação contextual. Sem isso a notificação só conseguiria
  // apontar para a lista inteira.
  const [searchParams, setSearchParams] = useSearchParams();
  const pedidoNaUrl = Number(searchParams.get("pedido"));
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(
    Number.isInteger(pedidoNaUrl) && pedidoNaUrl > 0 ? pedidoNaUrl : null,
  );

  useEffect(() => {
    if (Number.isInteger(pedidoNaUrl) && pedidoNaUrl > 0) setSelectedOrderId(pedidoNaUrl);
  }, [pedidoNaUrl]);

  // Fechar o detalhe limpa o parâmetro, para que voltar/atualizar não reabra
  // um modal que o operador já dispensou.
  const fecharDetalhe = () => {
    setSelectedOrderId(null);
    if (searchParams.has("pedido")) {
      const proximos = new URLSearchParams(searchParams);
      proximos.delete("pedido");
      setSearchParams(proximos, { replace: true });
    }
  };
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const aoAnular = (event: Event) => {
      const id = (event as CustomEvent<{ pedidoId: number }>).detail.pedidoId;
      requestVersionRef.current++;
      pageCacheRef.current.clear();
      inFlightRef.current.clear();
      setData(atual => atual ? { ...atual, pedidos: atual.pedidos.filter(pedido => pedido.id !== id) } : atual);
      setRefreshKey(key => key + 1);
    };
    window.addEventListener("pedido-anulado", aoAnular);
    return () => window.removeEventListener("pedido-anulado", aoAnular);
  }, []);

  // Debounce da busca
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Volta pra página 1 quando o filtro muda
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, debouncedSearch]);

  // O cache vale somente para o filtro/busca/versão atual da listagem.
  // Assim a paginação pode ser instantânea sem manter dados antigos depois
  // de criar/alterar um pedido.
  useEffect(() => {
    pageCacheRef.current.clear();
    inFlightRef.current.clear();
  }, [activeTab, debouncedSearch, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = requestVersionRef.current;
    const obsoleto = () => cancelled || requestVersion !== requestVersionRef.current;

    const carregarPagina = (page: number): Promise<PedidosResponse> => {
      const cached = pageCacheRef.current.get(page);
      if (cached) return Promise.resolve(cached);

      const emVoo = inFlightRef.current.get(page);
      if (emVoo) return emVoo;

      const params = new URLSearchParams({
        status: activeTab,
        page: String(page),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const requisicao = fetch(`/api/admin/pedidos?${params.toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Falha ao carregar pedidos");
          return response.json() as Promise<PedidosResponse>;
        })
        .then((result) => {
          if (!obsoleto()) pageCacheRef.current.set(page, result);
          return result;
        })
        .finally(() => {
          if (!obsoleto()) inFlightRef.current.delete(page);
        });

      inFlightRef.current.set(page, requisicao);
      return requisicao;
    };

    const cached = pageCacheRef.current.get(currentPage);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    carregarPagina(currentPage)
      .then((result) => {
        if (obsoleto()) return;
        if (currentPage > result.totalPages) setCurrentPage(result.totalPages);
        setData(result);
        setError(null);
        setLoading(false);

        // Deixa as páginas vizinhas prontas antes do clique. A listagem tem
        // só 8 itens por página, então o custo é pequeno e a troca seguinte
        // não precisa esperar um round-trip completo ao D1.
        for (const page of [currentPage - 1, currentPage + 1]) {
          if (page < 1 || page > result.totalPages) continue;
          void carregarPagina(page).catch(() => {
            // Prefetch é melhor-esforço; erro só importa quando a página
            // realmente for aberta pelo operador.
          });
        }
      })
      .catch((err) => {
        if (obsoleto()) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentPage, debouncedSearch, refreshKey]);

  const pedidos = data?.pedidos ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const counts = data?.counts;
  const startItem = total === 0 ? 0 : (currentPage - 1) * 8 + 1;
  const endItem = Math.min(currentPage * 8, total);

  return (
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
                  className={`ped-badge ${statusClass(pedido.status_pedido)}`}
                >
                  {statusLabel(pedido.status_pedido)}
                </span>
              </span>
              <span className="ped-td ped-td-payment">
                <span className={`ped-badge ped-badge--${formatarFinanceiroTexto(pedido.financeiro).cor}`}>
                  {formatarFinanceiroTexto(pedido.financeiro).texto}
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
            onClose={fecharDetalhe}
            onStatusChanged={() => setRefreshKey((k) => k + 1)}
          />
        )}
        <NovoPedidoModal
          open={novoPedidoOpen}
          onClose={() => setNovoPedidoOpen(false)}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      </main>
  );
}
