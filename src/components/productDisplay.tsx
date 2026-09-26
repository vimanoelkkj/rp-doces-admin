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

// Total em centavos para evitar erro de ponto flutuante (ex.: 15,90 × 3).
const totalBRL = (unitario: number, quantidade: number) =>
  formatBRL((Math.round(unitario * 100) * quantidade) / 100);

// `quantity` (padrão 1) multiplica o preço exibido, com a mesma regra de
// promoção: o normal riscado e o promocional viram totais juntos. Só
// exibição — o valor cobrado é sempre recalculado pelo backend.
export function ProductPrices({
  product,
  className = "",
  quantity = 1,
}: {
  product: Product;
  className?: string;
  quantity?: number;
}) {
  const q = Number.isInteger(quantity) && quantity > 1 ? quantity : 1;
  return (
    <span className={`product-prices ${className}`.trim()}>
      {product.originalPrice != null && (
        <span className="product-price-original">{totalBRL(product.originalPrice, q)}</span>
      )}
      <span className="product-price">{totalBRL(product.price, q)}</span>
      {q > 1 && (
        <span className="product-price-unit">{formatBRL(product.price)} cada</span>
      )}
    </span>
  );
}
