import { ReactNode, useEffect, useRef, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import styles from "./AdminShell.module.css";

export type AdminV2Page = "dashboard" | "produtos";

type Props = {
  session: AuthSession;
  activePage: AdminV2Page;
  title: string;
  subtitle: string;
  onNavigate: (page: AdminV2Page) => void;
  children: ReactNode;
};

type IconName =
  | "dashboard"
  | "products"
  | "orders"
  | "users"
  | "store"
  | "logout"
  | "collapse"
  | "external"
  | "bell";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></>,
    orders: <><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M4 20c0-3 2.2-5 5-5s5 2 5 5M17 7v6M14 10h6"/></>,
    store: <><path d="M4 9h16l-2-5H6L4 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
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

export function AdminShell({ session, activePage, title, subtitle, onNavigate, children }: Props) {
  const { user, logout, loggingOut, logoutError } = session;
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
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

  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "produtos", label: "Produtos", icon: "products" },
    { key: "pedidos", label: "Pedidos", icon: "orders" },
    { key: "admins", label: "Administradores", icon: "users" },
    { key: "loja", label: "Loja", icon: "store" }
  ] as const;

  function navigate(key: (typeof navItems)[number]["key"]) {
    if (key === "dashboard" || key === "produtos") {
      if (key !== activePage) onNavigate(key);
      return;
    }
    window.location.assign(`/admin/#${key}`);
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
          {navItems.map(item => {
            const active = item.key === activePage;
            return (
              <button
                key={item.key}
                type="button"
                className={`${styles.navItem} ${active ? styles.navActive : ""}`}
                aria-current={active ? "page" : undefined}
                title={active ? undefined : item.key === "dashboard" || item.key === "produtos" ? `Abrir ${item.label} no Admin V2` : `Abrir ${item.label} no Admin atual`}
                onClick={() => navigate(item.key)}
              >
                <span className={styles.navIcon}><Icon name={item.icon} /></span>
                <span className={styles.navLabel}>{item.label}</span>
              </button>
            );
          })}
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
            <h1>{title}<span className={styles.v2Badge}>V2</span></h1>
            <p>{subtitle}</p>
          </div>

          <div className={styles.topbarActions}>
            <a className={styles.iconButton} href="/" target="_blank" rel="noopener noreferrer" title="Abrir site público" aria-label="Abrir site público">
              <Icon name="external" />
            </a>
            <button className={styles.iconButton} type="button" title="Notificações permanecem no Admin atual durante a migração" aria-label="Notificações" disabled>
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
                {user.avatar_url ? <img className={styles.avatar} src={user.avatar_url} alt="" /> : <span className={styles.avatarFallback} aria-hidden="true">{initials(user.nome)}</span>}
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
                    <button className={styles.profileMenuLogout} type="button" role="menuitem" onClick={() => void logout()} disabled={loggingOut}>
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
          {logoutError ? <div className={styles.logoutError} role="alert">{logoutError}</div> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
