import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import CartWidget from "../components/CartWidget";
import { useCatalogProducts } from "../hooks/useCatalogProducts";
import { useCart } from "../context/CartContext";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { catalogCategories } from "./catalogCategories";
import { motion, useReducedMotion } from "motion/react";
import "./Cardapio.css";

const PRIMARY_A =
  "M0 0V324.8C120.0 433.1 253.3 460.1 400.0 406.0C546.7 351.9 680.0 340.3 800.0 371.2C920.0 402.1 1053.3 394.4 1200.0 348.0C1320.0 309.3 1400.0 270.7 1440 232.0V0H0Z";

const PRIMARY_B =
  "M0 0V332.8C134.0 421.1 271.0 448.1 416.0 396.0C562.0 362.9 697.0 354.3 817.0 383.2C938.0 391.1 1070.0 382.4 1214.0 340.0C1332.0 319.3 1410.0 280.7 1440 240.0V0H0Z";

const PRIMARY_C =
  "M0 0V318.8C108.0 438.1 238.0 466.1 386.0 413.0C532.0 342.9 664.0 329.3 784.0 360.2C904.0 412.1 1038.0 403.4 1186.0 355.0C1308.0 301.3 1390.0 262.7 1440 226.0V0H0Z";

const SECONDARY_A =
  "M0 0V335.8C132.0 445.1 268.0 469.1 412.0 395.0C536.0 339.9 668.0 351.3 788.0 384.2C934.0 413.1 1066.0 383.4 1188.0 335.0C1310.0 320.3 1392.0 283.7 1440 241.0V0H0Z";

const SECONDARY_B =
  "M0 0V329.8C118.0 437.1 252.0 461.1 398.0 403.0C550.0 347.9 684.0 360.3 804.0 392.2C918.0 404.1 1050.0 374.4 1202.0 328.0C1322.0 327.3 1402.0 290.7 1440 247.0V0H0Z";

const SECONDARY_C =
  "M0 0V341.8C146.0 451.1 282.0 475.1 426.0 388.0C522.0 332.9 654.0 343.3 774.0 376.2C948.0 421.1 1080.0 391.4 1174.0 341.0C1298.0 314.3 1382.0 276.7 1440 236.0V0H0Z";


// `null` = "Todos", opção sintética da interface (nunca uma categoria
// persistida). Qualquer outro valor é o SLUG canônico da categoria
// (`categorias.id`), nunca o nome de exibição.
type CategoryFilter = string | null;

export default function Cardapio() {
  const shouldReduceMotion = useReducedMotion();
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
      <div className="cardapio-wave" aria-hidden="true">
        <svg
          viewBox="0 0 1440 434"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <motion.path
            className="wave-secondary"
            d={SECONDARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : { d: [SECONDARY_A, SECONDARY_B, SECONDARY_C] }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 12,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
          />
          <motion.path
            className="wave-primary"
            d={PRIMARY_A}
            animate={
              shouldReduceMotion
                ? undefined
                : { d: [PRIMARY_A, PRIMARY_B, PRIMARY_C] }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 9,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }
            }
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
