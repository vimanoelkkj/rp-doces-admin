import { createContext, useContext, type ReactNode } from "react";

export interface AdminUser {
  id: number;
  nome: string;
  username: string;
  email: string;
  papel: "OWNER" | "ADMIN";
}

interface AdminAuthContextType {
  user: AdminUser;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export function AdminAuthProvider({
  user,
  logout,
  children,
}: {
  user: AdminUser;
  logout: () => void;
  children: ReactNode;
}) {
  return (
    <AdminAuthContext.Provider value={{ user, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth deve ser usado dentro de AdminAuthProvider");
  }
  return ctx;
}
