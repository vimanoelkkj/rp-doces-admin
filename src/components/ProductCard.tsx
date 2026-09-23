import { useState } from "react";
import "./ProductCard.css";
import { Product } from "../types/product";

interface ProductCardProps {
  product: Product;
  onAddToCart?: () => void;
}

export default function ProductCard({
  product,
  onAddToCart,
}: ProductCardProps) {
  const [justAdded, setJustAdded] = useState(false);
  const esgotado =
    product.disponibilidade !== undefined && product.disponibilidade <= 0;

  const handleAdd = () => {
    if (justAdded || esgotado) return;
    onAddToCart?.();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <article className="product-card">
      <div className="product-image-wrapper">
        <img
          src={product.image}
          alt={product.name}
          className="product-image"
          loading="lazy"
        />
      </div>
      <div className="product-info">
        <div className="product-meta-row">
          <span className="product-category">{product.category}</span>
          {/* HUMAN-12: selo só aparece com promoção vigente. Estrutura do
              card preservada — é um acréscimo ao lado da categoria. */}
          {product.originalPrice != null && (
            <span className="product-promo-badge">Promoção</span>
          )}
          {esgotado && (
            <span className="product-esgotado-badge">Esgotado</span>
          )}
        </div>
        <h3 className="product-name">{product.name}</h3>
        {product.description && (
          <p className="product-description">{product.description}</p>
        )}
        <div className="product-footer">
          <span className="product-prices">
            {product.originalPrice != null && (
              <span className="product-price-original">
                R$ {product.originalPrice.toFixed(2).replace(".", ",")}
              </span>
            )}
            <span className="product-price">
              R$ {product.price.toFixed(2).replace(".", ",")}
            </span>
          </span>
          <button
            className={`add-button${justAdded ? " add-button--added" : ""}${esgotado ? " add-button--esgotado" : ""}`}
            aria-label={esgotado ? `${product.name} esgotado` : `Adicionar ${product.name}`}
            onClick={handleAdd}
            disabled={esgotado}
          >
            {justAdded ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13L9 17L19 7"
                  stroke="#fff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              "+"
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
