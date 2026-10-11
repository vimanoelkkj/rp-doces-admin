import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("Keyboard Navigation: nenhum botão do storefront ejeta o foco chamando blur() em onClick", () => {
  const storefrontFiles = [
    "src/components/ProductCard.tsx",
    "src/components/CartItemRow.tsx",
    "src/components/CartFooter.tsx",
    "src/pages/Cardapio.tsx",
    "src/components/CartWidget.tsx"
  ];

  for (const relPath of storefrontFiles) {
    const fullPath = path.resolve(relPath);
    const content = fs.readFileSync(fullPath, "utf-8");
    assert.doesNotMatch(
      content,
      /\.blur\(\)/,
      `${relPath} não deve invocar .blur() em manipuladores de clique/teclado para não ejetar o foco para document.body`
    );
  }
});

test("Keyboard Navigation: :focus:not(:focus-visible) em global.css preserva mouse sem estragar teclado", () => {
  const css = fs.readFileSync(path.resolve("src/global.css"), "utf-8");
  assert.match(
    css,
    /button:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;\s*\}/,
    "global.css deve conter regra button:focus:not(:focus-visible) para suprimir outline de mouse nativamente"
  );
});
