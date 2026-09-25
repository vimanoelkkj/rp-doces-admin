import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

export type AdminTheme = "light" | "dark";

export type AdminThemeTransitionOrigin =
  | { x: number; y: number }
  | MouseEvent
  | React.MouseEvent
  | HTMLElement
  | null;

interface ThemeContextType {
  theme: AdminTheme;
  toggleTheme: (origin?: AdminThemeTransitionOrigin) => void;
  setTheme: (theme: AdminTheme, origin?: AdminThemeTransitionOrigin) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = "admin-theme";

interface ExtendedAnimationOptions extends KeyframeAnimationOptions {
  pseudoElement?: string;
}

function getOriginCoords(origin?: AdminThemeTransitionOrigin): { x: number; y: number } {
  if (origin) {
    if (
      "x" in origin &&
      "y" in origin &&
      typeof origin.x === "number" &&
      typeof origin.y === "number"
    ) {
      return { x: origin.x, y: origin.y };
    }

    if ("currentTarget" in origin && origin.currentTarget instanceof HTMLElement) {
      const rect = origin.currentTarget.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    if ("target" in origin && origin.target instanceof HTMLElement) {
      const rect = origin.target.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    if (
      "clientX" in origin &&
      "clientY" in origin &&
      typeof origin.clientX === "number" &&
      typeof origin.clientY === "number"
    ) {
      return { x: origin.clientX, y: origin.clientY };
    }

    if (origin instanceof HTMLElement) {
      const rect = origin.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }

  if (typeof document !== "undefined") {
    const btn = document.querySelector<HTMLElement>(
      ".sidebar-anim-tema, .admin-login-theme-toggle, .admin-mobile-sheet-item--theme"
    );
    if (btn) {
      const rect = btn.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }

  return {
    x: typeof window !== "undefined" ? window.innerWidth - 48 : 0,
    y: 28,
  };
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AdminTheme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved === "dark" ? "dark" : "light") as AdminTheme;
  });
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-admin-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const executeThemeChange = (next: AdminTheme, origin?: AdminThemeTransitionOrigin) => {
    if (next === theme) return;
    if (isTransitioningRef.current) return;

    const applyThemeImmediately = (t: AdminTheme) => {
      document.documentElement.setAttribute("data-admin-theme", t);
      try {
        localStorage.setItem(STORAGE_KEY, t);
      } catch {
        // ignore
      }
      flushSync(() => {
        setThemeState(t);
      });
    };

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (
      typeof document === "undefined" ||
      !("startViewTransition" in document) ||
      typeof document.startViewTransition !== "function" ||
      prefersReduced
    ) {
      applyThemeImmediately(next);
      return;
    }

    isTransitioningRef.current = true;

    try {
      const transition = document.startViewTransition(() => {
        applyThemeImmediately(next);
      });

      transition.ready
        .then(() => {
          const { x, y } = getOriginCoords(origin);
          const maxDistX = Math.max(x, window.innerWidth - x);
          const maxDistY = Math.max(y, window.innerHeight - y);
          const maxRadius = Math.hypot(maxDistX, maxDistY);

          const animationOptions: ExtendedAnimationOptions = {
            duration: 480,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          };

          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${maxRadius}px at ${x}px ${y}px)`,
              ],
            },
            animationOptions,
          );
        })
        .catch(() => {
          // Fallback silencioso caso pseudo-element animation falhe
        });

      transition.finished.finally(() => {
        isTransitioningRef.current = false;
      });
    } catch {
      isTransitioningRef.current = false;
      applyThemeImmediately(next);
    }
  };

  const toggleTheme = (origin?: AdminThemeTransitionOrigin) => {
    const next: AdminTheme = theme === "light" ? "dark" : "light";
    executeThemeChange(next, origin);
  };

  const setTheme = (newTheme: AdminTheme, origin?: AdminThemeTransitionOrigin) => {
    executeThemeChange(newTheme, origin);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAdminTheme() {
  return useContext(ThemeContext);
}
