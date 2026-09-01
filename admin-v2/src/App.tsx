import { useEffect, useState } from "react";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./dashboard/DashboardPage";
import type { AdminV2Page } from "./layout/AdminShell";
import { ProductsPage } from "./products/ProductsPage";

function pageFromHash(): AdminV2Page {
  return window.location.hash.toLowerCase() === "#dashboard" ? "dashboard" : "produtos";
}

export function App() {
  const [page, setPage] = useState<AdminV2Page>(() => pageFromHash());

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(nextPage: AdminV2Page) {
    if (nextPage === page) return;
    window.location.hash = nextPage;
  }

  return (
    <AuthGate>
      {session =>
        page === "dashboard" ? (
          <DashboardPage session={session} onNavigate={navigate} />
        ) : (
          <ProductsPage session={session} onNavigate={navigate} />
        )
      }
    </AuthGate>
  );
}
