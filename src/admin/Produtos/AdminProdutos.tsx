import { useEffect, useState } from "react";
import NovoProdutoModal, { imageUrlFor } from "./NovoProdutoModal";
import CategoriasModal from "./CategoriasModal";
import "./AdminProdutos.css";

/* ── Icons ── */
const IconSearch = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="#8c7a76"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="5" />
    <path d="M14 14l-3.5-3.5" />
  </svg>
);

const IconPlus = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
);

/* ── Types (espelham o retorno de GET /api/admin/produtos) ── */
export interface ProdutoAdmin {
  id: number;
  nome: string;
  categoria: string;
  descricao: string;
  preco_centavos: number;
  disponivel: number;
  ativo: number;
  destaque: number;
  promocao_ativa: number;
  // HUMAN-12: já vinham do GET administrativo; agora o modal também os edita.
  preco_promocional_centavos: number | null;
  promocao_inicio: string | null;
  promocao_fim: string | null;
  estoque: number;
  estoque_reservado: number;
  emoji: string;
  image_key: string | null;
  // Migration 0033: detalhes exibidos no cardápio ('' = não informado).
  peso_texto: string;
  ingredientes: string;
  alergenicos: string;
}

interface CategoriaResumo {
  id: string;
  nome: string;
}

type FilterTab = "todos" | "ativos" | "esgotados" | "arquivados";

function estoqueLivre(p: ProdutoAdmin) {
  return p.estoque - p.estoque_reservado;
}

function stockBadge(p: ProdutoAdmin): {
  availableText: string;
  reservedText: string | null;
  type: "critical" | "available";
} {
  const livre = Math.max(0, estoqueLivre(p));
  const reservado = Math.max(0, p.estoque_reservado);

  if (livre <= 0) {
    return {
      availableText: "Esgotado",
      reservedText: reservado > 0 ? `${reservado} reservado${reservado === 1 ? "" : "s"}` : null,
      type: "critical",
    };
  }

  return {
    availableText:
      livre <= 2
        ? `Estoque crítico (${livre} disp)`
        : `${livre} disponíveis`,
    reservedText:
      reservado > 0 ? `${reservado} reservado${reservado === 1 ? "" : "s"}` : null,
    type: livre <= 2 ? "critical" : "available",
  };
}

/* ── Component ── */
export default function AdminProdutos() {
  const [activeTab, setActiveTab] = useState<FilterTab>("ativos");
  const [searchQuery, setSearchQuery] = useState("");
  const [produtos, setProdutos] = useState<ProdutoAdmin[]>([]);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewProduct, setShowNewProduct] = useState(false);
  const [categoriasOpen, setCategoriasOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState<ProdutoAdmin | null>(
    null,
  );

  const carregarProdutos = () => {
    setLoading(true);
    fetch("/api/admin/produtos")
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar produtos");
        return response.json() as Promise<{ produtos: ProdutoAdmin[] }>;
      })
      .then((data) => {
        setProdutos(data.produtos);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(carregarProdutos, []);

  useEffect(() => {
    fetch("/api/admin/categorias")
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar categorias");
        return response.json() as Promise<{ categorias: CategoriaResumo[] }>;
      })
      .then((data) => setCategorias(data.categorias))
      .catch(() => setCategorias([]));
  }, [categoriasOpen]);

  const nomeCategoria = (id: string) =>
    categorias.find((c) => c.id === id)?.nome ?? id;

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "ativos", label: "Ativos" },
    { key: "esgotados", label: "Esgotados" },
    { key: "arquivados", label: "Arquivados" },
  ];

  const porTab = produtos.filter((p) => {
    if (activeTab === "arquivados") return p.ativo === 0;
    if (activeTab === "ativos") return p.ativo === 1;
    if (activeTab === "esgotados") return estoqueLivre(p) <= 0;
    return true;
  });

  const filtered = porTab.filter((p) =>
    p.nome.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalActive = produtos.filter((p) => p.ativo === 1).length;
  const totalOutOfStock = produtos.filter((p) => estoqueLivre(p) <= 0).length;

  return (
    <main className="admin-main">
        {/* ── Header row ── */}
        <div className="prod-header-row">
          <div className="prod-title-group">
            <h1 className="prod-title">Produtos</h1>
            <p className="prod-subtitle">
              Catálogo, categorias, estoque e promoções
            </p>
          </div>
          <div className="prod-header-actions">
            <button
              className="prod-btn-outline"
              onClick={() => setCategoriasOpen(true)}
            >
              Gerenciar categorias
            </button>
            <button
              className="prod-btn-primary"
              onClick={() => setShowNewProduct(true)}
            >
              <IconPlus />
              <span>Novo produto</span>
            </button>
          </div>
        </div>

        {/* ── Filters & stats ── */}
        <div className="prod-filters">
          <div className="prod-filter-row">
            <div className="prod-search">
              <IconSearch />
              <input
                type="text"
                placeholder="Buscar produto"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="prod-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`prod-tab${
                    activeTab === tab.key ? " prod-tab--active" : ""
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="prod-stats-line">
            <span className="prod-stats-bold">{filtered.length} produtos</span>
            <span className="prod-stats-dot" />
            <span className="prod-stats-light">{totalActive} ativos</span>
            <span className="prod-stats-dot" />
            <span className="prod-stats-light">
              {totalOutOfStock} esgotados
            </span>
          </div>
        </div>

        {loading && <p>Carregando produtos…</p>}
        {error && <p>{error}</p>}

        {/* ── Product grid ── */}
        <div className="prod-grid">
          {filtered.map((product) => {
            const badge = stockBadge(product);
            return (
              <div
                className="prod-card"
                key={product.id}
                onClick={() => setEditingProduto(product)}
              >
                <div
                  className="prod-card-image"
                  style={{
                    backgroundImage: product.image_key
                      ? `url(${imageUrlFor(product.image_key)})`
                      : undefined,
                    backgroundColor: "#f0e8e0",
                  }}
                >
                  {!product.image_key && (
                    <span className="prod-card-emoji">
                      {product.emoji || "🍰"}
                    </span>
                  )}
                </div>
                <div className="prod-card-content">
                  <div className="prod-card-badge-row">
                    <span className="prod-category-badge">
                      {nomeCategoria(product.categoria)}
                    </span>
                  </div>
                  <h3 className="prod-card-title">{product.nome}</h3>
                  <p className="prod-card-desc">{product.descricao}</p>
                  <div className="prod-card-divider" />
                  <div className="prod-card-footer">
                    <span className="prod-card-price">
                      R${" "}
                      {(product.preco_centavos / 100)
                        .toFixed(2)
                        .replace(".", ",")}
                    </span>
                    <div className="prod-stock-summary">
                      <span
                        className={`prod-stock-badge prod-stock-badge--${badge.type}`}
                      >
                        {badge.availableText}
                      </span>
                      {badge.reservedText && (
                        <span className="prod-stock-reserved">
                          {badge.reservedText}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <CategoriasModal
          open={categoriasOpen}
          onClose={() => setCategoriasOpen(false)}
        />
        <NovoProdutoModal
          open={showNewProduct}
          onClose={() => setShowNewProduct(false)}
          onSaved={carregarProdutos}
        />
        <NovoProdutoModal
          open={editingProduto !== null}
          produto={editingProduto}
          onClose={() => setEditingProduto(null)}
          onSaved={carregarProdutos}
        />
      </main>
  );
}
