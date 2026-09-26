import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProductCard.css";
import "./ProductDetailsModal.css";
import { Product } from "../types/product";
import { remainingAvailability } from "../context/cartReconciliation";
import { ProductPrices, PromoBadge, StockBadge } from "./productDisplay";

interface ProductDetailsModalProps {
  product: Product;
  quantityInCart?: number;
  onClose: () => void;
  /** Adiciona `quantity` unidades; o limite final continua no CartContext. */
  onAddToCart: (quantity: number) => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ProductDetailsModal({
  product,
  quantityInCart = 0,
  onClose,
  onAddToCart,
}: ProductDetailsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selecionada, setSelecionada] = useState(1);
  const [adicionado, setAdicionado] = useState(false);

  // Mesma regra do card: disponibilidade menos o que já está na sacola.
  const restante = remainingAvailability(product.disponibilidade, quantityInCart);
  const esgotado = restante <= 0;
  // A seleção nunca passa do restante, inclusive depois de adicionar.
  const quantidade = esgotado ? 0 : Math.min(Math.max(1, selecionada), restante);

  // Foco inicial no fechar; ao sair, devolve o foco a quem abriu.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => anterior?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focaveis = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!adicionado) return;
    const timer = setTimeout(() => setAdicionado(false), 1500);
    return () => clearTimeout(timer);
  }, [adicionado]);

  const adicionar = () => {
    if (esgotado || quantidade < 1) return;
    onAddToCart(quantidade);
    setSelecionada(1);
    setAdicionado(true);
  };

  return createPortal(
    <div
      className="pdm-backdrop"
      onMouseDown={(e) => {
        // Só o próprio backdrop fecha; cliques dentro do conteúdo não.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="pdm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          type="button"
          className="pdm-close"
          onClick={onClose}
          aria-label="Fechar detalhes"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="pdm-media">
          {product.image ? (
            <img src={product.image} alt={product.name} className="pdm-image" />
          ) : (
            <div className="pdm-image pdm-image--vazia" aria-hidden="true" />
          )}
        </div>

        <div className="pdm-body">
          <div className="pdm-scroll">
            <div className="product-meta-row">
              <span className="product-category">{product.category}</span>
              <PromoBadge product={product} />
              <StockBadge restante={restante} />
            </div>
            <h2 id={titleId} className="pdm-title">{product.name}</h2>

            {product.description && (
              <p className="pdm-description">{product.description}</p>
            )}

            {product.weightText && (
              <section className="pdm-section">
                <h3 className="pdm-section-title">Peso / porção</h3>
                <p className="pdm-section-text">{product.weightText}</p>
              </section>
            )}
            {product.ingredients && (
              <section className="pdm-section">
                <h3 className="pdm-section-title">Ingredientes</h3>
                <p className="pdm-section-text">{product.ingredients}</p>
              </section>
            )}
            {product.allergens && (
              <section className="pdm-section">
                <h3 className="pdm-section-title">Alérgenos</h3>
                <p className="pdm-section-text">{product.allergens}</p>
              </section>
            )}
          </div>

          <div className="pdm-footer">
            <div className="pdm-price-row">
              <ProductPrices product={product} />
              <span className={`pdm-availability${esgotado ? " pdm-availability--esgotado" : ""}`}>
                {esgotado ? "Esgotado" : "Disponível"}
              </span>
            </div>
            <div className="pdm-actions">
              <div className="pdm-stepper" role="group" aria-label="Quantidade">
                <button
                  type="button"
                  className="pdm-stepper-btn"
                  onClick={() => setSelecionada(quantidade - 1)}
                  disabled={esgotado || quantidade <= 1}
                  aria-label="Diminuir quantidade"
                >
                  −
                </button>
                <span className="pdm-stepper-value" aria-live="polite">{quantidade}</span>
                <button
                  type="button"
                  className="pdm-stepper-btn"
                  onClick={() => setSelecionada(quantidade + 1)}
                  disabled={esgotado || quantidade >= restante}
                  aria-label="Aumentar quantidade"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={`pdm-add${adicionado ? " pdm-add--added" : ""}`}
                onClick={adicionar}
                disabled={esgotado}
              >
                {esgotado ? "Esgotado" : adicionado ? "Adicionado ✓" : "Adicionar à sacola"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
