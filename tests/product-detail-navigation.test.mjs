import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navigationSource = await readFile(
  new URL("../public/assets/js/mobile-navigation.js", import.meta.url),
  "utf8"
);
const catalogSource = await readFile(
  new URL("../public/assets/js/product-catalog.js", import.meta.url),
  "utf8"
);

test("a navegação central fecha o modal de produto antes de trocar de painel", () => {
  const trocarPainel = navigationSource.match(
    /function trocarPainel\(abrirProximo\)[\s\S]*?\n  function abrirMenu/
  )?.[0];

  assert.ok(trocarPainel, "função central trocarPainel não encontrada");
  assert.match(trocarPainel, /rpProductDetailOverlay/);
  assert.match(trocarPainel, /dispatchEvent\(new Event\("rp-close-mobile-sheets"\)\)/);
});

test("o fechamento do detalhe limpa backdrop, scroll e produto selecionado", () => {
  const fecharDetalhe = catalogSource.match(
    /function fecharDetalhe\(\)[\s\S]*?\n    function abrirDetalhe/
  )?.[0];

  assert.ok(fecharDetalhe, "função fecharDetalhe não encontrada");
  assert.match(fecharDetalhe, /classList\.remove\("open"\)/);
  assert.match(fecharDetalhe, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(fecharDetalhe, /classList\.remove\("rp-mobile-menu-open"\)/);
  assert.match(fecharDetalhe, /style\.removeProperty\("overflow"\)/);
  assert.match(fecharDetalhe, /detailSheet\?\.style\.removeProperty\("transform"\)/);
  assert.match(fecharDetalhe, /detailCard = null/);
});

test("o modal continua fechando pelos mecanismos existentes", () => {
  assert.match(
    catalogSource,
    /getElementById\("rpProductDetailClose"\)\?\.addEventListener\("click", fecharDetalhe\)/
  );
  assert.match(catalogSource, /event\.target === detailOverlay/);
  assert.match(catalogSource, /"rp-close-mobile-sheets", fecharDetalhe/);
  assert.match(catalogSource, /event\.key === "Escape"/);
});
