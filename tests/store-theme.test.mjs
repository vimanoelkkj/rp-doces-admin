import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("StoreTheme: anti-flash script in index.html matches store-theme storage key and attributes", () => {
  const html = fs.readFileSync(path.resolve("index.html"), "utf-8");
  assert.match(html, /localStorage\.getItem\(["']store-theme["']\)/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /document\.documentElement\.setAttribute\(["']data-theme["'],\s*theme\)/);
});

test("StoreTheme: StoreThemeContext uses correct storage key and does not overwrite manual choice", () => {
  const contextCode = fs.readFileSync(path.resolve("src/context/StoreThemeContext.tsx"), "utf-8");
  assert.match(contextCode, /STORAGE_KEY\s*=\s*["']store-theme["']/);
  assert.match(contextCode, /data-theme/);
  assert.match(contextCode, /prefers-color-scheme:\s*dark/);
  // Ensure system preference change only modifies theme if NOT saved manually
  assert.match(contextCode, /if\s*\(!saved\)/);
});

test("StoreTheme: global.css defines complete semantic store tokens for :root and html[data-theme='dark']", () => {
  const css = fs.readFileSync(path.resolve("src/global.css"), "utf-8");
  const requiredTokens = [
    "--store-bg",
    "--store-surface",
    "--store-surface-card",
    "--store-surface-elevated",
    "--store-surface-soft",
    "--store-surface-input",
    "--store-text",
    "--store-text-heading",
    "--store-text-muted",
    "--store-border",
    "--store-accent",
    "--store-accent-hover",
    "--store-wave-primary",
    "--store-wave-secondary",
    "--store-overlay",
    "--store-shadow",
  ];

  for (const token of requiredTokens) {
    assert.ok(css.includes(token), `global.css should contain ${token}`);
  }

  assert.ok(css.includes('html[data-theme="dark"]'), "global.css should have dark theme selector");
});

test("StoreTheme: Header.tsx includes theme toggle button with accessible attributes and Feather SVGs", () => {
  const headerCode = fs.readFileSync(path.resolve("src/components/Header.tsx"), "utf-8");
  assert.match(headerCode, /useStoreTheme/);
  assert.match(headerCode, /theme-toggle-btn/);
  assert.match(headerCode, /aria-label/);
  assert.match(headerCode, /theme-toggle-icon/);
});

test("StoreTheme: No CSS image filters (brightness, contrast, invert) applied to product images", () => {
  const cssFiles = [
    "src/components/ProductCard.css",
    "src/components/CartWidget.css",
    "src/pages/Cardapio.css",
    "src/pages/Homepage.css",
    "src/pages/Checkout.css",
    "src/pages/AguardandoPagamento.css",
    "src/pages/PedidoConfirmado.css",
    "src/pages/PagamentoNaoAprovado.css",
  ];

  for (const relPath of cssFiles) {
    const content = fs.readFileSync(path.resolve(relPath), "utf-8");
    assert.ok(!content.includes("filter: brightness"), `${relPath} must not use filter: brightness`);
    assert.ok(!content.includes("filter: contrast"), `${relPath} must not use filter: contrast`);
    assert.ok(!content.includes("filter: invert"), `${relPath} must not use filter: invert`);
  }
});

test("StoreTheme: anti-flash script in index.html syncs meta[name='theme-color'] with exact header colors", () => {
  const html = fs.readFileSync(path.resolve("index.html"), "utf-8");
  assert.match(html, /<meta\s+name=["']theme-color["']/);
  assert.match(html, /querySelector\(["']meta\[name=["\\]*theme-color["\\]*\]["']\)/);
  assert.match(html, /#271f1b/);
  assert.match(html, /#eddcc6/);
});

test("StoreTheme: StoreThemeContext exports header theme colors and synchronizes statusbar dynamically", () => {
  const contextCode = fs.readFileSync(path.resolve("src/context/StoreThemeContext.tsx"), "utf-8");
  assert.match(contextCode, /HEADER_LIGHT_THEME_COLOR\s*=\s*["']#eddcc6["']/);
  assert.match(contextCode, /HEADER_DARK_THEME_COLOR\s*=\s*["']#271f1b["']/);
  assert.match(contextCode, /syncMetaThemeColor/);
  assert.match(contextCode, /MutationObserver/);
});

test("StoreTheme: useAdminPwa restores storefront theme-color dynamically on cleanup", () => {
  const adminPwaCode = fs.readFileSync(path.resolve("src/admin/pwa/useAdminPwa.ts"), "utf-8");
  assert.match(adminPwaCode, /getStorefrontThemeColor/);
  assert.doesNotMatch(adminPwaCode, /themeMeta\.content\s*=\s*STOREFRONT_THEME_COLOR/);
});

