import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useNotificacoes } from "../notificacoes/NotificacoesContext";
import {
  IconBag,
  IconDashboard,
  IconProdutosCake,
  IconStore,
} from "./AdminSidebar";
import AdminMobileMoreSheet from "./AdminMobileMoreSheet";
import "./AdminMobileNavigation.css";

interface PrimaryItem {
  to: string;
  label: string;
  icon: ReactNode;
  animation: string;
}

const primaryItems: PrimaryItem[] = [
  {
    to: "/admin",
    label: "Painel",
    icon: <IconDashboard />,
    animation: "admin-mobile-nav-item--dashboard",
  },
  {
    to: "/admin/produtos",
    label: "Produtos",
    icon: <IconProdutosCake />,
    animation: "admin-mobile-nav-item--produtos",
  },
  {
    to: "/admin/pedidos",
    label: "Pedidos",
    icon: <IconBag />,
    animation: "admin-mobile-nav-item--pedidos",
  },
  {
    to: "/admin/loja",
    label: "Loja",
    icon: <IconStore />,
    animation: "admin-mobile-nav-item--loja",
  },
];

const secondaryPaths = ["/admin/administradores", "/admin/despesas", "/admin/notificacoes"];

function IconMore() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="4" cy="10" r="1.4" fill="currentColor" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
      <circle cx="16" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

function formatBadge(value: number) {
  return value > 9 ? "9+" : String(value);
}

export default function AdminMobileBottomNav() {
  const location = useLocation();
  const { notificacoes, naoLidas } = useNotificacoes();
  // Cada notificação PEDIDO é derivada de um pedido operacional ainda em
  // status NOVO. A leitura da notificação não encerra essa pendência.
  const pedidosAguardandoPreparo = notificacoes.filter(
    (notificacao) => notificacao.tipo === "PEDIDO",
  ).length;
  const secondaryActive = secondaryPaths.includes(location.pathname);

  return (
    <AdminMobileMoreSheet>
      {({ open, setOpen, triggerRef }) => (
        <nav className="admin-mobile-bottom-nav" aria-label="Navegação principal">
          {primaryItems.map((item) => {
            const badge = item.to === "/admin/pedidos" ? pedidosAguardandoPreparo : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) =>
                  `admin-mobile-nav-item ${item.animation}${isActive ? " admin-mobile-nav-item--active" : ""}`
                }
              >
                <span className="admin-mobile-nav-icon">
                  {item.icon}
                  {badge > 0 && (
                    <span
                      className="admin-mobile-nav-badge"
                      aria-label={`${badge} ${badge === 1 ? "pedido aguardando atenção" : "pedidos aguardando atenção"}`}
                    >
                      {formatBadge(badge)}
                    </span>
                  )}
                </span>
                <span className="admin-mobile-nav-label">{item.label}</span>
              </NavLink>
            );
          })}

          <button
            ref={triggerRef}
            type="button"
            className={`admin-mobile-nav-item admin-mobile-nav-item--mais${
              secondaryActive || open ? " admin-mobile-nav-item--active" : ""
            }`}
            aria-label="Abrir mais opções administrativas"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="admin-mobile-more-sheet"
            aria-current={secondaryActive ? "page" : undefined}
            onClick={() => setOpen(true)}
          >
            <span className="admin-mobile-nav-icon">
              <IconMore />
              {naoLidas > 0 && (
                <span
                  className="admin-mobile-nav-badge"
                  aria-label={`${naoLidas} ${naoLidas === 1 ? "notificação não lida" : "notificações não lidas"}`}
                >
                  {formatBadge(naoLidas)}
                </span>
              )}
            </span>
            <span className="admin-mobile-nav-label">Mais</span>
          </button>
        </nav>
      )}
    </AdminMobileMoreSheet>
  );
}
