import { useState } from "react";
import AdminSidebar from "../components/AdminSidebar";
import NovoProdutoModal from "./NovoProdutoModal";
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

/* ── Types ── */
interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: string;
  stock: {
    text: string;
    type: "critical" | "available";
  };
  image: string; // placeholder URL or path
}

/* ── Static data (matching Figma) ── */
const products: Product[] = [
  {
    id: "1",
    name: "Encanto de frutas vermelhas 🍓",
    category: "🍰 Bolos no pote",
    description:
      "Massa amanteigada delicada, combinada com um delicioso creme de Ninho e o doce natural de frutas vermelhas premium selecionadas.",
    price: "R$ 20,00",
    stock: { text: "Estoque crítico (1 disp)", type: "critical" },
    image: "/images/frutas-vermelhas.jpg",
  },
  {
    id: "2",
    name: "Ninho & Nutella 🍫",
    category: "🍰 Bolos no pote",
    description:
      "Massa de cacau macia combinada com um recheio generoso de Ninho, adicionando camadas de Nutella cremosa e aveludada.",
    price: "R$ 20,00",
    stock: { text: "Estoque crítico (1 disp)", type: "critical" },
    image: "/images/ninho-nutella.jpg",
  },
  {
    id: "3",
    name: "Prestígio cremoso 🥥",
    category: "🍰 Bolos no pote",
    description:
      "Massa de chocolate com um delicioso recheio cremoso de coco e uma generosa ganache de chocolate 50% para harmonização perfeita.",
    price: "R$ 20,00",
    stock: { text: "5 disponíveis", type: "available" },
    image: "/images/prestigio.jpg",
  },
  {
    id: "4",
    name: "Tentação de maracujá 💛",
    category: "🍰 Bolos no pote",
    description:
      "Bolo de chocolate com camadas cremosas de mousse de maracujá fresco e ganache artesanal de chocolate meio amargo.",
    price: "R$ 20,00",
    stock: { text: "7 disponíveis", type: "available" },
    image: "/images/maracuja.jpg",
  },
  {
    id: "5",
    name: "Pudim 🍮",
    category: "🍮 Sobremesas",
    description:
      "Pudim de leite condensado tradicional com textura super macia, sem furinhos, regado com uma calda brilhante de caramelo.",
    price: "R$ 15,00",
    stock: { text: "11 disponíveis", type: "available" },
    image: "/images/pudim.jpg",
  },
];

type FilterTab = "todos" | "ativos" | "esgotados" | "arquivados";

/* ── Component ── */
export default function AdminProdutos() {
  const [activeTab, setActiveTab] = useState<FilterTab>("todos");
  const [searchQuery, setSearchQuery] = useState("");

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "ativos", label: "Ativos" },
    { key: "esgotados", label: "Esgotados" },
    { key: "arquivados", label: "Arquivados" },
  ];

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalActive = products.length;
  const totalOutOfStock = 0;
  const [showNewProduct, setShowNewProduct] = useState(false);

  const [categoriasOpen, setCategoriasOpen] = useState(false);

  return (
    <div className="admin-layout">
      <AdminSidebar />

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

        {/* ── Product grid ── */}
        <div className="prod-grid">
          {filtered.map((product) => (
            <div className="prod-card" key={product.id}>
              <div
                className="prod-card-image"
                style={{
                  backgroundImage: `url(${product.image})`,
                  backgroundColor: "#f0e8e0",
                }}
              />
              <div className="prod-card-content">
                <div className="prod-card-badge-row">
                  <span className="prod-category-badge">
                    {product.category}
                  </span>
                </div>
                <h3 className="prod-card-title">{product.name}</h3>
                <p className="prod-card-desc">{product.description}</p>
                <div className="prod-card-divider" />
                <div className="prod-card-footer">
                  <span className="prod-card-price">{product.price}</span>
                  <span
                    className={`prod-stock-badge prod-stock-badge--${product.stock.type}`}
                  >
                    {product.stock.text}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <CategoriasModal
          open={categoriasOpen}
          onClose={() => setCategoriasOpen(false)}
        />
        <NovoProdutoModal
          open={showNewProduct}
          onClose={() => setShowNewProduct(false)}
        />
      </main>
    </div>
  );
}
