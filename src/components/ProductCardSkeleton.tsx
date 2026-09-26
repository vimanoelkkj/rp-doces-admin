import "./ProductCard.css";
import "./ProductCardSkeleton.css";

// Card "fantasma" com a mesma estrutura e medidas do ProductCard (mesma
// proporção de foto, paddings e rodapé), para a troca pelos cards reais não
// deslocar o layout. Puramente visual: o anúncio de carregamento fica no
// contêiner que o renderiza.
export default function ProductCardSkeleton() {
  return (
    <div className="product-card product-card--skeleton" aria-hidden="true">
      <div className="product-image-wrapper skeleton-shimmer" />
      <div className="product-info">
        <span className="skeleton-line skeleton-shimmer skeleton-line--category" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--name" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--name-short" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--text" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--text" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--text" />
        <span className="skeleton-line skeleton-shimmer skeleton-line--text-short" />
        <div className="product-footer">
          <span className="skeleton-line skeleton-shimmer skeleton-line--price" />
          <span className="skeleton-dot skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}
