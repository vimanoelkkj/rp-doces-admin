import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import CartWidget from "../components/CartWidget";
import { useCatalogProducts } from "../hooks/useCatalogProducts";
import { useCart } from "../context/CartContext";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { catalogCategories } from "./catalogCategories";
import "./Cardapio.css";

// `null` = "Todos", opção sintética da interface (nunca uma categoria
// persistida). Qualquer outro valor é o SLUG canônico da categoria
// (`categorias.id`), nunca o nome de exibição.
type CategoryFilter = string | null;

export default function Cardapio() {
  const { products, loading, error } = useCatalogProducts();
  const categories = useMemo(() => catalogCategories(products), [products]);

  const [activeFilter, setActiveFilter] = useState<CategoryFilter>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [displayFilter, setDisplayFilter] = useState<CategoryFilter>(null);
  const [containerHeight, setContainerHeight] = useState<number | "auto">("auto");
  const productsAreaRef = useRef<HTMLDivElement>(null);

  const {
    cartItems,
    cartOpen,
    setCartOpen,
    addToCart,
    updateQuantity,
    removeItem,
    reconcileWithProducts,
  } = useCart();

  useEffect(() => {
    if (products.length > 0) {
      reconcileWithProducts(products);
    }
  }, [products, reconcileWithProducts]);

  const headingRef = useScrollReveal<HTMLDivElement>(0.15);

  const handleFilterChange = (cat: CategoryFilter) => {
    if (cat === activeFilter) return;
    setActiveFilter(cat);
    setIsFiltering(true);

    // Trava a altura atual antes de trocar o conteúdo, para poder animar
    // suavemente até a altura do novo filtro — sem isso, o container (e
    // tudo que vem depois dele, como o Footer) pula de golpe pra nova
    // altura no meio da transição de fade.
    if (productsAreaRef.current) {
      setContainerHeight(productsAreaRef.current.scrollHeight);
    }

    // Fade out → troca conteúdo → fade in
    setTimeout(() => {
      setDisplayFilter(cat);
      requestAnimationFrame(() => {
        setIsFiltering(false);
      });
    }, 250);
  };

  // Depois que o conteúdo troca (displayFilter muda), mede a altura real
  // do novo conteúdo e anima até ela. Só faz isso quando já estamos numa
  // transição (containerHeight travado em número pelo handleFilterChange
  // acima) — no carregamento inicial containerHeight continua "auto" e
  // nada é animado aqui.
  useLayoutEffect(() => {
    if (typeof containerHeight === "number" && productsAreaRef.current) {
      setContainerHeight(productsAreaRef.current.scrollHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayFilter]);

  // Se uma revalidação remover a categoria selecionada, volta para a visão
  // completa em vez de manter uma aba órfã e um catálogo aparentemente vazio.
  useEffect(() => {
    if (activeFilter !== null && !categories.some((c) => c.slug === activeFilter)) {
      setActiveFilter(null);
      setDisplayFilter(null);
      setIsFiltering(false);
      setContainerHeight("auto");
    }
  }, [activeFilter, categories]);

  const handleContainerTransitionEnd = (
    event: React.TransitionEvent<HTMLDivElement>,
  ) => {
    // Libera para "auto" só depois que a animação de altura (não a de
    // opacidade/transform, que rodam em paralelo) termina, pra manter o
    // layout correto em resizes futuros sem travar numa altura antiga.
    if (event.propertyName === "height") {
      setContainerHeight("auto");
    }
  };

  const filteredProducts =
    displayFilter === null
      ? products
      : products.filter((product) => product.categorySlug === displayFilter);

  const groupedProducts = categories
    .map(({ slug, nome }) => ({
      slug,
      nome,
      products: filteredProducts.filter((product) => product.categorySlug === slug),
    }))
    .filter((group) => group.products.length > 0);

  return (
    <div className="cardapio-page">
      <Header />
      {/* Onda decorativa */}
      <div className="cardapio-wave">
        <svg
          viewBox="0 0 1440 500"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <path
            d="M0 0V375C120 500 253.333 531.25 400 468.75C546.667 406.25 680 392.857 800 428.571C920 464.286 1053.33 455.357 1200 401.786C1320 357.143 1400 312.5 1440 267.857V0H0Z"
            fill="#EDDCC6"
          />
        </svg>
      </div>
      <main className="cardapio-content">
        <div className="section-heading scroll-reveal" ref={headingRef}>
          <div className="heading-text">
            <h1 className="cardapio-title">Cardápio</h1>
            <p className="cardapio-subtitle">
              Escolha e adoce o seu dia com os nossos encantos artesanais.
            </p>
          </div>
          <div
            className="filter-tabs"
            role="tablist"
            aria-label="Filtrar produtos"
          >
            <button
              role="tab"
              aria-selected={activeFilter === null}
              className={`filter-tab ${activeFilter === null ? "active" : ""}`}
              onClick={() => handleFilterChange(null)}
            >
              Todos
            </button>
            {categories.map(({ slug, nome }) => (
              <button
                key={slug}
                role="tab"
                aria-selected={activeFilter === slug}
                className={`filter-tab ${activeFilter === slug ? "active" : ""}`}
                onClick={() => handleFilterChange(slug)}
              >
                {nome}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="cardapio-subtitle">Carregando cardápio…</p>}
        {error && <p className="cardapio-subtitle">{error}</p>}

        <div
          className="products-area"
          style={{
            height: containerHeight === "auto" ? "auto" : `${containerHeight}px`,
          }}
          onTransitionEnd={handleContainerTransitionEnd}
        >
          <div
            ref={productsAreaRef}
            className={`products-area-inner ${isFiltering ? "products-area--out" : "products-area--in"}`}
          >
            {!loading && !error && filteredProducts.length === 0 && (
              <p className="cardapio-empty-state">
                Nenhum produto disponível no momento.
              </p>
            )}

            {groupedProducts.map(({ slug, nome, products: categoryProducts }) => (
              <section
                key={slug}
                className="category-group scroll-reveal revealed"
                aria-label={nome}
              >
                <h2 className="category-title">{nome}</h2>
                <div className="products-grid">
                  {categoryProducts.map((product, index) => (
                    <div
                      key={product.id}
                      className="product-card-wrapper filter-card"
                      style={{ animationDelay: `${index * 0.08}s` }}
                    >
                      <ProductCard
                        product={product}
                        onAddToCart={() => addToCart(product)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
      <CartWidget
        items={cartItems}
        isOpen={cartOpen}
        onOpen={() => setCartOpen(true)}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeItem}
      />
    </div>
  );
}
