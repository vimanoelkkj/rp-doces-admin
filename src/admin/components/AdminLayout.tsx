import { useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import AdminMobileBottomNav from "./AdminMobileBottomNav";
import AdminWave from "./AdminWave";
import { AdminThemeProvider } from "../theme/AdminThemeContext";
import { AdminAuthProvider, type AdminUser } from "../auth/AdminAuthContext";
import { NotificacoesProvider } from "../notificacoes/NotificacoesContext";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AdminUser }
  | { status: "unauthenticated" };

export default function AdminLayout() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não autenticado");
        return response.json() as Promise<{ usuario: AdminUser }>;
      })
      .then((data) => setAuth({ status: "authenticated", user: data.usuario }))
      .catch(() => setAuth({ status: "unauthenticated" }));
  }, []);

  const logout = () => {
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      navigate("/admin/login");
    });
  };

  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "unauthenticated") {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <AdminThemeProvider>
      <AdminAuthProvider user={auth.user} logout={logout}>
        {/* HUMAN-14: o badge da navegação e a página de Notificações leem a
            mesma contagem — marcar como lida reflete nos dois sem recarregar. */}
        <NotificacoesProvider>
          <div className="admin-layout">
            <AdminWave />
            <AdminSidebar />
            <Outlet />
            <AdminMobileBottomNav />
          </div>
        </NotificacoesProvider>
      </AdminAuthProvider>
    </AdminThemeProvider>
  );
}
