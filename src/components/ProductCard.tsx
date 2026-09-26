import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import "./ProductCard.css";
import { Product } from "../types/product";
import { remainingAvailability } from "../context/cartReconciliation";
import { ProductPrices, PromoBadge, StockBadge } from "./productDisplay";

interface ProductCardProps {
  product: Product;
  quantityInCart?: number;
  onAddToCart?: () => void;
  /** Abre o detalhe do produto. Acionado só pela foto e pelo nome. */
  onOpenDetails?: () => void;
}

export default function ProductCard({
  product,
  quantityInCart = 0,
  onAddToCart,
  onOpenDetails,
}: ProductCardProps) {
  const [justAdded, setJustAdded] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const restante = remainingAvailability(product.disponibilidade, quantityInCart);
  const esgotado = restante <= 0;

  const handleAdd = () => {
    if (justAdded || esgotado) return;
    onAddToCart?.();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <motion.article
      className="product-card"
      whileHover={shouldReduceMotion ? undefined : { y: -4 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <div className="product-image-wrapper">
        {onOpenDetails ? (
          // Só a foto e o nome abrem o detalhe; o card inteiro não é clicável
          // e o botão + fica fora destes botões (sem botões aninhados).
          <button
            type="button"
            className="product-image-button"
            onClick={onOpenDetails}
            aria-label={`Ver detalhes de ${product.name}`}
          >
            <img
              src={product.image}
              alt=""
              className="product-image"
              loading="lazy"
            />
            <span className="product-image-hint" aria-hidden="true">Ver detalhes</span>
          </button>
        ) : (
          <img
            src={product.image}
            alt={product.name}
            className="product-image"
            loading="lazy"
          />
        )}
      </div>
      <div className="product-info">
        <div className="product-meta-row">
          <span className="product-category">{product.category}</span>
          {/* HUMAN-12: selo só aparece com promoção vigente. Estrutura do
              card preservada — é um acréscimo ao lado da categoria. */}
          <PromoBadge product={product} />
          <StockBadge restante={restante} />
        </div>
        <h3 className="product-name">
          {onOpenDetails ? (
            <button type="button" className="product-name-button" onClick={onOpenDetails}>
              {product.name}
            </button>
          ) : (
            product.name
          )}
        </h3>
        {product.description && (
          <p className="product-description">{product.description}</p>
        )}
        <div className="product-footer">
          <ProductPrices product={product} />
          <motion.button
            className={`add-button${justAdded ? " add-button--added" : ""}${esgotado ? " add-button--esgotado" : ""}`}
            aria-label={esgotado ? `${product.name} esgotado` : `Adicionar ${product.name}`}
            onClick={(e) => {
              e.currentTarget.blur();
              handleAdd();
            }}
            disabled={esgotado || justAdded}
            whileHover={shouldReduceMotion || esgotado || justAdded ? undefined : { scale: 1.12 }}
            whileTap={shouldReduceMotion || esgotado || justAdded ? undefined : { scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {justAdded ? (
                <motion.span
                  key="check"
                  initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 13L9 17L19 7"
                      stroke="#fff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </motion.span>
              ) : (
                <motion.span
                  key="plus"
                  initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  +
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}
