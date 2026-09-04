import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import type { AuthSession } from "../auth/AuthGate";
import styles from "./AdminShell.module.css";

export type AdminV2Page = "dashboard" | "produtos" | "pedidos" | "admins" | "loja";

type Props = {
  session: AuthSession;
  activePage: AdminV2Page;
  title: string;
  subtitle: string;
  onNavigate: (page: AdminV2Page) => void;
  children: ReactNode;
  hideHeader?: boolean;
  fullWidth?: boolean;
};

type IconName =
  | "dashboard"
  | "products"
  | "orders"
  | "users"
  | "store"
  | "logout"
  | "bell"
  | "sun"
  | "moon";

const AdminShellNestingContext = createContext(false);

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></>,
    orders: <><rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V4h6v2"/><path d="M9 11h6"/><path d="M9 15h4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M4 20c0-3 2.2-5 5-5s5 2 5 5M17 7v6M14 10h6"/></>,
    store: <><path d="M4 9h16l-2-5H6L4 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    logout: <><path d="M10 5H5v14h5M13 8l4 4-4 4M17 12H9"/></>,
    bell: <><path d="M6 17h12l-1.4-2V10a4.6 4.6 0 0 0-9.2 0v5L6 17Z"/><path d="M10 20h4"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>
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

function readTheme(): "light" | "dark" {
  const stored = window.localStorage.getItem("rp-admin-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readNotificationsEnabled(): boolean {
  if (!("Notification" in window)) return false;
  const stored = window.localStorage.getItem("rp-admin-notifications-enabled");
  if (stored === "0") return false;
  return Notification.permission === "granted";
}

export function AdminShell(props: Props) {
  const nested = useContext(AdminShellNestingContext);
  if (nested) return <>{props.children}</>;
  return <AdminShellRoot {...props} />;
}

function AdminShellRoot({
  session,
  activePage,
  title,
  subtitle,
  onNavigate,
  children,
  hideHeader = false,
  fullWidth = false
}: Props) {
  const { user, logout, loggingOut, logoutError } = session;
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(readNotificationsEnabled);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mobileProfileRef = useRef<HTMLDivElement>(null);
  const mobileNotificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const themeColor = theme === "dark" ? "#1b1614" : "#fbf8f4";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor = themeColor;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
    window.localStorage.setItem("rp-admin-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideProfile = profileRef.current?.contains(target) || mobileProfileRef.current?.contains(target);
      const insideNotification = notificationRef.current?.contains(target) || mobileNotificationRef.current?.contains(target);
      if (profileOpen && !insideProfile) setProfileOpen(false);
      if (notificationOpen && !insideNotification) setNotificationOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
      setNotificationOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationOpen, profileOpen]);

  useEffect(() => {
    setProfileOpen(false);
    setNotificationOpen(false);
  }, [activePage]);

  const navItems = [
    { key: "dashboard", label: "Dashboard", mobileLabel: "Dashboard", icon: "dashboard" },
    { key: "produtos", label: "Produtos", mobileLabel: "Produtos", icon: "products" },
    { key: "pedidos", label: "Pedidos", mobileLabel: "Pedidos", icon: "orders" },
    { key: "admins", label: "Administradores", mobileLabel: "Admins", icon: "users" },
    { key: "loja", label: "Loja", mobileLabel: "Loja", icon: "store" }
  ] as const;

  function navigate(key: (typeof navItems)[number]["key"]) {
    if (key !== activePage) onNavigate(key);
  }

  async function toggleNotifications() {
    if (!("Notification" in window)) return;

    if (notificationsEnabled) {
      window.localStorage.setItem("rp-admin-notifications-enabled", "0");
      setNotificationsEnabled(false);
      return;
    }

    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

    const enabled = permission === "granted";
    window.localStorage.setItem("rp-admin-notifications-enabled", enabled ? "1" : "0");
    setNotificationsEnabled(enabled);
  }

  const notificationMenu = notificationOpen ? (
    <div className={styles.notificationPopover} role="dialog" aria-label="Notificações">
      <h3>Notificações</h3>
      <p>Receba um aviso quando um novo pedido for pago.</p>
      <div className={`${styles.notificationStatus} ${notificationsEnabled ? "" : styles.notificationStatusOff}`}>
        <strong>{notificationsEnabled ? "Ativas neste navegador" : "Desativadas neste navegador"}</strong>
        <span>
          {notificationsEnabled
            ? "Você receberá avisos de novos pedidos pagos."
            : "Ative para permitir avisos neste navegador."}
        </span>
      </div>
      <button className={styles.notificationAction} type="button" onClick={() => void toggleNotifications()}>
        {notificationsEnabled ? "Desativar notificações" : "Ativar notificações"}
      </button>
    </div>
  ) : null;

  const profileMenu = profileOpen ? (
    <div className={styles.profileMenu} role="menu">
      <div className={styles.profileMenuIdentity}>
        <strong>{user.nome}</strong>
        <span>@{user.username} · {user.papel}</span>
        {user.email ? <small>{user.email}</small> : null}
      </div>
      <button
        className={styles.profileMenuTheme}
        type="button"
        role="menuitem"
        onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} />
        {theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
      </button>
      <button className={styles.profileMenuLogout} type="button" role="menuitem" onClick={() => void logout()} disabled={loggingOut}>
        <Icon name="logout" />
        {loggingOut ? "Saindo…" : "Sair da conta"}
      </button>
    </div>
  ) : null;

  const wide = activePage === "dashboard" || activePage === "produtos";
  const pageChildren = (
    <AdminShellNestingContext.Provider value={true}>
      {children}
    </AdminShellNestingContext.Provider>
  );

  const body = (
    <>
      {!hideHeader ? (
        <header className={styles.pageHeader}>
          <div className={styles.pageTitleBlock}>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </header>
      ) : null}

      {logoutError ? <div className={styles.logoutError} role="alert">{logoutError}</div> : null}
      {pageChildren}
    </>
  );

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand} aria-label="R&P Doces">
          <div className={styles.brandRp}>R&amp;P</div>
          <div className={styles.brandDoces}>DOCES</div>
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
                aria-label={item.label}
                onClick={() => navigate(item.key)}
              >
                <span className={styles.navIcon}><Icon name={item.icon} /></span>
                <span className={styles.navLabel} data-mobile-label={item.mobileLabel}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className={styles.navSpacer} />

        <div className={styles.notificationWrap} data-desktop-only-utility ref={notificationRef}>
          <button
            className={styles.utilityButton}
            type="button"
            aria-label="Notificações"
            aria-expanded={notificationOpen}
            onClick={() => {
              setProfileOpen(false);
              setNotificationOpen(open => !open);
            }}
          >
            <span className={styles.navIcon}><Icon name="bell" /></span>
            <span className={styles.navLabel}>Notificações</span>
            {notificationsEnabled ? <span className={styles.notificationDot} /> : null}
          </button>
          {notificationMenu}
        </div>

        <button
          className={`${styles.utilityButton} ${styles.themeButton}`}
          type="button"
          aria-label="Alternar tema claro/escuro"
          onClick={() => setTheme(current => current === "dark" ? "light" : "dark")}
        >
          <span className={styles.navIcon}><Icon name={theme === "dark" ? "moon" : "sun"} /></span>
          <span className={styles.navLabel}>Tema</span>
        </button>

        <div className={styles.profileWrap} data-desktop-only-utility ref={profileRef}>
          <button
            className={styles.profile}
            type="button"
            aria-label="Abrir menu da conta"
            aria-expanded={profileOpen}
            onClick={() => {
              setNotificationOpen(false);
              setProfileOpen(open => !open);
            }}
          >
            {user.avatar_url
              ? <img className={styles.avatarImage} src={user.avatar_url} alt="" />
              : <span className={styles.avatar}>{initials(user.nome)}</span>}
            <span className={styles.profileText}>
              <span className={styles.profileName}>{user.nome}</span>
              <span className={styles.profileRole}>{user.papel}</span>
            </span>
            <span className={styles.profileCaret}>⌄</span>
          </button>
          {profileMenu}
        </div>
      </aside>

      <main className={styles.content}>
        <header data-mobile-admin-header aria-label={`${title}: ${subtitle}`}>
          <div data-mobile-header-title>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          <div data-mobile-header-actions>
            <div data-mobile-header-notification ref={mobileNotificationRef}>
              <button
                data-mobile-header-button
                type="button"
                aria-label="Notificações"
                aria-expanded={notificationOpen}
                onClick={() => {
                  setProfileOpen(false);
                  setNotificationOpen(open => !open);
                }}
              >
                <span data-mobile-header-icon><Icon name="bell" /></span>
                {notificationsEnabled ? <span data-mobile-notification-dot /> : null}
              </button>
              {notificationMenu}
            </div>

            <div data-mobile-header-profile ref={mobileProfileRef}>
              <button
                data-mobile-profile-button
                type="button"
                aria-label="Abrir menu da conta"
                aria-expanded={profileOpen}
                onClick={() => {
                  setNotificationOpen(false);
                  setProfileOpen(open => !open);
                }}
              >
                {user.avatar_url
                  ? <img data-mobile-avatar-image src={user.avatar_url} alt="" />
                  : <span data-mobile-avatar>{initials(user.nome)}</span>}
              </button>
              {profileMenu}
            </div>
          </div>
        </header>

        <div
          className={`${styles.workspace} ${wide ? styles.workspaceWide : ""}`}
          style={fullWidth ? { maxWidth: "none", padding: 0 } : undefined}
        >
          {body}
        </div>
      </main>
    </div>
  );
}
