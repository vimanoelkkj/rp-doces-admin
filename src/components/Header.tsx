import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useStoreTheme } from "../context/StoreThemeContext";
import { useOptionalAdminAuth } from "../admin/auth/AdminAuthContext";
import { useOptionalNotificacoes } from "../admin/notificacoes/NotificacoesContext";
import {
  IconDashboard,
  IconProdutosCake,
  IconBag,
  IconReceipt,
  IconStore,
  IconUsers,
  IconBell
} from "./icons/AdminNavigationIcons";
import { useDrawerDrag } from "./useDrawerDrag";
import { useHomeHashScroll } from "./useHomeHashScroll";
import MobileMenuDrawer from "./MobileMenuDrawer";
import "./Header.css";

export interface HeaderProps {
  variant?: "storefront" | "admin";
}

interface AdminNavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export default function Header({ variant }: HeaderProps) {
  const location = useLocation();
  const { theme, toggleTheme } = useStoreTheme();
  const adminAuth = useOptionalAdminAuth();
  const notificacoesApi = useOptionalNotificacoes();

  const isAdmin =
    variant !== undefined ? variant === "admin" : location.pathname.startsWith("/admin");

  const adminUser = adminAuth?.user ?? null;
  const adminLogout = adminAuth?.logout;
  const naoLidas = notificacoesApi?.naoLidas ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenuRef = useRef<() => void>(() => {});

  const {
    dragOffset,
    isDragging,
    resetDrag,
    handleDragStart,
    handleDragMove,
    finishDrag,
    handleDragHandleClick
  } = useDrawerDrag({
    menuOpen,
    menuRef,
    onClose: () => closeMenuRef.current()
  });

  const closeMenu = useCallback(() => {
    resetDrag();
    setMenuOpen(false);
  }, [resetDrag]);

  closeMenuRef.current = closeMenu;

  const { handleStorefrontNav } = useHomeHashScroll({
    menuOpen,
    closeMenu
  });

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;

    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, [menuOpen]);

  const adminNavItems: AdminNavItem[] = [
    { to: "/admin", label: "Dashboard", icon: <IconDashboard /> },
    { to: "/admin/produtos", label: "Produtos", icon: <IconProdutosCake /> },
    { to: "/admin/pedidos", label: "Pedidos", icon: <IconBag /> },
    { to: "/admin/despesas", label: "Despesas", icon: <IconReceipt /> },
    { to: "/admin/loja", label: "Loja", icon: <IconStore /> },
    { to: "/admin/administradores", label: "Administradores", icon: <IconUsers /> },
    {
      to: "/admin/notificacoes",
      label: "Notificações",
      icon: <IconBell />,
      badge: naoLidas
    }
  ];

  const adminUserInitials = adminUser?.nome
    ? adminUser.nome
        .split(" ")
        .map(n => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "AD";

  return (
    <>
      <header className={`header ${isAdmin ? "header--admin" : ""}`}>
        <Link to={isAdmin ? "/admin" : "/"} className="logo">
          <div className="logo-circle">
            <svg
              className="header-cake"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle className="flame flame-1" cx="5.833" cy="3.334" r="1.2" fill="#d38b80" />
              <circle className="flame flame-2" cx="10" cy="3.334" r="1.2" fill="#d38b80" />
              <circle className="flame flame-3" cx="14.167" cy="3.334" r="1.2" fill="#d38b80" />
            </svg>
          </div>
          <span className="logo-text">R&amp;P Doces</span>
          {isAdmin && <span className="header-admin-badge">Admin</span>}
        </Link>

        {isAdmin ? (
          <nav className="main-nav main-nav--admin" aria-label="Navegação administrativa">
            {adminNavItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "nav-link--active active" : ""}`
                }
              >
                <span>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="header-nav-badge">{item.badge > 9 ? "9+" : item.badge}</span>
                )}
              </NavLink>
            ))}
          </nav>
        ) : (
          <nav className="main-nav" aria-label="Navegação principal">
            <a
              href={location.pathname === "/" ? "#cardapio" : "/#cardapio"}
              className="nav-link"
              onClick={e => handleStorefrontNav("#cardapio", e)}
            >
              Cardápio
            </a>
            <a
              href={location.pathname === "/" ? "#sobre" : "/#sobre"}
              className="nav-link"
              onClick={e => handleStorefrontNav("#sobre", e)}
            >
              Sobre
            </a>
            <a
              href={location.pathname === "/" ? "#onde-estamos" : "/#onde-estamos"}
              className="nav-link"
              onClick={e => handleStorefrontNav("#onde-estamos", e)}
            >
              Onde estamos
            </a>
            <a
              href={location.pathname === "/" ? "#contato" : "/#contato"}
              className="nav-link"
              onClick={e => handleStorefrontNav("#contato", e)}
            >
              Contato
            </a>
          </nav>
        )}

        <div className="header-actions">
          {isAdmin && adminUser && (
            <div className="header-admin-user" title={`${adminUser.nome} (${adminUser.papel})`}>
              <span className="header-admin-avatar">{adminUserInitials}</span>
              {adminLogout && (
                <button
                  type="button"
                  className="header-logout-btn"
                  onClick={adminLogout}
                  title="Sair do painel"
                  aria-label="Sair do painel"
                >
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
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
              )}
            </div>
          )}

          <button
            type="button"
            className="theme-toggle-btn"
            onClick={e => {
              e.currentTarget.blur();
              toggleTheme(e);
            }}
            aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
            title={theme === "light" ? "Modo escuro" : "Modo claro"}
          >
            {theme === "light" ? (
              <svg
                aria-hidden="true"
                className="theme-toggle-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="theme-toggle-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          {!isAdmin && (
            <button
              ref={menuButtonRef}
              type="button"
              className={`mobile-menu-btn ${menuOpen ? "mobile-menu-btn--open" : ""}`}
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu-drawer"
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </header>

      {!isAdmin &&
        createPortal(
          <MobileMenuDrawer
            menuOpen={menuOpen}
            menuRef={menuRef}
            menuButtonRef={menuButtonRef}
            dragOffset={dragOffset}
            isDragging={isDragging}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={event => finishDrag(event)}
            onPointerCancel={event => finishDrag(event, true)}
            onDragHandleClick={handleDragHandleClick}
            onClose={closeMenu}
            onNavigate={handleStorefrontNav}
          />,
          document.body
        )}
    </>
  );
}
