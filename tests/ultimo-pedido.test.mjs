import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Compila o helper do frontend via esbuild para execução direta no node:test
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `export * from './src/lib/ultimoPedido';`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const {
  ULTIMO_PEDIDO_TTL_MS,
  lembrarUltimoPedido,
  lerUltimoPedido,
  esquecerUltimoPedido,
  pedidoEncerrado
} = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=ultimo-pedido-bundle.mjs`).toString("base64")}`
);

const CHAVE = "rp-doces:ultimo-pedido:v1";
const TOKEN = "3f2b8c1e-5d4a-4b7e-9c1d-0a2b3c4d5e6f";
const OUTRO_TOKEN = "9a8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d";
const AGORA = Date.parse("2026-10-01T12:00:00Z");
const HORA = 60 * 60 * 1000;

const descritorOriginal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

// Troca o Web Storage global só durante o teste (undefined = sem Web Storage).
function instalarStorage(t, storage) {
  if (storage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (descritorOriginal) Object.defineProperty(globalThis, "localStorage", descritorOriginal);
    else delete globalThis.localStorage;
  });
}

function storageEmMemoria(t) {
  const dados = new Map();
  instalarStorage(t, {
    getItem: chave => dados.get(chave) ?? null,
    setItem: (chave, valor) => dados.set(chave, String(valor)),
    removeItem: chave => dados.delete(chave)
  });
  return dados;
}

const registro = campos => JSON.stringify({ tokenPublico: TOKEN, salvoEm: AGORA, ...campos });

test("lembrar grava somente tokenPublico e salvoEm na chave versionada", t => {
  const dados = storageEmMemoria(t);
  lembrarUltimoPedido(TOKEN, AGORA);
  assert.deepEqual([...dados.keys()], [CHAVE]);
  assert.deepEqual(JSON.parse(dados.get(CHAVE)), { tokenPublico: TOKEN, salvoEm: AGORA });
  assert.equal(lerUltimoPedido(AGORA), TOKEN);
});

test("lembrar mantém um único registro: o pedido mais novo sobrescreve o anterior", t => {
  const dados = storageEmMemoria(t);
  lembrarUltimoPedido(TOKEN, AGORA);
  lembrarUltimoPedido(OUTRO_TOKEN, AGORA + 1000);
  assert.deepEqual([...dados.keys()], [CHAVE]);
  assert.equal(lerUltimoPedido(AGORA + 2000), OUTRO_TOKEN);
});

test("token inválido não é gravado e não apaga o registro anterior", t => {
  const dados = storageEmMemoria(t);
  lembrarUltimoPedido(TOKEN, AGORA);
  const antes = dados.get(CHAVE);
  const invalidos = [
    undefined,
    null,
    123,
    {},
    [],
    "",
    "a b",
    "../admin",
    "<img src=x>",
    "a".repeat(101)
  ];
  for (const invalido of invalidos) {
    lembrarUltimoPedido(invalido, AGORA + 1000);
    assert.equal(dados.get(CHAVE), antes, `ignora ${JSON.stringify(invalido)}`);
  }
});

test("TTL de 48 h: vale até o limite e o registro vencido é removido", t => {
  const dados = storageEmMemoria(t);
  assert.equal(ULTIMO_PEDIDO_TTL_MS, 48 * HORA);
  lembrarUltimoPedido(TOKEN, AGORA);
  assert.equal(lerUltimoPedido(AGORA + 48 * HORA - 1), TOKEN, "1 ms antes de vencer");
  assert.equal(dados.has(CHAVE), true);
  assert.equal(lerUltimoPedido(AGORA + 48 * HORA), null, "vencido");
  assert.equal(dados.has(CHAVE), false, "o registro vencido é removido");
});

test("relógio ajustado para trás por poucos instantes não invalida o registro recém-gravado", t => {
  storageEmMemoria(t);
  lembrarUltimoPedido(TOKEN, AGORA);
  assert.equal(lerUltimoPedido(AGORA - 60_000), TOKEN);
});

