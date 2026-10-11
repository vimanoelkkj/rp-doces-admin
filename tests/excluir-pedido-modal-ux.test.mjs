import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Real ExcluirPedidoModal; only HTTP is fake. Unknown results (no JSON / network loss) must
// never be reported as a definitive failure nor trigger an independent financial retry.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://local.test"
});
const originalFetch = globalThis.fetch;
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
dom.window.scrollTo = () => {};
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
test.after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Modal from './src/admin/Pedidos/ExcluirPedidoModal';
      export { act } from 'react';
      export function mount(container, props) {
        const root = createRoot(container);
        root.render(<Modal {...props} />);
        return { unmount: () => root.unmount() };
      }`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty" }
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const json = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
const noJson = (ok = false) => ({
  ok,
  json: async () => {
    throw new SyntaxError("Unexpected token '<'");
  }
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await ui.act(async () => tick());
};
const perna = { pagamentoId: 1, valorCentavos: 1000, restanteCentavos: 1000, intencao: null };

async function abrir(t, { estornoGet, estornoPost, anulacaoPost, onDeleted }) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  let deleted = 0;
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ url: String(url), method, body: options.body });
    if (String(url).endsWith("/reconciliar")) return json({});
    if (String(url).endsWith("/anulacao/estorno") && method === "GET") return estornoGet();
    if (String(url).endsWith("/anulacao/estorno") && method === "POST") return estornoPost();
    if (String(url).endsWith("/anulacao") && method === "POST") return anulacaoPost();
    assert.fail(`Unexpected request: ${method} ${url}`);
  };
  let handle;
  await ui.act(async () => {
    handle = ui.mount(document.querySelector("#root"), {
      orderId: 9,
      liquidoCentavos: 1000,
      onClose() {},
      onDeleted() {
        deleted++;
        onDeleted?.();
      }
    });
  });
  await settle();
  t.after(async () => {
    await ui.act(async () => handle.unmount());
  });
  return { calls, deleted: () => deleted };
}
const posts = (calls, suffix) => calls.filter(c => c.method === "POST" && c.url.endsWith(suffix));

for (const modo of ["sem-json", "rede"]) {
  test(`estorno ${modo}: resultado incerto, sem afirmar falha e sem reenvio automatico`, async t => {
    const h = await abrir(t, {
      estornoGet: () => json({ restanteTotalCentavos: 1000, pernas: [perna] }),
      estornoPost: () =>
        modo === "rede" ? Promise.reject(new TypeError("Failed to fetch")) : noJson(false),
      anulacaoPost: () => assert.fail("anulacao nao deve ser chamada")
    });
    await ui.act(async () => document.querySelector(".excluir-pedido-estorno-botao").click());
    await settle();
    const erro = document.querySelector(".excluir-pedido-estorno-erro").textContent;
    assert.match(erro, /confirmar o resultado do estorno/);
    assert.doesNotMatch(erro, /Falha de rede|Unexpected|Failed to fetch|SyntaxError/);
    assert.equal(posts(h.calls, "/anulacao/estorno").length, 1, "nenhum retry automatico");
    // Nova tentativa e explicita e reaproveita a mesma operationKey (replay A1).
    await ui.act(async () => document.querySelector(".excluir-pedido-estorno-botao").click());
    await settle();
    const [a, b] = posts(h.calls, "/anulacao/estorno").map(c => JSON.parse(c.body).operationKey);
    assert.equal(a, b);
  });
}

for (const modo of ["sem-json", "rede"]) {
  test(`exclusao ${modo}: mensagem de resultado incerto, pedido nao e dado como excluido`, async t => {
    const h = await abrir(t, {
      estornoGet: () => json({ restanteTotalCentavos: 0, pernas: [] }),
      estornoPost: () => assert.fail("estorno nao deve ser chamado"),
      anulacaoPost: () =>
        modo === "rede" ? Promise.reject(new TypeError("Failed to fetch")) : noJson(false)
    });
    await ui.act(async () => document.querySelector("input[type=radio]").click());
    await ui.act(async () =>
      document
        .querySelector("form")
        .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
    );
    await settle();
    const erro = document.querySelector(".excluir-pedido-error").textContent;
    assert.match(erro, /confirmar se o pedido foi exclu/);
    assert.doesNotMatch(erro, /Unexpected|SyntaxError|Failed to fetch/);
    assert.equal(h.deleted(), 0);
    assert.equal(posts(h.calls, "/anulacao").length, 1);
    assert.equal(
      document.querySelector(".excluir-pedido-danger").disabled,
      false,
      "operadora pode conferir e tentar de novo"
    );
  });
}

test("exclusao com erro do servidor em JSON continua mostrando a mensagem do servidor", async t => {
  await abrir(t, {
    estornoGet: () => json({ restanteTotalCentavos: 0, pernas: [] }),
    estornoPost: () => assert.fail("x"),
    anulacaoPost: () => json({ error: "Pedido ja anulado" }, false)
  });
  await ui.act(async () => document.querySelector("input[type=radio]").click());
  await ui.act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
  );
  await settle();
  assert.equal(document.querySelector(".excluir-pedido-error").textContent, "Pedido ja anulado");
});

test("erro interno da tela depois da exclusão não é descrito como perda de rede", async t => {
  const h = await abrir(t, {
    estornoGet: () => json({ restanteTotalCentavos: 0, pernas: [] }),
    estornoPost: () => assert.fail("x"),
    anulacaoPost: () => json({ ok: true }),
    onDeleted() {
      throw new TypeError("bug do consumidor");
    }
  });
  await ui.act(async () => document.querySelector("input[type=radio]").click());
  await ui.act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
  );
  await settle();
  const erro = document.querySelector(".excluir-pedido-error").textContent;
  assert.match(erro, /Erro inesperado na tela/);
  assert.doesNotMatch(erro, /confirmar se o pedido foi exclu|rede/i);
  assert.equal(posts(h.calls, "/anulacao").length, 1, "sem reenvio");
});
