import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AdminsPage } from "./admins/AdminsPage";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./dashboard/DashboardPage";
import type { AdminV2Page } from "./layout/AdminShell";
import { OrdersPage } from "./orders/OrdersPage";
import { ProductsPage } from "./products/ProductsPage";
import { StorePage } from "./store/StorePage";

const PAGES: AdminV2Page[] = ["dashboard", "produtos", "pedidos", "admins", "loja"];
type NavigationDirection = "forward" | "backward";
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

function pageFromHash(): AdminV2Page {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#dashboard") return "dashboard";
  if (hash === "#pedidos") return "pedidos";
  if (hash === "#admins") return "admins";
  if (hash === "#loja") return "loja";
  return "produtos";
}

function navigationDirection(from: AdminV2Page, to: AdminV2Page): NavigationDirection {
  return PAGES.indexOf(to) >= PAGES.indexOf(from) ? "forward" : "backward";
}

export function App() {
  const initialPage = useRef<AdminV2Page>(pageFromHash()).current;
  const [page, setPage] = useState<AdminV2Page>(initialPage);
  const [visited, setVisited] = useState<Set<AdminV2Page>>(() => new Set([initialPage]));
  const [direction, setDirection] = useState<NavigationDirection>("forward");
  const [hasNavigated, setHasNavigated] = useState(false);
  const pageRef = useRef<AdminV2Page>(initialPage);
  const scrollPositions = useRef<Record<AdminV2Page, number>>({
    dashboard: 0,
    produtos: 0,
    pedidos: 0,
    admins: 0,
    loja: 0
  });

  function activate(nextPage: AdminV2Page, nextDirection: NavigationDirection) {
    const currentPage = pageRef.current;
    if (nextPage === currentPage) return;

    scrollPositions.current[currentPage] = window.scrollY;
    pageRef.current = nextPage;
    setDirection(nextDirection);
    setHasNavigated(true);
    setVisited(current => {
      if (current.has(nextPage)) return current;
      const next = new Set(current);
      next.add(nextPage);
      return next;
    });
    setPage(nextPage);
  }

  function transitionTo(nextPage: AdminV2Page) {
    const currentPage = pageRef.current;
    if (nextPage === currentPage) return;

    const nextDirection = navigationDirection(currentPage, nextPage);
    document.documentElement.dataset.adminNavDirection = nextDirection;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDocument = document as ViewTransitionDocument;
    const startViewTransition = transitionDocument.startViewTransition;

    if (!reducedMotion && startViewTransition) {
      try {
        startViewTransition.call(document, () => {
          flushSync(() => activate(nextPage, nextDirection));
        });
        return;
      } catch {
        // Navegação continua imediatamente caso o navegador rejeite uma transição concorrente.
      }
    }

    activate(nextPage, nextDirection);
  }

  useEffect(() => {
    const handleLocationChange = () => transitionTo(pageFromHash());
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
    if (nextPage === pageRef.current) return;
    window.history.pushState(null, "", `#${nextPage}`);
    transitionTo(nextPage);
  }

  return (
    <AuthGate>
      {session => (
        <>
          {PAGES.map(view => {
            if (!visited.has(view)) return null;

            const active = page === view;
            let content: ReactNode;

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
                data-transition-direction={active && hasNavigated ? direction : undefined}
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
