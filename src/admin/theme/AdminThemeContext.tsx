import type { ReactNode } from "react";
import {
  useStoreTheme,
  type StoreTheme,
  type ThemeTransitionOrigin,
} from "../../context/StoreThemeContext";

export type AdminTheme = StoreTheme;
export type AdminThemeTransitionOrigin = ThemeTransitionOrigin;

export function useAdminTheme() {
  const { theme, toggleTheme, setTheme } = useStoreTheme();
  return {
    theme: theme as AdminTheme,
    toggleTheme: toggleTheme as (origin?: AdminThemeTransitionOrigin) => void,
    setTheme: setTheme as (theme: AdminTheme, origin?: AdminThemeTransitionOrigin) => void,
  };
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  // StoreThemeProvider at the root already manages the unified theme state.
  return <>{children}</>;
}
