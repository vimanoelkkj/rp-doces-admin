import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export type StoreTheme = "light" | "dark";

interface StoreThemeContextType {
  theme: StoreTheme;
  toggleTheme: () => void;
  setTheme: (theme: StoreTheme) => void;
}

const StoreThemeContext = createContext<StoreThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = "store-theme";

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
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // localStorage pode falhar em ambientes com restrições
  }

  return getSystemTheme();
}

export function StoreThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<StoreTheme>(getInitialTheme);

  // Sincroniza atributo no DOM
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Listener para mudança de preferência do sistema operacional,
  // disparado apenas quando o usuário NÃO escolheu tema manualmente.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
          setThemeState(e.matches ? "dark" : "light");
        }
      } catch {
        // ignore
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = () => {
    setThemeState((prev) => {
      const next: StoreTheme = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const setTheme = (newTheme: StoreTheme) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }
    setThemeState(newTheme);
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
