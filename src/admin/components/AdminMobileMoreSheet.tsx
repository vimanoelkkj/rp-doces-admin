import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext";
import { useNotificacoes } from "../notificacoes/NotificacoesContext";
import { useAdminTheme } from "../theme/AdminThemeContext";
import { IconBell, IconMoon, IconReceipt, IconSun, IconUsers } from "./AdminSidebar";
import { useAdminModal } from "./useAdminModal";

interface RenderProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
}

interface Props {
  children: (props: RenderProps) => ReactNode;
}

const PAPEL_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
};

function formatBadge(value: number) {
  return value > 9 ? "9+" : String(value);
}

export default function AdminMobileMoreSheet({ children }: Props) {
  const location = useLocation();
  const { user, logout } = useAdminAuth();
  const { theme, toggleTheme } = useAdminTheme();
  const { naoLidas } = useNotificacoes();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const wasOpen = useRef(false);
  const close = () => setOpen(false);
  const backdropProps = useAdminModal(open, close);

  useEffect(() => {
    close();
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }

    wasOpen.current = true;
    // Aguarda a troca de visibility do backdrop antes de mover o foco. Alguns
    // navegadores ignoram focus() enquanto o ancestral ainda está oculto.
    const focusTimer = window.setTimeout(() => firstItemRef.current?.focus(), 50);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;

      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const desktopQuery = window.matchMedia("(min-width: 901px)");
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) close();
    };

    document.addEventListener("keydown", onKeyDown);
    desktopQuery.addEventListener("change", onBreakpointChange);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      desktopQuery.removeEventListener("change", onBreakpointChange);
    };
  }, [open]);

  const initials = user.nome
    .split(" ")
    .map((name) => name[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {children({ open, setOpen, triggerRef })}
      <div
        className={`admin-mobile-sheet-backdrop${open ? " admin-mobile-sheet-backdrop--open" : ""}`}
        aria-hidden={!open}
        {...backdropProps}
      >
        <section
          ref={sheetRef}
          id="admin-mobile-more-sheet"
          className="admin-mobile-more-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-mobile-more-title"
        >
          <div className="admin-mobile-sheet-handle" aria-hidden="true" />
          <div className="admin-mobile-sheet-heading">
            <h2 id="admin-mobile-more-title">Mais opções</h2>
            <button type="button" onClick={close} aria-label="Fechar mais opções">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="admin-mobile-sheet-links" aria-label="Navegação secundária">
            <NavLink
              ref={firstItemRef}
              to="/admin/administradores"
              className={({ isActive }) =>
                `admin-mobile-sheet-item admin-mobile-sheet-item--admins${isActive ? " admin-mobile-sheet-item--active" : ""}`
              }
              onClick={close}
            >
              <span className="admin-mobile-sheet-icon"><IconUsers /></span>
              <span>Administradores</span>
            </NavLink>
            <NavLink
              to="/admin/despesas"
              className={({ isActive }) =>
                `admin-mobile-sheet-item admin-mobile-sheet-item--despesas${isActive ? " admin-mobile-sheet-item--active" : ""}`
              }
              onClick={close}
            >
              <span className="admin-mobile-sheet-icon"><IconReceipt /></span>
              <span>Despesas</span>
            </NavLink>
            <NavLink
              to="/admin/notificacoes"
              className={({ isActive }) =>
                `admin-mobile-sheet-item admin-mobile-sheet-item--notifications${isActive ? " admin-mobile-sheet-item--active" : ""}`
              }
              onClick={close}
            >
              <span className="admin-mobile-sheet-icon"><IconBell /></span>
              <span>Notificações</span>
              {naoLidas > 0 && (
                <span
                  className="admin-mobile-sheet-badge"
                  aria-label={`${naoLidas} ${naoLidas === 1 ? "notificação não lida" : "notificações não lidas"}`}
                >
                  {formatBadge(naoLidas)}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              className="admin-mobile-sheet-item admin-mobile-sheet-item--theme"
              onClick={() => {
                toggleTheme();
                close();
              }}
            >
              <span className="admin-mobile-sheet-icon">
                {theme === "light" ? <IconMoon /> : <IconSun />}
              </span>
              <span>{theme === "light" ? "Tema Escuro" : "Tema Claro"}</span>
            </button>
          </nav>

          <div className="admin-mobile-sheet-user">
            <div className="sidebar-user-avatar" aria-hidden="true"><span>{initials}</span></div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user.nome}</span>
              <span className="sidebar-user-role">{PAPEL_LABEL[user.papel] ?? user.papel}</span>
            </div>
            <button type="button" className="sidebar-logout-btn" onClick={logout} aria-label="Sair">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
