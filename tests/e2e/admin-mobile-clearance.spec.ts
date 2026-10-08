import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const navigationCss = readFileSync(
  new URL("../../src/admin/components/AdminMobileNavigation.css", import.meta.url),
  "utf8"
);
const pageCss = [
  "components/AdminSidebar.css",
  "Administradores/AdminAdministradores.css",
  "Loja/AdminLoja.css"
]
  .map(file => readFileSync(new URL(`../../src/admin/${file}`, import.meta.url), "utf8"))
  .join("\n");

for (const width of [360, 600, 800, 900, 901]) {
  for (const navigationFirst of [true, false]) {
    test(`admin clearance at ${width}px with navigation CSS ${navigationFirst ? "first" : "last"}`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const css = navigationFirst ? `${navigationCss}\n${pageCss}` : `${pageCss}\n${navigationCss}`;
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
        <div class="admin-layout">
          <main class="admin-main">Dashboard</main>
          <main class="adm-main">Administrators</main>
          <main class="loj-main">Store</main>
        </div>
      </body></html>`);

      const expectedPadding = width <= 600 ? 122 : width <= 900 ? 138 : 32;
      for (const selector of [".admin-main", ".adm-main", ".loj-main"]) {
        await expect(page.locator(selector)).toHaveCSS("padding-bottom", `${expectedPadding}px`);
      }
    });
  }
}
