// Peças visuais compartilhadas entre ProductCard e ProductDetailsModal, para
// o card e o detalhe nunca divergirem nas regras de preço/promoção e de
// estoque. Estilos em ProductCard.css.
import { Product } from "../types/product";
import { getStockBadgeState } from "../context/cartReconciliation";

export const formatBRL = (valor: number) => `R$ ${valor.toFixed(2).replace(".", ",")}`;

export function PromoBadge({ product }: { product: Product }) {
  // HUMAN-12: selo só aparece com promoção vigente (originalPrice definido).
  return product.originalPrice != null ? (
    <span className="product-promo-badge">Promoção</span>
  ) : null;
}

export function StockBadge({ restante }: { restante: number }) {
  const stockBadge = getStockBadgeState(restante);
  if (stockBadge === "esgotado") {
    return <span className="product-esgotado-badge">Esgotado</span>;
  }
  if (stockBadge === "ultima_unidade") {
    return (
      <span className="product-low-stock-badge product-low-stock-badge--last">
        Última unidade
      </span>
    );
  }
  if (stockBadge === "poucas_unidades") {
    return <span className="product-low-stock-badge">Poucas unidades</span>;
  }
  return null;
}

export function ProductPrices({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <span className={`product-prices ${className}`.trim()}>
      {product.originalPrice != null && (
        <span className="product-price-original">{formatBRL(product.originalPrice)}</span>
      )}
      <span className="product-price">{formatBRL(product.price)}</span>
    </span>
  );
}
