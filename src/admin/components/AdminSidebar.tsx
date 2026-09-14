import { NavLink } from "react-router-dom";
import "./AdminSidebar.css";

/* ── SVG icons — exported directly from Figma ── */
const IconDashboard = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M7.33333 2H2.88889C2.39797 2 2 2.39797 2 2.88889V9.11111C2 9.60203 2.39797 10 2.88889 10H7.33333C7.82425 10 8.22222 9.60203 8.22222 9.11111V2.88889C8.22222 2.39797 7.82425 2 7.33333 2Z"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M17.1111 2H12.6667C12.1757 2 11.7778 2.39797 11.7778 2.88889V5.55556C11.7778 6.04648 12.1757 6.44444 12.6667 6.44444H17.1111C17.602 6.44444 18 6.04648 18 5.55556V2.88889C18 2.39797 17.602 2 17.1111 2Z"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M17.1111 10H12.6667C12.1757 10 11.7778 10.398 11.7778 10.8889V17.1111C11.7778 17.602 12.1757 18 12.6667 18H17.1111C17.602 18 18 17.602 18 17.1111V10.8889C18 10.398 17.602 10 17.1111 10Z"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.33333 13.5556H2.88889C2.39797 13.5556 2 13.9535 2 14.4444V17.1111C2 17.602 2.39797 18 2.88889 18H7.33333C7.82425 18 8.22222 17.602 8.22222 17.1111V14.4444C8.22222 13.9535 7.82425 13.5556 7.33333 13.5556Z"
      stroke="currentColor"
      strokeWidth="1.33333"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconCakeLogo = () => (
  <svg
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
    <circle
      className="flame flame-1"
      cx="5.833"
      cy="3.334"
      r="1.2"
      fill="#d38b80"
    />
    <circle
      className="flame flame-2"
      cx="10"
      cy="3.334"
      r="1.2"
      fill="#d38b80"
    />
    <circle
      className="flame flame-3"
      cx="14.167"
      cy="3.334"
      r="1.2"
      fill="#d38b80"
    />
  </svg>
);

const IconProdutosCake = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle
      cx="5.833"
      cy="4.5"
      r="1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <circle
      cx="10"
      cy="4.5"
      r="1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <circle
      cx="14.167"
      cy="4.5"
      r="1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
);

