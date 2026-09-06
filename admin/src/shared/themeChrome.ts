const THEME_STATUS_COLORS = {
  light: "#e85b79",
  dark: "#1b1614"
} as const;

type Theme = keyof typeof THEME_STATUS_COLORS;

function currentTheme(): Theme {
  const datasetTheme = document.documentElement.dataset.theme;
  if (datasetTheme === "light" || datasetTheme === "dark") return datasetTheme;

  const stored = window.localStorage.getItem("rp-admin-theme");
  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ensureThemeColorMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) return meta;

  meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.appendChild(meta);
  return meta;
}

function syncThemeChrome(): void {
  const theme = currentTheme();
  const color = THEME_STATUS_COLORS[theme];
  const root = document.documentElement;
  const meta = ensureThemeColorMeta();

  root.style.colorScheme = theme;
  if (meta.content !== color) meta.content = color;
}

let scheduled = false;
function scheduleSync(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    syncThemeChrome();
  });
}

syncThemeChrome();

const observer = new MutationObserver(scheduleSync);
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"]
});
observer.observe(ensureThemeColorMeta(), {
  attributes: true,
  attributeFilter: ["content"]
});

window.addEventListener("pageshow", syncThemeChrome);
