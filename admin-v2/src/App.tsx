import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AdminsPage } from "./admins/AdminsPage";
import { AppControlPage } from "./app-control/AppControlPage";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./dashboard/DashboardPage";
import { AdminShell, type AdminV2Page } from "./layout/AdminShell";
import { OrdersPage } from "./orders/OrdersPage";
import { ProductsPage } from "./products/ProductsPage";
import { closeTopBackLayer } from "./shared/useBackLayer";
import { StorePage } from "./store/StorePage";

const PAGES: AdminV2Page[] = ["dashboard", "produtos", "pedidos", "admins", "loja", "app"];

const PAGE_META: Record<AdminV2Page, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Visão geral da operação"
  },
  produtos: {
    title: "Produtos",
    subtitle: "Catálogo, categorias, estoque e promoções"
  },
  pedidos: {
    title: "Pedidos",
    subtitle: "Acompanhe vendas, pagamentos e andamento"
  },
  admins: {
    title: "Administradores",
    subtitle: "Contas, níveis de acesso e segurança da equipe"
  },
  loja: {
    title: "Loja",
    subtitle: "Atendimento, contato e aparência do site público"
  },
  app: {
    title: "Controle do App",
    subtitle: "Remote config, manutenção, navegação e recursos"
  }
};

function pageFromHash(): AdminV2Page {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#dashboard") return "dashboard";
  if (hash === "#pedidos") return "pedidos";
  if (hash === "#admins") return "admins";
  if (hash === "#loja") return "loja";
  if (hash === "#app") return "app";
  return "produtos";
}

export function App() {
  const initialPage = useRef<AdminV2Page>(pageFromHash()).current;
  const [page, setPage] = useState<AdminV2Page>(initialPage);
  const [visited, setVisited] = useState<Set<AdminV2Page>>(() => new Set([initialPage]));
  const [hasNavigated, setHasNavigated] = useState(false);
  const pageRef = useRef<AdminV2Page>(initialPage);
  const scrollPositions = useRef<Record<AdminV2Page, number>>({
    dashboard: 0,
    produtos: 0,
    pedidos: 0,
    admins: 0,
    loja: 0,
    app: 0
  });

  function activate(nextPage: AdminV2Page) {
    const currentPage = pageRef.current;
    if (nextPage === currentPage) return;

    scrollPositions.current[currentPage] = window.scrollY;
    pageRef.current = nextPage;
    setHasNavigated(true);
    setVisited(current => {
      if (current.has(nextPage)) return current;
      const next = new Set(current);
      next.add(nextPage);
      return next;
    });
    setPage(nextPage);
  }

  useEffect(() => {
    const handleLocationChange = () => activate(pageFromHash());
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo(0, scrollPositions.current[page]);
  }, [page]);

  function navigate(nextPage: AdminV2Page) {
    if (closeTopBackLayer()) return;
    if (nextPage === pageRef.current) return;
    window.history.pushState(null, "", `#${nextPage}`);
    activate(nextPage);
  }

  return (
    <AuthGate>
      {session => {
        const meta = PAGE_META[page];
        const isAdmin = String(session.user.papel || "").toUpperCase() === "ADMIN";

        return (
          <AdminShell
            session={session}
            activePage={page}
            title={meta.title}
            subtitle={meta.subtitle}
            onNavigate={navigate}
            hideHeader={page === "pedidos"}
            fullWidth={page === "pedidos"}
          >
            {PAGES.map(view => {
              if (!visited.has(view)) return null;

              const active = page === view;
              let content: ReactNode;

              if (view === "dashboard") {
                content = <DashboardPage session={session} onNavigate={navigate} active={active} />;
              } else if (view === "pedidos") {
                content = <OrdersPage session={session} onNavigate={navigate} active={active} />;
              } else if (view === "admins") {
                content = <AdminsPage session={session} onNavigate={navigate} active={active} />;
              } else if (view === "loja") {
                content = <StorePage session={session} onNavigate={navigate} />;
              } else if (view === "app") {
                content = isAdmin
                  ? <AppControlPage active={active} />
                  : <p>Somente administradores podem acessar o controle do aplicativo.</p>;
              } else {
                content = <ProductsPage session={session} onNavigate={navigate} active={active} />;
              }

              return (
                <div
                  key={view}
                  hidden={!active}
                  aria-hidden={!active}
                  data-admin-view={view}
                  data-page-enter={active && hasNavigated ? "" : undefined}
                >
                  {content}
                </div>
              );
            })}
          </AdminShell>
        );
      }}
    </AuthGate>
  );
}
