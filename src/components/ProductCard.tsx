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

  const handleAdd = () => {
    if (justAdded) return;
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
        <span className="product-category">{product.category}</span>
        <h3 className="product-name">{product.name}</h3>
        {product.description && (
          <p className="product-description">{product.description}</p>
        )}
        <div className="product-footer">
          <span className="product-price">
            R$ {product.price.toFixed(2).replace(".", ",")}
          </span>
          <button
            className={`add-button${justAdded ? " add-button--added" : ""}`}
            aria-label={`Adicionar ${product.name}`}
            onClick={handleAdd}
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
