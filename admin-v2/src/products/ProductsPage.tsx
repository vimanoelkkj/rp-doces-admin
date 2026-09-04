import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import {
  deleteProduct,
  listCategories,
  listProducts,
  ProductApiError,
  restoreProduct
} from "./product.api";
import { availableStock } from "./productDisplay";
import type { Product, ProductId } from "./product.types";
import { CategoryManager } from "./CategoryManager";
import { ProductCard } from "./ProductCard";
import { ProductDialog } from "./ProductDialog";
import styles from "./ProductsPage.module.css";

type Filter = "todos" | "ativos" | "esgotados" | "arquivados";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

let productsCache: Product[] | null = null;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function ProductsPage({ session, onNavigate }: Props) {
  const [products, setProducts] = useState<Product[]>(() => productsCache ?? []);
  const [loading, setLoading] = useState(() => productsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null | undefined>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [menu, setMenu] = useState<ProductId | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  const reload = useCallback(async () => {
    const foreground = productsCache === null;
    if (foreground) setLoading(true);
    setError(null);

    try {
      const next = await listProducts();
      productsCache = next;
      setProducts(next);
    } catch (err) {
      setError(
        err instanceof ProductApiError ? err.message : "Não foi possível carregar os produtos."
      );
    } finally {
      if (foreground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(
    () =>
      products.filter(product => {
        const searchable = `${product.nome} ${product.descricao} ${product.categoria_nome || product.categoria}`;
        const matches =
          !query || searchable.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));

        if (!matches) return false;
        if (filter === "ativos") return product.ativo;
        if (filter === "arquivados") return !product.ativo;
        if (filter === "esgotados") return product.ativo && availableStock(product) <= 0;
        return true;
      }),
    [products, query, filter]
  );

  const activeCount = products.filter(product => product.ativo).length;
  const soldOutCount = products.filter(
    product => product.ativo && availableStock(product) <= 0
  ).length;

  async function archive(id: ProductId) {
    setMenu(null);

    try {
      await deleteProduct(id);
      await reload();
    } catch (err) {
      setError(
        err instanceof ProductApiError ? err.message : "Não foi possível arquivar o produto."
      );
    }
  }

  async function permanentlyDelete(id: ProductId) {
    setMenu(null);
    setError(null);

    try {
      await deleteProduct(id, true);
      await reload();
    } catch (err) {
      setError(
        err instanceof ProductApiError
          ? err.message
          : "Não foi possível excluir o produto permanentemente."
      );
    }
  }

  async function restore(product: Product) {
    setMenu(null);

    try {
      const categories = await listCategories();
      const categoryIsActive = categories.some(category => category.id === product.categoria);

      if (!categoryIsActive) {
        setEditing(product);
        return;
      }

      await restoreProduct(product);
      await reload();
    } catch (err) {
      setError(
        err instanceof ProductApiError ? err.message : "Não foi possível restaurar o produto."
      );
    }
  }

  return (
    <>
      <AdminShell
        session={session}
        activePage="produtos"
        title="Produtos"
        subtitle="Catálogo, categorias, estoque e promoções"
        onNavigate={onNavigate}
      >
        <section className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <label className={styles.search}>
              <SearchIcon />
              <input
                type="search"
                placeholder="Buscar produto"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </label>

            <div className={styles.filters}>
              {(["todos", "ativos", "esgotados", "arquivados"] as Filter[]).map(value => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? styles.active : ""}
                  onClick={() => setFilter(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.toolbarActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setManagingCategories(true)}
            >
              Gerenciar categorias
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setEditing(undefined)}
            >
              + Novo produto
            </button>
          </div>
        </section>

        <p className={styles.summary}>
          {loading
            ? "Carregando catálogo…"
            : `${products.length} produtos · ${activeCount} ativos · ${soldOutCount} esgotados`}
        </p>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
            <button onClick={() => void reload()}>Tentar novamente</button>
          </div>
        ) : null}

        <section className={styles.grid}>
          {visible.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              menuOpen={menu === product.id}
              onToggleMenu={() => setMenu(current => (current === product.id ? null : product.id))}
              onEdit={() => {
                setMenu(null);
                setEditing(product);
              }}
              onArchive={() => void archive(product.id)}
              onRestore={() => void restore(product)}
              onDelete={() => void permanentlyDelete(product.id)}
            />
          ))}
        </section>

        {!loading && !error && visible.length === 0 ? (
          <p className={styles.empty}>Nenhum produto encontrado.</p>
        ) : null}
      </AdminShell>

      {managingCategories ? (
        <CategoryManager onClose={() => setManagingCategories(false)} />
      ) : null}

      {editing !== null ? (
        <ProductDialog
          product={editing ?? null}
          onClose={() => setEditing(null)}
          onImageChanged={() => void reload()}
          onProductPersisted={() => void reload()}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      ) : null}
    </>
  );
}
