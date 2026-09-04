import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  availableStock,
  currentPriceCents,
  promotionLabel,
  promotionState
} from "./productDisplay";
import type { Product } from "./product.types";
import styles from "./ProductPreviewDialog.module.css";

interface Props {
  product: Product;
  onClose: () => void;
}

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function ProductPreviewDialog({ product, onClose }: Props) {
  const available = availableStock(product);
  const promoState = promotionState(product);
  const promo = promotionLabel(promoState);
  const currentPrice = currentPriceCents(product);
  const hasActivePromo = promoState === "active" && currentPrice !== product.preco_centavos;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [onClose]);

  const dialog = (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-preview-title"
        onClick={event => event.stopPropagation()}
      >
        <button className={styles.close} type="button" aria-label="Fechar" onClick={onClose}>
          ×
        </button>

        <div className={styles.media}>
          {product.image_key ? (
            <img src={`/api/images/${encodeURIComponent(product.image_key)}`} alt={product.nome} />
          ) : (
            <span aria-hidden="true">{product.emoji || "🍰"}</span>
          )}
          <div className={styles.flags}>
            {product.destaque ? <b>Destaque</b> : null}
            {!product.ativo ? <b>Arquivado</b> : null}
            {product.ativo && !product.disponivel ? <b>Indisponível</b> : null}
          </div>
          {promo ? <span className={styles.promo}>{promo}</span> : null}
        </div>

        <div className={styles.body}>
          <div className={styles.category}>
            {product.categoria_emoji} {product.categoria_nome || product.categoria}
          </div>
          <h2 id="product-preview-title">{product.nome}</h2>

          <p className={styles.description}>
            {product.descricao || "Sem descrição cadastrada."}
          </p>

          <div className={styles.meta}>
            <div>
              <small>Preço</small>
              <div className={styles.price}>
                {hasActivePromo ? <s>{money(product.preco_centavos)}</s> : null}
                <strong>{money(currentPrice)}</strong>
              </div>
            </div>
            <div>
              <small>Estoque</small>
              <strong className={available <= 3 ? styles.lowStock : styles.stock}>
                {available > 0
                  ? `${available} ${available === 1 ? "disponível" : "disponíveis"}`
                  : "Esgotado"}
              </strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
