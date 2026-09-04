import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AdminsPage } from "./admins/AdminsPage";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./dashboard/DashboardPage";
import type { AdminV2Page } from "./layout/AdminShell";
import { OrdersPage } from "./orders/OrdersPage";
import { ProductsPage } from "./products/ProductsPage";
import { StorePage } from "./store/StorePage";

const PAGES: AdminV2Page[] = ["dashboard", "produtos", "pedidos", "admins", "loja"];

function pageFromHash(): AdminV2Page {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#dashboard") return "dashboard";
  if (hash === "#pedidos") return "pedidos";
  if (hash === "#admins") return "admins";
  if (hash === "#loja") return "loja";
  return "produtos";
}

export function App() {
  const initialPage = useRef<AdminV2Page>(pageFromHash()).current;
  const [page, setPage] = useState<AdminV2Page>(initialPage);
  const [visited, setVisited] = useState<Set<AdminV2Page>>(() => new Set([initialPage]));
  const pageRef = useRef<AdminV2Page>(initialPage);
  const scrollPositions = useRef<Record<AdminV2Page, number>>({
    dashboard: 0,
    produtos: 0,
    pedidos: 0,
    admins: 0,
    loja: 0
  });

  function activate(nextPage: AdminV2Page) {
    const currentPage = pageRef.current;
    if (nextPage === currentPage) return;

    scrollPositions.current[currentPage] = window.scrollY;
    pageRef.current = nextPage;
    setVisited(current => {
      if (current.has(nextPage)) return current;
      const next = new Set(current);
      next.add(nextPage);
      return next;
    });
    setPage(nextPage);
  }

  useEffect(() => {
    const handleHashChange = () => activate(pageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: scrollPositions.current[page], behavior: "instant" });
  }, [page]);

  function navigate(nextPage: AdminV2Page) {
    if (nextPage === pageRef.current) return;
    window.location.hash = nextPage;
  }

  return (
    <AuthGate>
      {session => (
        <>
          {PAGES.map(view => {
            if (!visited.has(view)) return null;

            const active = page === view;
            let content;

            if (view === "dashboard") {
              content = <DashboardPage session={session} onNavigate={navigate} />;
            } else if (view === "pedidos") {
              content = <OrdersPage session={session} onNavigate={navigate} />;
            } else if (view === "admins") {
              content = <AdminsPage session={session} onNavigate={navigate} />;
            } else if (view === "loja") {
              content = <StorePage session={session} onNavigate={navigate} />;
            } else {
              content = <ProductsPage session={session} onNavigate={navigate} />;
            }

            return (
              <div
                key={view}
                hidden={!active}
                aria-hidden={!active}
                data-admin-view={view}
              >
                {content}
              </div>
            );
          })}
        </>
      )}
    </AuthGate>
  );
}
