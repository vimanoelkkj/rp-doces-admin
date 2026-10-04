import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Regras puras da tela de espera do Pix (sem React): falha do checkout, estados terminais,
// destino do resultado e contagem regressiva.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `export * from './src/lib/aguardandoPagamento';`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const {
  classificarFalhaCheckout,
  statusTerminal,
  destinoDoResultado,
  formatarContagem,
  segundosRestantes
} = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=aguardando-pagamento-bundle.mjs`).toString("base64")}`
);

const MSG_ESTOQUE =
  "O estoque de um ou mais itens selecionados não está mais disponível. Por favor, revise seu carrinho.";

test("classificarFalhaCheckout: resultado ambíguo com token segue para o acompanhamento", () => {
  for (const code of ["OPERACAO_EM_PROCESSAMENTO", "MERCADO_PAGO_INDISPONIVEL"]) {
    assert.deepEqual(classificarFalhaCheckout(502, { code, tokenPublico: "tok-1" }), {
      tipo: "ACOMPANHAR",
      tokenPublico: "tok-1"
    });
  }
});

test("classificarFalhaCheckout: ambíguo sem token utilizável é erro comum (nunca dispara outro checkout)", () => {
  for (const body of [
    { code: "MERCADO_PAGO_INDISPONIVEL", error: "Falha" },
    { code: "OPERACAO_EM_PROCESSAMENTO", tokenPublico: "" },
    { code: "MERCADO_PAGO_INDISPONIVEL", tokenPublico: 123 }
  ]) {
    assert.equal(classificarFalhaCheckout(502, body).tipo, "ERRO");
  }
  // Token presente, mas código que não é "ambíguo": erro comum.
  assert.equal(
    classificarFalhaCheckout(502, { code: "MERCADO_PAGO_RECUSOU", tokenPublico: "tok-1" }).tipo,
    "ERRO"
  );
});

test("classificarFalhaCheckout: estoque só com 409 e código ou mensagem de estoque", () => {
  assert.deepEqual(classificarFalhaCheckout(409, { code: "ESTOQUE_INSUFICIENTE" }), {
    tipo: "ERRO",
    mensagem: MSG_ESTOQUE,
    estoque: true
  });
  assert.deepEqual(classificarFalhaCheckout(409, { error: 'Estoque insuficiente para "Bolo"' }), {
    tipo: "ERRO",
    mensagem: 'Estoque insuficiente para "Bolo"',
    estoque: true
  });
  // 409 sem relação com estoque, e estoque fora do 409, não são erro de estoque.
  assert.deepEqual(classificarFalhaCheckout(409, { error: "Conflito qualquer" }), {
    tipo: "ERRO",
    mensagem: "Conflito qualquer",
    estoque: false
  });
  assert.equal(classificarFalhaCheckout(500, { code: "ESTOQUE_INSUFICIENTE" }).estoque, false);
});

test("classificarFalhaCheckout: mensagem padrão quando o corpo não traz erro", () => {
  assert.deepEqual(classificarFalhaCheckout(500, {}), {
    tipo: "ERRO",
    mensagem: "Falha ao criar pagamento Pix",
    estoque: false
  });
});

test("statusTerminal: PAGO, CANCELADO, FALHOU e REEMBOLSADO encerram a espera; o resto segue", () => {
  for (const status of ["PAGO", "CANCELADO", "FALHOU", "REEMBOLSADO"]) {
    assert.equal(statusTerminal(status), true, status);
  }
  for (const status of ["PENDENTE", "EXPIRADO", "", "OUTRO"]) {
    assert.equal(statusTerminal(status), false, status);
  }
});

test("destinoDoResultado: PAGO confirma e limpa o carrinho; REEMBOLSADO vai ao acompanhamento; o resto é não aprovado", () => {
  const payment = { pedidoId: 8, tokenPublico: "tok/1", totalCentavos: 6750 };
  const items = [{ id: 1, name: "Bolo", price: 50, image: "", quantity: 2 }];

  assert.deepEqual(destinoDoResultado("PAGO", payment, items), {
    limparCarrinho: true,
    para: "/pedido-confirmado",
    opcoes: {
      state: { pedidoId: 8, tokenPublico: "tok/1", items, totalCentavos: 6750 }
    }
  });
  assert.deepEqual(destinoDoResultado("REEMBOLSADO", payment, items), {
    limparCarrinho: false,
    para: "/pedido/tok%2F1",
    opcoes: { replace: true }
  });
  for (const resultado of ["CANCELADO", "FALHOU"]) {
    assert.deepEqual(destinoDoResultado(resultado, payment, items), {
      limparCarrinho: false,
      para: "/pagamento-nao-aprovado",
      opcoes: { state: { items, totalCentavos: 6750 } }
    });
  }
});

test("formatarContagem: mm:ss com zero à esquerda; sem prazo mostra --", () => {
  assert.deepEqual(formatarContagem(null), { minutes: "--", seconds: "--" });
  assert.deepEqual(formatarContagem(0), { minutes: "00", seconds: "00" });
  assert.deepEqual(formatarContagem(65), { minutes: "01", seconds: "05" });
  assert.deepEqual(formatarContagem(1800), { minutes: "30", seconds: "00" });
});

test("segundosRestantes: arredonda para baixo e nunca fica negativo", () => {
  const agora = Date.parse("2026-09-17T12:00:00Z");
  assert.equal(segundosRestantes("2026-09-17T12:00:06Z", agora), 6);
  assert.equal(segundosRestantes("2026-09-17T12:00:05.900Z", agora), 5);
  assert.equal(segundosRestantes("2026-09-17T12:00:00Z", agora), 0);
  assert.equal(segundosRestantes("2026-09-17T11:59:00Z", agora), 0);
});
