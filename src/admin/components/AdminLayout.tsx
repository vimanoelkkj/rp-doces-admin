import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import AdminWave from "./AdminWave";
import { AdminThemeProvider } from "../theme/AdminThemeContext";

export default function AdminLayout() {
  return (
    <AdminThemeProvider>
      <div className="admin-layout">
        <AdminWave />
        <AdminSidebar />
        <Outlet />
      </div>
    </AdminThemeProvider>
  );
}
