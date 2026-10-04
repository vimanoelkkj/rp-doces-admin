import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import NovoPedidoModal from "./NovoPedidoModal";
import PedidoDetalheModal from "./PedidoDetalheModal";
import PedidosPaginacao from "./PedidosPaginacao";
import PedidosTabela from "./PedidosTabela";
import { type PedidosResponse, type TabFilter, statusLabel } from "./adminPedidosHelpers";
import "./AdminPedidos.css";

export { statusLabel };

const TABS: { key: TabFilter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "hoje", label: "Hoje" },
  { key: "novos", label: "Novos" },
  { key: "em_producao", label: "Em produção" },
  { key: "prontos", label: "Prontos" },
  { key: "entregues", label: "Entregues" },
  { key: "arquivados", label: "Arquivados" }
];

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
    Number.isInteger(pedidoNaUrl) && pedidoNaUrl > 0 ? pedidoNaUrl : null
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
      setData(atual =>
        atual ? { ...atual, pedidos: atual.pedidos.filter(pedido => pedido.id !== id) } : atual
      );
      setRefreshKey(key => key + 1);
    };
    window.addEventListener("pedido-anulado", aoAnular);
    return () => window.removeEventListener("pedido-anulado", aoAnular);
  }, []);

  // Reconciliação global disparada explicitamente uma vez na abertura da tela.
  // Não reexecuta em paginação, busca ou troca de abas; falhas não bloqueiam a tela.
  useEffect(() => {
    fetch("/api/admin/pedidos/reconciliar", { method: "POST" }).catch(err => {
      console.warn("Falha na reconciliação inicial de pedidos", err);
    });
  }, []);

  // Debounce da busca
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Volta pra página 1 quando o filtro muda
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab e debouncedSearch são gatilhos: trocar filtro ou busca volta à página 1
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, debouncedSearch]);

  // O cache vale somente para o filtro/busca/versão atual da listagem.
  // Assim a paginação pode ser instantânea sem manter dados antigos depois
  // de criar/alterar um pedido.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab, debouncedSearch e refreshKey são gatilhos: qualquer um invalida o cache de páginas
  useEffect(() => {
    pageCacheRef.current.clear();
    inFlightRef.current.clear();
  }, [activeTab, debouncedSearch, refreshKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey é gatilho manual: criar, alterar ou anular pedido o incrementa para refazer o fetch
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
        page: String(page)
      });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const requisicao = fetch(`/api/admin/pedidos?${params.toString()}`)
        .then(async response => {
          if (!response.ok) throw new Error("Falha ao carregar pedidos");
          return response.json() as Promise<PedidosResponse>;
        })
        .then(result => {
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
      .then(result => {
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
      .catch(err => {
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
          <p className="ped-subtitle">Gerenciamento de comandas e entregas em tempo real</p>
        </div>
        <div className="ped-header-actions">
          <button type="button" className="ped-btn-primary" onClick={() => setNovoPedidoOpen(true)}>
            <svg
              aria-hidden="true"
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
              aria-hidden="true"
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
              onChange={e => setSearch(e.target.value)}
            />
            <span className="ped-shortcut">⌘K</span>
          </div>

          <div className="ped-tabs">
            {TABS.map(tab => (
              <button
                type="button"
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
        <PedidosTabela
          pedidos={pedidos}
          loading={loading}
          error={error}
          onSelectOrder={setSelectedOrderId}
        />
        <PedidosPaginacao
          startItem={startItem}
          endItem={endItem}
          total={total}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
      {selectedOrderId !== null && (
        <PedidoDetalheModal
          orderId={selectedOrderId}
          onClose={fecharDetalhe}
          onStatusChanged={() => setRefreshKey(k => k + 1)}
        />
      )}
      <NovoPedidoModal
        open={novoPedidoOpen}
        onClose={() => setNovoPedidoOpen(false)}
        onCreated={() => setRefreshKey(k => k + 1)}
      />
    </main>
  );
}
