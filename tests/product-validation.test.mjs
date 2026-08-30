import test from "node:test";
import assert from "node:assert/strict";
import { validarProduto } from "../functions/lib/productValidation.js";
const valido = {
  nome: "Brigadeiro",
  categoria: "BOLO_NO_POTE",
  descricao: "Chocolate cremoso",
  preco_centavos: 1500,
  estoque: 8
};
test("aceita e normaliza um produto válido", () => {
  const r = validarProduto({ ...valido, nome: "  Brigadeiro  " });
  assert.equal(r.ok, true);
  assert.equal(r.produto.nome, "Brigadeiro");
  assert.equal(r.produto.disponivel, true);
});
test("rejeita categoria, preço e estoque inválidos", () => {
  assert.equal(validarProduto({ ...valido, categoria: "categoria inválida" }).ok, false);
  assert.equal(validarProduto({ ...valido, preco_centavos: 0 }).ok, false);
  assert.equal(validarProduto({ ...valido, estoque: -1 }).ok, false);
  assert.equal(validarProduto({ ...valido, estoque: 1.5 }).ok, false);
});
test("aceita slug de categoria dinâmica válido", () => {
  assert.equal(validarProduto({ ...valido, categoria: "BROWNIES" }).ok, true);
});
test("valida promoção e período", () => {
  assert.equal(validarProduto({ ...valido, promocao_ativa: true }).ok, false);
  assert.equal(
    validarProduto({ ...valido, promocao_ativa: true, preco_promocional_centavos: 1600 }).ok,
    false
  );
  assert.equal(
    validarProduto({
      ...valido,
      promocao_ativa: true,
      preco_promocional_centavos: 1200,
      promocao_inicio: "2026-09-02T00:00:00Z",
      promocao_fim: "2026-09-01T00:00:00Z"
    }).ok,
    false
  );
  assert.equal(
    validarProduto({ ...valido, promocao_ativa: true, preco_promocional_centavos: 1200 }).ok,
    true
  );
});
test("rejeita campos inesperados", () =>
  assert.equal(validarProduto({ ...valido, valor_enviado_pelo_cliente: 1 }).ok, false));
