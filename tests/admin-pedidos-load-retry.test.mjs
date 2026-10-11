import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Real AdminPedidos list; only HTTP is fake. Load failures show a friendly message with a retry.
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
      import { MemoryRouter } from 'react-router-dom';
      import Modal from './src/admin/Pedidos/AdminPedidos';
      export { act } from 'react';
      export function mount(container, props) {
        const root = createRoot(container);
        root.render(<MemoryRouter><Modal {...props} /></MemoryRouter>);
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

const counts = {
  todos: 1,
  hoje: 0,
  novos: 1,
  em_producao: 0,
  prontos: 0,
  entregues: 0,
  arquivados: 0
};
const pedido = {
  id: 5,
  cliente_nome: "Maria",
  valor_total_centavos: 1000,
  status_pedido: "NOVO",
  criado_em: "2026-01-01 10:00:00",
  financeiro: { status: "PENDENTE", totalCentavos: 1000, pagoCentavos: 0, saldoCentavos: 1000 }
};
const lista = { pedidos: [pedido], total: 1, page: 1, totalPages: 1, counts };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await ui.act(async () => tick());
};

async function abrir(t, listaGet) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let listCalls = 0;
  globalThis.fetch = async (url, _options = {}) => {
    if (String(url) === "/api/admin/pedidos/reconciliar")
      return { ok: true, json: async () => ({}) };
    if (String(url).startsWith("/api/admin/pedidos?")) return listaGet(++listCalls);
    assert.fail(`Unexpected request: ${url}`);
  };
  let handle;
  await ui.act(async () => {
    handle = ui.mount(document.querySelector("#root"), {});
  });
  await settle();
  t.after(async () => {
    await ui.act(async () => handle.unmount());
  });
  return { listCalls: () => listCalls };
}

for (const modo of ["rede", "sem-json", "http"]) {
  test(`lista ${modo}: mensagem amigavel e Tentar novamente recarrega`, async t => {
    const h = await abrir(t, n => {
      if (n === 1) {
        if (modo === "rede") return Promise.reject(new TypeError("Failed to fetch"));
        if (modo === "http") return { ok: false, json: async () => ({}) };
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          }
        };
      }
      return { ok: true, json: async () => structuredClone(lista) };
    });
    const alerta = document.querySelector(".ped-empty-message[role=alert]");
    assert.ok(alerta, "bloco de erro");
    assert.doesNotMatch(alerta.textContent, /Failed to fetch|Unexpected|SyntaxError/);
    const retry = document.querySelector(".ped-retry-btn");
    assert.ok(retry, "botao Tentar novamente");
    await ui.act(async () => retry.click());
    await settle();
    assert.equal(h.listCalls(), 2);
    assert.equal(document.querySelector(".ped-retry-btn"), null);
    assert.match(document.body.textContent, /Maria/);
  });
}