test("registro corrompido ou fora do schema vira ausente e é removido", t => {
  const dados = storageEmMemoria(t);
  const corrompidos = {
    "JSON inválido": "{nao-e-json",
    null: "null",
    array: "[]",
    string: '"token"',
    número: "42",
    "objeto vazio": "{}",
    "sem salvoEm": JSON.stringify({ tokenPublico: TOKEN }),
    "sem tokenPublico": JSON.stringify({ salvoEm: AGORA }),
    "token não-string": registro({ tokenPublico: 123 }),
    "token vazio": registro({ tokenPublico: "" }),
    "token com caracteres inválidos": registro({ tokenPublico: "../admin" }),
    "token maior que 100": registro({ tokenPublico: "a".repeat(101) }),
    "salvoEm string": registro({ salvoEm: String(AGORA) }),
    "salvoEm null": registro({ salvoEm: null }),
    "salvoEm no futuro": registro({ salvoEm: AGORA + HORA }),
    "campo extra (nome)": registro({ nome: "Maria" }),
    "campo extra (pedidoId)": registro({ pedidoId: 7 })
  };
  for (const [caso, bruto] of Object.entries(corrompidos)) {
    dados.set(CHAVE, bruto);
    assert.equal(lerUltimoPedido(AGORA), null, caso);
    assert.equal(dados.has(CHAVE), false, `${caso}: registro inválido removido`);
  }
});

test("esquecer remove somente o registro do mesmo token", t => {
  const dados = storageEmMemoria(t);
  lembrarUltimoPedido(TOKEN);
  esquecerUltimoPedido(OUTRO_TOKEN);
  assert.equal(dados.has(CHAVE), true, "outro token não apaga");
  esquecerUltimoPedido(TOKEN);
  assert.equal(dados.has(CHAVE), false);
});

test("Web Storage que lança (aba privada, cota, dados bloqueados) nunca propaga erro", t => {
  instalarStorage(t, {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    }
  });
  assert.doesNotThrow(() => lembrarUltimoPedido(TOKEN, AGORA));
  assert.equal(lerUltimoPedido(AGORA), null);
  assert.doesNotThrow(() => esquecerUltimoPedido(TOKEN));

  // Registro inválido + remoção que falha: ainda assim, só devolve vazio.
  instalarStorage(t, {
    getItem: () => "{nao-e-json",
    setItem: () => {},
    removeItem: () => {
      throw new Error("SecurityError");
    }
  });
  assert.equal(lerUltimoPedido(AGORA), null);
});

test("sem Web Storage no ambiente nada lança e a leitura volta vazia", t => {
  instalarStorage(t, undefined);
  assert.doesNotThrow(() => lembrarUltimoPedido(TOKEN, AGORA));
  assert.equal(lerUltimoPedido(AGORA), null);
  assert.doesNotThrow(() => esquecerUltimoPedido(TOKEN));
});

test("pedidoEncerrado: só ENTREGUE/CANCELADO (pedido) e CANCELADO/REEMBOLSADO (pagamento) encerram", () => {
  for (const [status, encerrado] of [
    [{ statusPagamento: "PAGO", statusPedido: "ENTREGUE" }, true],
    [{ statusPagamento: "PAGO", statusPedido: "CANCELADO" }, true],
    [{ statusPagamento: "CANCELADO", statusPedido: "NOVO" }, true],
    [{ statusPagamento: "REEMBOLSADO", statusPedido: "NOVO" }, true],
    [{ statusPagamento: "REEMBOLSADO", statusPedido: "PREPARANDO" }, true],
    [{ statusPagamento: "REEMBOLSADO", statusPedido: "CANCELADO" }, true],
    [{ statusPagamento: "PENDENTE", statusPedido: "NOVO" }, false],
    [{ statusPagamento: "PAGO", statusPedido: "NOVO" }, false],
    [{ statusPagamento: "PAGO", statusPedido: "PREPARANDO" }, false],
    [{ statusPagamento: "PAGO", statusPedido: "PRONTO" }, false],
    // Um Pix tardio ainda pode virar PAGO: EXPIRADO fica de fora até o TTL.
    [{ statusPagamento: "EXPIRADO", statusPedido: "NOVO" }, false],
    // Corpo de formato desconhecido ou incompleto nunca encerra (nem lança).
    [{}, false],
    [{ statusPagamento: "PAGO" }, false],
    [{ statusPedido: "PREPARANDO" }, false]
  ]) {
    assert.equal(pedidoEncerrado(status), encerrado, JSON.stringify(status));
  }
});
