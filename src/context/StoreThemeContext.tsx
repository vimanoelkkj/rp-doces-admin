import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

export type StoreTheme = "light" | "dark";

export type ThemeTransitionOrigin =
  | { x: number; y: number }
  | MouseEvent
  | React.MouseEvent
  | HTMLElement
  | null;

interface StoreThemeContextType {
  theme: StoreTheme;
  toggleTheme: (origin?: ThemeTransitionOrigin) => void;
  setTheme: (theme: StoreTheme, origin?: ThemeTransitionOrigin) => void;
}

const StoreThemeContext = createContext<StoreThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = "store-theme";
const ADMIN_STORAGE_KEY = "admin-theme";

export const HEADER_LIGHT_THEME_COLOR = "#eddcc6";
export const HEADER_DARK_THEME_COLOR = "#271f1b";

export function getHeaderThemeColor(theme: StoreTheme): string {
  return theme === "dark" ? HEADER_DARK_THEME_COLOR : HEADER_LIGHT_THEME_COLOR;
}

export function syncMetaThemeColor(targetTheme?: StoreTheme): string {
  if (typeof document === "undefined") return HEADER_LIGHT_THEME_COLOR;

  const resolvedTheme: StoreTheme =
    targetTheme ||
    (document.documentElement.getAttribute("data-theme") as StoreTheme) ||
    (window.localStorage.getItem(STORAGE_KEY) as StoreTheme) ||
    (window.localStorage.getItem(ADMIN_STORAGE_KEY) as StoreTheme) ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");

  const color = getHeaderThemeColor(resolvedTheme);
  let metaThemeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (!metaThemeColor) {
    metaThemeColor = document.createElement("meta");
    metaThemeColor.name = "theme-color";
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.content = color;
  return color;
}

function getSystemTheme(): StoreTheme {
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  }
  return "light";
}

function getInitialTheme(): StoreTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(ADMIN_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // localStorage pode falhar em ambientes com restrições
  }

  return getSystemTheme();
}

interface ExtendedAnimationOptions extends KeyframeAnimationOptions {
  pseudoElement?: string;
}

function getOriginCoords(origin?: ThemeTransitionOrigin): { x: number; y: number } {
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
    const btn = document.querySelector<HTMLElement>(".theme-toggle-btn");
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

export function StoreThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<StoreTheme>(getInitialTheme);
  const isTransitioningRef = useRef(false);

  // Sincroniza atributos no DOM para Storefront e Admin e atualiza statusbar theme-color
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-admin-theme", theme);
    syncMetaThemeColor(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
      localStorage.setItem(ADMIN_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Observer contínuo para manter a status bar sincronizada em qualquer mutação de atributos de tema
  useEffect(() => {
    if (typeof window === "undefined") return;

    syncMetaThemeColor();

    const observer = new MutationObserver(() => {
      const currentTheme =
        (document.documentElement.getAttribute("data-theme") as StoreTheme) ||
        theme;
      syncMetaThemeColor(currentTheme);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-admin-theme"],
    });

    return () => observer.disconnect();
  }, [theme]);

  // Listener para mudança de preferência do sistema operacional,
  // disparado apenas quando o usuário NÃO escolheu tema manualmente.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(ADMIN_STORAGE_KEY);
        if (!saved) {
          const next = e.matches ? "dark" : "light";
          document.documentElement.setAttribute("data-theme", next);
          document.documentElement.setAttribute("data-admin-theme", next);
          syncMetaThemeColor(next);
          setThemeState(next);
        }
      } catch {
        // ignore
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const executeThemeChange = (next: StoreTheme, origin?: ThemeTransitionOrigin) => {
    if (next === theme) return;
    if (isTransitioningRef.current) return;

    const applyThemeImmediately = (t: StoreTheme) => {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-admin-theme", t);
      syncMetaThemeColor(t);
      try {
        localStorage.setItem(STORAGE_KEY, t);
        localStorage.setItem(ADMIN_STORAGE_KEY, t);
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
    document.documentElement.setAttribute("data-theme-transitioning", "true");

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
        document.documentElement.removeAttribute("data-theme-transitioning");
        isTransitioningRef.current = false;
      });
    } catch {
      document.documentElement.removeAttribute("data-theme-transitioning");
      isTransitioningRef.current = false;
      applyThemeImmediately(next);
    }
  };

  const toggleTheme = (origin?: ThemeTransitionOrigin) => {
    const next: StoreTheme = theme === "light" ? "dark" : "light";
    executeThemeChange(next, origin);
  };

  const setTheme = (newTheme: StoreTheme, origin?: ThemeTransitionOrigin) => {
    executeThemeChange(newTheme, origin);
  };

  return (
    <StoreThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </StoreThemeContext.Provider>
  );
}

export function useStoreTheme() {
  return useContext(StoreThemeContext);
}
