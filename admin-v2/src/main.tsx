import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./tokens.css";
import "./shared/mobileOverlayScrollLock";
import "./shared/mobileOrderFilter";
import "./shared/themeChrome";

const storedTheme = window.localStorage.getItem("rp-admin-theme");
if (storedTheme === "light" || storedTheme === "dark") {
  document.documentElement.dataset.theme = storedTheme;
}

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