const IconBag = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M17.2008 5.2V16.4C17.2008 16.8243 17.0322 17.2313 16.7322 17.5314C16.4321 17.8314 16.0251 18 15.6008 18H4.40078C3.97643 18 3.56947 17.8314 3.26941 17.5314C2.96935 17.2313 2.80078 16.8243 2.80078 16.4V5.2L5.20078 2H14.8008L17.2008 5.2ZM2.80078 5.2H17.2008M13.2008 8.4C13.2008 9.24869 12.8636 10.0626 12.2635 10.6627C11.6634 11.2629 10.8495 11.6 10.0008 11.6C9.15209 11.6 8.33816 11.2629 7.73804 10.6627C7.13792 10.0626 6.80078 9.24869 6.80078 8.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconUsers = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M13.2 17.2V15.6C13.2 14.7514 12.8629 13.9374 12.2627 13.3373C11.6626 12.7372 10.8487 12.4 10 12.4H5.2C4.35131 12.4 3.53737 12.7372 2.93726 13.3373C2.33714 13.9374 2 14.7514 2 15.6V17.2M18 17.2V15.6C17.9995 14.891 17.7635 14.2023 17.3291 13.6419C16.8947 13.0815 16.2865 12.6813 15.6 12.504M13.2 2.90405C13.8883 3.08029 14.4984 3.48061 14.9341 4.0419C15.3698 4.60318 15.6063 5.29351 15.6063 6.00405C15.6063 6.71458 15.3698 7.40491 14.9341 7.9662C14.4984 8.52749 13.8883 8.92781 13.2 9.10405M10.8 6.00005C10.8 7.76736 9.36731 9.20005 7.6 9.20005C5.83269 9.20005 4.4 7.76736 4.4 6.00005C4.4 4.23274 5.83269 2.80005 7.6 2.80005C9.36731 2.80005 10.8 4.23274 10.8 6.00005Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconStore = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M3.6 10V16.4C3.6 16.8243 3.76857 17.2313 4.06863 17.5314C4.36869 17.8314 4.77565 18 5.2 18H14.8C15.2243 18 15.6313 17.8314 15.9314 17.5314C16.2314 17.2313 16.4 16.8243 16.4 16.4V10M12.4 18V14.8C12.4 14.3757 12.2314 13.9687 11.9314 13.6686C11.6313 13.3686 11.2243 13.2 10.8 13.2H9.2C8.77565 13.2 8.36869 13.3686 8.06863 13.6686C7.76857 13.9687 7.6 14.3757 7.6 14.8V18M2 6L5.528 2.472C5.67685 2.32227 5.85385 2.20347 6.04882 2.12246C6.24379 2.04145 6.45287 1.99983 6.664 2H13.336C13.5471 1.99983 13.7562 2.04145 13.9512 2.12246C14.1461 2.20347 14.3232 2.32227 14.472 2.472L18 6H2Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconBell = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8.64118 17.1959C8.77505 17.4394 8.97185 17.6425 9.21102 17.7839C9.45019 17.9254 9.72295 18 10.0008 18C10.2787 18 10.5514 17.9254 10.7906 17.7839C11.0298 17.6425 11.2266 17.4394 11.3605 17.1959M5.20209 6.79872C5.20209 5.52602 5.70767 4.30545 6.60761 3.40551C7.50754 2.50558 8.72811 2 10.0008 2C11.2735 2 12.4941 2.50558 13.394 3.40551C14.294 4.30545 14.7995 5.52602 14.7995 6.79872C14.7995 12.3972 17.1989 13.9968 17.1989 13.9968H2.80273C2.80273 13.9968 5.20209 12.3972 5.20209 6.79872Z"
      stroke="currentColor"
      strokeWidth="1.19968"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconPaint = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M11.2039 6.8C11.8666 6.8 12.4039 6.26274 12.4039 5.6C12.4039 4.93726 11.8666 4.4 11.2039 4.4C10.5412 4.4 10.0039 4.93726 10.0039 5.6C10.0039 6.26274 10.5412 6.8 11.2039 6.8Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14.4039 10C15.0666 10 15.6039 9.46274 15.6039 8.8C15.6039 8.13726 15.0666 7.6 14.4039 7.6C13.7412 7.6 13.2039 8.13726 13.2039 8.8C13.2039 9.46274 13.7412 10 14.4039 10Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.20391 7.6C7.86665 7.6 8.40391 7.06274 8.40391 6.4C8.40391 5.73726 7.86665 5.2 7.20391 5.2C6.54116 5.2 6.00391 5.73726 6.00391 6.4C6.00391 7.06274 6.54116 7.6 7.20391 7.6Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.60391 11.2C6.26665 11.2 6.80391 10.6627 6.80391 10C6.80391 9.33726 6.26665 8.8 5.60391 8.8C4.94116 8.8 4.40391 9.33726 4.40391 10C4.40391 10.6627 4.94116 11.2 5.60391 11.2Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.0039 2C5.60391 2 2.00391 5.6 2.00391 10C2.00391 14.4 5.60391 18 10.0039 18C10.7447 18 11.3223 17.4032 11.3223 16.6496C11.3223 16.3 11.1783 15.9816 10.9727 15.7496C10.7407 15.5184 10.6223 15.228 10.6223 14.8496C10.6193 14.6735 10.6517 14.4986 10.7177 14.3354C10.7837 14.1721 10.8819 14.0238 11.0064 13.8993C11.1309 13.7748 11.2792 13.6766 11.4425 13.6106C11.6058 13.5446 11.7806 13.5122 11.9567 13.5152H13.5535C15.9943 13.5152 17.9975 11.5128 17.9975 9.072C17.9759 5.2096 14.3727 2 10.0039 2Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ── Nav config ── */
interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  animClass?: string;
}

const mainNav: NavItem[] = [
  {
    to: "/admin",
    label: "Dashboard",
    icon: <IconDashboard />,
    animClass: "sidebar-anim-dashboard",
  },
  {
    to: "/admin/produtos",
    label: "Produtos",
    icon: <IconProdutosCake />,
    animClass: "sidebar-anim-produtos",
  },
  {
    to: "/admin/pedidos",
    label: "Pedidos",
    icon: <IconBag />,
    badge: 4,
    animClass: "sidebar-anim-pedidos",
  },
  {
    to: "/admin/administradores",
    label: "Administradores",
    icon: <IconUsers />,
    animClass: "sidebar-anim-admins",
  },
  {
    to: "/admin/loja",
    label: "Loja",
    icon: <IconStore />,
    animClass: "sidebar-anim-loja",
  },
];

const systemNav: NavItem[] = [
  {
    to: "/admin/notificacoes",
    label: "Notificações",
    icon: <IconBell />,
    animClass: "sidebar-anim-notif",
  },
  {
    to: "/admin/tema",
    label: "Tema Visual",
    icon: <IconPaint />,
    animClass: "sidebar-anim-tema",
  },
];

/* ── Component ── */
interface AdminSidebarProps {
  userName?: string;
  userRole?: string;
}

export default function AdminSidebar({
  userName = "Vitor Manoel",
  userRole = "Owner",
}: AdminSidebarProps) {
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const renderNavItem = (item: NavItem) => (
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
      {item.badge !== undefined && (
        <span className="sidebar-nav-badge">{item.badge}</span>
      )}
    </NavLink>
  );

  return (
    <aside className="admin-sidebar">
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
        <nav className="sidebar-system-nav">{systemNav.map(renderNavItem)}</nav>

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
            className="sidebar-logout-btn"
            title="Sair"
            onClick={() => {
              /* navigate('/admin/login') */
            }}
          >
            <svg
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
  );
}
