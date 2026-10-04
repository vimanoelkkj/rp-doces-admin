import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Bundle pure helper via esbuild
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `export * from "./src/admin/Produtos/novoProdutoHelpers";`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const {
  imageUrlFor,
  isoParaDatetimeLocal,
  datetimeLocalParaIso,
  calcularPromoEstadoEHint,
  validarProdutoForm
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("imageUrlFor: resolve corretamente chaves R2 e imagens estáticas de seed", () => {
  assert.equal(imageUrlFor(null), null);
  assert.equal(imageUrlFor(""), null);
  assert.equal(imageUrlFor("morango.webp"), "/images/morango.webp");
  assert.equal(
    imageUrlFor("product-42-12345678-abcd-1234-abcd-123456789abc.jpg"),
    "/api/images/product-42-12345678-abcd-1234-abcd-123456789abc.jpg"
  );
  assert.equal(
    imageUrlFor("product-1-a1b2c3d4.png"),
    "/api/images/product-1-a1b2c3d4.png"
  );
});

test("isoParaDatetimeLocal e datetimeLocalParaIso: conversão e tratamento de nulos", () => {
  assert.equal(isoParaDatetimeLocal(null), "");
  assert.equal(isoParaDatetimeLocal("invalid-date"), "");
  assert.equal(datetimeLocalParaIso(""), null);
  assert.equal(datetimeLocalParaIso("invalid-date"), null);

  const iso = "2026-10-04T18:30:00.000Z";
  const local = isoParaDatetimeLocal(iso);
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const backToIso = datetimeLocalParaIso(local);
  assert.ok(backToIso);
  assert.equal(Date.parse(backToIso), Date.parse(iso));
});

test("validarProdutoForm: controles negativos de validação", () => {
  // Preço inválido
  const res1 = validarProdutoForm({
    price: "0,00",
    stock: "10",
    promocao: false,
    promoPrice: "0,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res1.sucesso, false);
  assert.equal(res1.erro, "Informe um preço válido.");

  // Estoque não numérico
  const res2 = validarProdutoForm({
    price: "15,00",
    stock: "abc",
    promocao: false,
    promoPrice: "0,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res2.sucesso, false);
  assert.equal(res2.erro, "Informe um estoque inteiro válido.");

  // Estoque fracionário
  const res3 = validarProdutoForm({
    price: "15,00",
    stock: "10.5",
    promocao: false,
    promoPrice: "0,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res3.sucesso, false);
  assert.equal(res3.erro, "Informe um estoque inteiro válido.");

  // Promoção sem preço promocional
  const res4 = validarProdutoForm({
    price: "20,00",
    stock: "10",
    promocao: true,
    promoPrice: "0,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res4.sucesso, false);
  assert.equal(res4.erro, "Informe o preço promocional para ativar a promoção.");

  // Promoção com preço promocional >= preço normal
  const res5 = validarProdutoForm({
    price: "20,00",
    stock: "10",
    promocao: true,
    promoPrice: "20,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res5.sucesso, false);
  assert.equal(res5.erro, "O preço promocional precisa ser menor que o preço normal.");

  const res6 = validarProdutoForm({
    price: "20,00",
    stock: "10",
    promocao: true,
    promoPrice: "25,00",
    promoInicio: "",
    promoFim: ""
  });
  assert.equal(res6.sucesso, false);
  assert.equal(res6.erro, "O preço promocional precisa ser menor que o preço normal.");

  // Promoção com término anterior ao início
  const res7 = validarProdutoForm({
    price: "20,00",
    stock: "10",
    promocao: true,
    promoPrice: "15,00",
    promoInicio: "2026-10-10T12:00",
    promoFim: "2026-10-09T12:00"
  });
  assert.equal(res7.sucesso, false);
  assert.equal(res7.erro, "O término da promoção precisa ser depois do início.");

  // Caso 100% válido
  const resValido = validarProdutoForm({
    price: "25,50",
    stock: "15",
    promocao: true,
    promoPrice: "19,90",
    promoInicio: "2026-10-10T10:00",
    promoFim: "2026-10-20T10:00"
  });
  assert.equal(resValido.sucesso, true);
  if (resValido.sucesso) {
    assert.equal(resValido.dados.precoCentavos, 2550);
    assert.equal(resValido.dados.estoque, 15);
    assert.equal(resValido.dados.promoCentavos, 1990);
    assert.ok(resValido.dados.promoInicioIso);
    assert.ok(resValido.dados.promoFimIso);
  }
});

test("calcularPromoEstadoEHint: deriva os 5 estados esperados", () => {
  // Desligada
  const h1 = calcularPromoEstadoEHint(2000, "15,00", false, "", "");
  assert.equal(h1.promoEstado, "DESLIGADA");
  assert.equal(h1.promoHint, "Promoção desligada: o catálogo mostra o preço normal.");

  // Sem preço
  const h2 = calcularPromoEstadoEHint(2000, "0,00", true, "", "");
  assert.equal(h2.promoEstado, "SEM_PRECO");
  assert.equal(h2.promoHint, "Informe o preço promocional para a promoção valer.");

  // Vigente sem prazo
  const h3 = calcularPromoEstadoEHint(2000, "15,00", true, "", "");
  assert.equal(h3.promoEstado, "VIGENTE");
  assert.equal(h3.promoHint, "Vigente agora e sem prazo: vale até você desligar.");

  // Futura
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const depois = new Date(Date.now() + 172800000).toISOString().slice(0, 16);
  const h4 = calcularPromoEstadoEHint(2000, "15,00", true, amanha, depois);
  assert.equal(h4.promoEstado, "FUTURA");
  assert.equal(h4.promoHint, "Agendada: o preço promocional começa a valer na data de início.");

  // Expirada
  const ontem = new Date(Date.now() - 172800000).toISOString().slice(0, 16);
  const antesOntem = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  const h5 = calcularPromoEstadoEHint(2000, "15,00", true, ontem, antesOntem);
  assert.equal(h5.promoEstado, "EXPIRADA");
  assert.equal(h5.promoHint, "Período encerrado: o catálogo voltou ao preço normal.");
});

