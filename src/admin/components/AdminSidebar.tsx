import { NavLink } from "react-router-dom";
import { useAdminTheme } from "../theme/AdminThemeContext";
import { useAdminAuth } from "../auth/AdminAuthContext";
import { useNotificacoes } from "../notificacoes/NotificacoesContext";
import {
  IconDashboard,
  IconProdutosCake,
  IconBag,
  IconUsers,
  IconReceipt,
  IconStore,
  IconBell,
  IconMoon,
  IconSun
} from "../../components/icons/AdminNavigationIcons";
import "./AdminSidebar.css";

/* ── SVG icons — exported directly from Figma ── */
const IconCakeLogo = () => (
  <svg
    aria-hidden="true"
    className="sidebar-cake"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
  >
    <path
      d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
      stroke="#634738"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle className="flame flame-1" cx="5.833" cy="3.334" r="1.2" fill="#d38b80" />
    <circle className="flame flame-2" cx="10" cy="3.334" r="1.2" fill="#d38b80" />
    <circle className="flame flame-3" cx="14.167" cy="3.334" r="1.2" fill="#d38b80" />
  </svg>
);

/* ── Nav config ── */
interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  animClass?: string;
}

const mainNav: NavItem[] = [
  {
    to: "/admin",
    label: "Dashboard",
    icon: <IconDashboard />,
    animClass: "sidebar-anim-dashboard"
  },
  {
    to: "/admin/produtos",
    label: "Produtos",
    icon: <IconProdutosCake />,
    animClass: "sidebar-anim-produtos"
  },
  {
    to: "/admin/pedidos",
    label: "Pedidos",
    icon: <IconBag />,
    animClass: "sidebar-anim-pedidos"
  },
  {
    to: "/admin/administradores",
    label: "Administradores",
    icon: <IconUsers />,
    animClass: "sidebar-anim-admins"
  },
  {
    to: "/admin/despesas",
    label: "Despesas",
    icon: <IconReceipt />,
    animClass: "sidebar-anim-despesas"
  },
  {
    to: "/admin/loja",
    label: "Loja",
    icon: <IconStore />,
    animClass: "sidebar-anim-loja"
  }
];

const systemNav: NavItem[] = [
  {
    to: "/admin/notificacoes",
    label: "Notificações",
    icon: <IconBell />,
    animClass: "sidebar-anim-notif"
  }
];

/* ── Component ── */
const PAPEL_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin"
};

export default function AdminSidebar() {
  const { user, logout } = useAdminAuth();
  const userName = user.nome;
  const userRole = PAPEL_LABEL[user.papel] ?? user.papel;
  const initials = userName
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const { theme, toggleTheme } = useAdminTheme();
  // HUMAN-14: contagem REAL de notificações não lidas deste operador,
  // derivada de fatos do domínio.
  const { naoLidas } = useNotificacoes();

  const renderNavItem = (item: NavItem) => {
    const badge = item.to === "/admin/notificacoes" ? naoLidas : undefined;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/admin"}
        className={({ isActive }) =>
          `sidebar-nav-item ${item.animClass || ""}${isActive ? " sidebar-nav-item--active" : ""}`
        }
      >
        <span className="sidebar-nav-icon">{item.icon}</span>
        <span className="sidebar-nav-label">{item.label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="sidebar-nav-badge">{badge > 9 ? "9+" : badge}</span>
        )}
      </NavLink>
    );
  };

  return (
    <>
      <header className="admin-mobile-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-circle">
            <IconCakeLogo />
          </div>
          <span className="sidebar-logo-text">R&amp;P Doces</span>
        </div>
      </header>

      <aside id="admin-navigation" className="admin-sidebar" aria-label="Navegação administrativa">
        <div className="sidebar-top">
          {/* Logo */}
          <div className="sidebar-logo">
            <div className="sidebar-logo-circle">
              <IconCakeLogo />
            </div>
            <span className="sidebar-logo-text">R&P Doces</span>
          </div>

          {/* Main nav */}
          <nav className="sidebar-main-nav">{mainNav.map(renderNavItem)}</nav>
        </div>

        <div className="sidebar-bottom">
          {/* System links */}
          <nav className="sidebar-system-nav">
            {systemNav.map(renderNavItem)}
            <button
              type="button"
              className="sidebar-nav-item sidebar-anim-tema"
              onClick={toggleTheme}
            >
              <span className="sidebar-nav-icon">
                {theme === "light" ? <IconMoon /> : <IconSun />}
              </span>
              <span className="sidebar-nav-label">
                {theme === "light" ? "Tema Escuro" : "Tema Claro"}
              </span>
            </button>
          </nav>

          <div className="sidebar-divider" />

          {/* User profile */}
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              <span>{initials}</span>
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{userName}</span>
              <span className="sidebar-user-role">{userRole}</span>
            </div>
            <button
              type="button"
              className="sidebar-logout-btn"
              aria-label="Sair"
              title="Sair"
              onClick={logout}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
