import type { Product } from "./product.types";
import styles from "./ProductCard.module.css";

interface Props {
  product: Product;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function ProductCard({ product, menuOpen, onToggleMenu, onEdit, onArchive }: Props) {
  const available = Math.max(0, product.estoque - product.estoque_reservado);
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        {product.image_key ? <img src={`/api/images/${encodeURIComponent(product.image_key)}`} alt="" /> : <span>{product.emoji || "🍰"}</span>}
        <div className={styles.flags}>{product.destaque && <b>Destaque</b>}{!product.ativo && <b>Arquivado</b>}</div>
      </div>
      <div className={styles.body}>
        <div className={styles.heading}>
          <div><small>{product.categoria_emoji} {product.categoria_nome || product.categoria}</small><h2>{product.nome}</h2></div>
          <div className={styles.menuWrap}>
            <button type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-label={`Ações de ${product.nome}`} onClick={onToggleMenu}>•••</button>
            {menuOpen && <div className={styles.menu}><button type="button" onClick={onEdit}>Editar</button><button type="button" onClick={onArchive}>Arquivar</button></div>}
          </div>
        </div>
        <p>{product.descricao || "Sem descrição cadastrada."}</p>
        <footer><strong>{money(product.preco_centavos)}</strong><span className={available <= 3 ? styles.lowStock : ""}>{available > 0 ? `${available} em estoque` : "Esgotado"}</span></footer>
      </div>
    </article>
  );
}
