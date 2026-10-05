import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sidebarSvgInventory } from "./helpers/admin-sidebar-icons.mjs";

const administrativeSvgFiles = new Map([
  ["src/admin/notificacoes/AdminNotificacoes.tsx", 6],
  ["src/admin/notificacoes/PushNotificationCard.tsx", 1],
  ["src/admin/Loja/AdminLoja.tsx", 0],
  ["src/admin/Loja/LojaPreviewPanel.tsx", 4],
  ["src/admin/Dashboard/AdminDashboard.tsx", 2],
  ["src/admin/Administradores/AdminAdministradores.tsx", 4]
]);

test("SVGs administrativos redundantes ficam fora da árvore de acessibilidade", async () => {
  const sidebarSvgs = sidebarSvgInventory();
  assert.equal(sidebarSvgs.length, 11, "Sidebar icon inventory changed");
  assert.equal(
    sidebarSvgs.filter(svg => svg["aria-hidden"] === "true").length,
    11,
    "Every sidebar SVG remains hidden from the accessibility tree"
  );
  for (const [file, expectedCount] of administrativeSvgFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const svgs = source.match(/<svg\b[^>]*>/gs) ?? [];

    assert.equal(svgs.length, expectedCount, `${file}: inventário de SVGs mudou`);
    assert.equal(
      svgs.filter(svg => /aria-hidden=["']true["']/.test(svg)).length,
      expectedCount,
      `${file}: todo SVG classificado como redundante deve declarar aria-hidden`
    );
  }
});
