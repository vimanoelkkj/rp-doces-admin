import { useEffect, useState } from "react";
import { AdminsPage } from "./admins/AdminsPage";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./dashboard/DashboardPage";
import type { AdminV2Page } from "./layout/AdminShell";
import { OrdersPage } from "./orders/OrdersPage";
import { ProductsPage } from "./products/ProductsPage";
import { StorePage } from "./store/StorePage";

function pageFromHash(): AdminV2Page {
  const hash = window.location.hash.toLowerCase();
  if (hash === "#dashboard") return "dashboard";
  if (hash === "#pedidos") return "pedidos";
  if (hash === "#admins") return "admins";
  if (hash === "#loja") return "loja";
  return "produtos";
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
      {session => {
        if (page === "dashboard") {
          return <DashboardPage session={session} onNavigate={navigate} />;
        }
        if (page === "pedidos") {
          return <OrdersPage session={session} onNavigate={navigate} />;
        }
        if (page === "admins") {
          return <AdminsPage session={session} onNavigate={navigate} />;
        }
        if (page === "loja") {
          return <StorePage session={session} onNavigate={navigate} />;
        }
        return <ProductsPage session={session} onNavigate={navigate} />;
      }}
    </AuthGate>
  );
}
