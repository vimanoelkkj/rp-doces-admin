import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { deleteProduct, listProducts, ProductApiError, restoreProduct } from "./product.api";
import { availableStock } from "./productDisplay";
import type { Product, ProductId } from "./product.types";
import { ProductCard } from "./ProductCard";
import { ProductDialog } from "./ProductDialog";
import styles from "./ProductsPage.module.css";

type Filter = "todos" | "ativos" | "esgotados" | "arquivados";

type Props = {
  session: AuthSession;
};

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? "")
      .join("") || "RP"
  );
}

export function ProductsPage({ session }: Props) {
  const { user, logout, loggingOut, logoutError } = session;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null | undefined>(null);
  const [menu, setMenu] = useState<ProductId | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setProducts(await listProducts());
    } catch (err) {
      setError(
        err instanceof ProductApiError ? err.message : "Não foi possível carregar os produtos."
      );
    } finally {
      setLoading(false);
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

  async function restore(product: Product) {
    setMenu(null);

    try {
      await restoreProduct(product);
      await reload();
    } catch (err) {
      setError(
        err instanceof ProductApiError ? err.message : "Não foi possível restaurar o produto."
      );
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div className={styles.heading}>
          <small>R&amp;P Doces · Admin V2</small>
          <h1>Produtos</h1>
          <p>Primeiro módulo da nova base React + TypeScript.</p>
        </div>

        <div className={styles.topActions}>
          <div className={styles.account} aria-label={`Usuário logado: ${user.nome}`}>
            {user.avatar_url ? (
              <img className={styles.avatar} src={user.avatar_url} alt="" />
            ) : (
              <span className={styles.avatarFallback} aria-hidden="true">
                {initials(user.nome)}
              </span>
            )}
            <span className={styles.accountText}>
              <strong>{user.nome}</strong>
              <small>
                @{user.username} · {user.papel}
              </small>
            </span>
          </div>

          <button
            className={styles.logoutButton}
            type="button"
            onClick={() => void logout()}
            disabled={loggingOut}
          >
            {loggingOut ? "Saindo…" : "Sair"}
          </button>

          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => setEditing(undefined)}
          >
            + Novo produto
          </button>
        </div>
      </header>

      {logoutError ? (
        <div className={styles.error} role="alert">
          {logoutError}
        </div>
      ) : null}

      <section className={styles.toolbar}>
        <input
          type="search"
          placeholder="Buscar produto"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div>
          {(["todos", "ativos", "esgotados", "arquivados"] as Filter[]).map(value => (
            <button
              key={value}
              className={filter === value ? styles.active : ""}
              onClick={() => setFilter(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
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
          />
        ))}
      </section>

      {!loading && !error && visible.length === 0 ? (
        <p className={styles.empty}>Nenhum produto encontrado.</p>
      ) : null}

      {editing !== null ? (
        <ProductDialog
          product={editing ?? null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      ) : null}
    </main>
  );
}
