import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import {
  deleteProduct,
  listCategories,
  listProducts,
  ProductApiError,
  restoreProduct
} from "./product.api";
import { availableStock } from "./productDisplay";
import type { Product, ProductId } from "./product.types";
import { ProductCard } from "./ProductCard";
import { ProductDialog } from "./ProductDialog";
import styles from "./ProductsPage.module.css";

type Filter = "todos" | "ativos" | "esgotados" | "arquivados";

type Props = {
  session: AuthSession;
};

type IconName =
  | "dashboard"
  | "products"
  | "orders"
  | "users"
  | "store"
  | "search"
  | "logout"
  | "collapse"
  | "external"
  | "bell";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></>,
    orders: <><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M4 20c0-3 2.2-5 5-5s5 2 5 5M17 7v6M14 10h6"/></>,
    store: <><path d="M4 9h16l-2-5H6L4 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    logout: <><path d="M10 5H5v14h5M13 8l4 4-4 4M17 12H9"/></>,
    collapse: <><path d="m14 7-5 5 5 5"/></>,
    external: <><path d="M14 5h5v5M19 5l-8 8"/><path d="M19 13v6H5V5h6"/></>,
    bell: <><path d="M6 17h12l-1.4-2V10a4.6 4.6 0 0 0-9.2 0v5L6 17Z"/><path d="M10 20h4"/></>
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

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
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!profileOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

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

  const navItems: Array<{ label: string; icon: IconName; active?: boolean; legacyPage?: string }> = [
    { label: "Dashboard", icon: "dashboard", legacyPage: "dashboard" },
    { label: "Produtos", icon: "products", active: true },
    { label: "Pedidos", icon: "orders", legacyPage: "pedidos" },
    { label: "Administradores", icon: "users", legacyPage: "admins" },
    { label: "Loja", icon: "store", legacyPage: "loja" }
  ];

  function navigate(item: (typeof navItems)[number]) {
    if (item.active || !item.legacyPage) return;
    window.location.assign(`/admin/#${item.legacyPage}`);
  }

  return (
    <div className={`${styles.app} ${collapsed ? styles.collapsed : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>R&amp;P</span>
          <span className={styles.brandCopy}>
            <strong>R&amp;P <em>Doces</em></strong>
            <small>Painel administrativo</small>
          </span>
        </div>

        <nav className={styles.nav} aria-label="Navegação principal">
          {navItems.map(item => (
            <button
              key={item.label}
              type="button"
              className={`${styles.navItem} ${item.active ? styles.navActive : ""}`}
              aria-current={item.active ? "page" : undefined}
              title={item.active ? undefined : `Abrir ${item.label} no Admin atual`}
              onClick={() => navigate(item)}
            >
              <span className={styles.navIcon}><Icon name={item.icon} /></span>
              <span className={styles.navLabel}>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button className={styles.collapseButton} type="button" onClick={() => setCollapsed(value => !value)}>
            <span className={styles.navIcon}><Icon name="collapse" /></span>
            <span>Recolher</span>
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.pageTitle}>
            <h1>Produtos</h1>
            <p>Catálogo, categorias, estoque e promoções</p>
          </div>

          <div className={styles.topbarActions}>
            <a
              className={styles.iconButton}
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir site público"
              aria-label="Abrir site público"
            >
              <Icon name="external" />
            </a>

            <button
              className={styles.iconButton}
              type="button"
              title="Notificações permanecem no Admin atual durante a migração"
              aria-label="Notificações"
              disabled
            >
              <Icon name="bell" />
            </button>

            <div className={styles.profileWrap} ref={profileRef}>
              <button
                className={`${styles.profile} ${profileOpen ? styles.profileOpen : ""}`}
                type="button"
                aria-label="Abrir menu da conta"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen(open => !open)}
              >
                {user.avatar_url ? (
                  <img className={styles.avatar} src={user.avatar_url} alt="" />
                ) : (
                  <span className={styles.avatarFallback} aria-hidden="true">
                    {initials(user.nome)}
                  </span>
                )}
                <span className={styles.profileCopy}>
                  <strong>{user.nome}</strong>
                  <small>{user.papel}</small>
                </span>
                <span className={styles.profileChevron} aria-hidden="true" />
              </button>

              {profileOpen ? (
                <div className={styles.profileMenu} role="menu">
                  <div className={styles.profileMenuIdentity}>
                    <strong>{user.nome}</strong>
                    <span>@{user.username} · {user.papel}</span>
                    {user.email ? <small>{user.email}</small> : null}
                  </div>
                  <div className={styles.profileMenuActions}>
                    <button
                      className={styles.profileMenuLogout}
                      type="button"
                      role="menuitem"
                      onClick={() => void logout()}
                      disabled={loggingOut}
                    >
                      <Icon name="logout" />
                      {loggingOut ? "Saindo…" : "Sair da conta"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className={styles.content}>
          {logoutError ? (
            <div className={styles.error} role="alert">
              {logoutError}
            </div>
          ) : null}

          <section className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <label className={styles.search}>
                <Icon name="search" />
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
                disabled
                title="Gerenciamento de categorias será migrado em uma etapa própria"
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
              />
            ))}
          </section>

          {!loading && !error && visible.length === 0 ? (
            <p className={styles.empty}>Nenhum produto encontrado.</p>
          ) : null}
        </main>
      </div>

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
    </div>
  );
}
