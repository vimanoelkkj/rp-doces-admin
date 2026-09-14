import { useEffect, useState } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import CartWidget from "../components/CartWidget";
import { Product } from "../types/product";
import { fetchProducts } from "../api/products";
import { useCart } from "../context/CartContext";
import { useScrollReveal } from "../hooks/useScrollReveal";
import "./Cardapio.css";

const categories = ["Todos", "Bolos no pote", "Mini pudins"];

export default function Cardapio() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] = useState("Todos");
  const [isFiltering, setIsFiltering] = useState(false);
  const [displayFilter, setDisplayFilter] = useState("Todos");

  const {
    cartItems,
    cartOpen,
    setCartOpen,
    addToCart,
    updateQuantity,
    removeItem,
  } = useCart();

  const headingRef = useScrollReveal<HTMLDivElement>(0.15);
  const bolosRef = useScrollReveal<HTMLElement>(0.1);
  const pudinsRef = useScrollReveal<HTMLElement>(0.1);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleFilterChange = (cat: string) => {
    if (cat === activeFilter) return;
    setActiveFilter(cat);
    setIsFiltering(true);

    // Fade out → troca conteúdo → fade in
    setTimeout(() => {
      setDisplayFilter(cat);
      requestAnimationFrame(() => {
        setIsFiltering(false);
      });
    }, 250);
  };

  const filteredProducts =
    displayFilter === "Todos"
      ? products
      : products.filter((p) => {
          if (displayFilter === "Bolos no pote")
            return p.category === "Bolo no Pote";
          if (displayFilter === "Mini pudins")
            return p.category === "Mini Pudim";
          return true;
        });

  const groupedProducts = {
    "Bolo no Pote": filteredProducts.filter(
      (p) => p.category === "Bolo no Pote",
    ),
    "Mini Pudim": filteredProducts.filter((p) => p.category === "Mini Pudim"),
  };

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
            {categories.map((cat) => (
              <button
                key={cat}
                role="tab"
                aria-selected={activeFilter === cat}
                className={`filter-tab ${activeFilter === cat ? "active" : ""}`}
                onClick={() => handleFilterChange(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="cardapio-subtitle">Carregando cardápio…</p>}
        {error && <p className="cardapio-subtitle">{error}</p>}

        <div
          className={`products-area ${isFiltering ? "products-area--out" : "products-area--in"}`}
        >
          {groupedProducts["Bolo no Pote"].length > 0 && (
            <section
              className="category-group scroll-reveal revealed"
              aria-label="Bolos no pote"
              ref={bolosRef}
            >
              <h2 className="category-title">Bolos no pote</h2>
              <div className="products-grid">
                {groupedProducts["Bolo no Pote"].map((product, index) => (
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
          )}

          {groupedProducts["Mini Pudim"].length > 0 && (
            <section
              className="category-group scroll-reveal revealed"
              aria-label="Mini pudins"
              ref={pudinsRef}
            >
              <h2 className="category-title">Mini pudins</h2>
              <div className="products-grid">
                {groupedProducts["Mini Pudim"].map((product, index) => (
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
          )}
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
