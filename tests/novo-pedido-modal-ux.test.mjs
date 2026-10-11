import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Real NovoPedidoModal; only HTTP is fake. Covers (1) the double-submit hypothesis and
// (2) catalog failure with a retry that does not wipe the form.
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
      import Modal from './src/admin/Pedidos/NovoPedidoModal';
      export { act } from 'react';
      export function mount(container, props) {
        const root = createRoot(container);
        root.render(<Modal {...props} />);
        return {
          unmount: () => root.unmount(),
          update: props => root.render(<Modal {...props} />)
        };
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

const produto = {
  id: 1,
  nome: "Bolo",
  categoria: "BOLO",
  preco_centavos: 5000,
  estoque: 10,
  estoque_reservado: 0,
  ativo: 1,
  disponivel: 1
};
const json = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await ui.act(async () => tick());
};

async function abrir(t, { catalogo }) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const posts = [];
  let catalogoCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "/api/admin/produtos") {
      catalogoCalls++;
      return catalogo(catalogoCalls);
    }
    if (String(url) === "/api/admin/pedidos" && options.method === "POST") {
      posts.push(JSON.parse(options.body));
      return new Promise(() => {}); // nunca resolve: mantém o envio em voo
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  const root = document.querySelector("#root");
  let handle;
  await ui.act(async () => {
    handle = ui.mount(root, { open: true, onClose() {}, onCreated() {} });
  });
  await settle();
  t.after(async () => {
    await ui.act(async () => handle.unmount());
  });
  return { posts, catalogoCalls: () => catalogoCalls, handle };
}

test("duplo envio: dois submits em tarefas separadas geram um único POST", async t => {
  const h = await abrir(t, { catalogo: () => json({ produtos: [produto] }) });
  await ui.act(async () => document.querySelector(".nped-dropdown-trigger").click());
  await ui.act(async () => document.querySelector(".nped-dropdown-option").click());
  const form = document.querySelector("form");
  // Fora de act: eventos reais, cada um numa tarefa distinta, como cliques de um usuário.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(h.posts.length, 1);
  assert.equal(document.querySelector(".nped-btn-save").disabled, true);
});

test("falha do catálogo mostra mensagem amigável e Tentar novamente recarrega sem apagar o formulário", async t => {
  const h = await abrir(t, {
    catalogo: n => (n === 1 ? json({}, false) : json({ produtos: [produto] }))
  });
  const alerta = document.querySelector(".nped-catalogo-erro");
  assert.ok(alerta, "bloco de erro do catálogo");
  assert.match(alerta.textContent, /produtos/i);
  await ui.act(async () => {
    const campo = document.querySelector("input[type=text]");
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(
      campo,
      "Maria"
    );
    campo.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await ui.act(async () => document.querySelector(".nped-catalogo-retry").click());
  await settle();
  assert.equal(h.catalogoCalls(), 2);
  assert.equal(document.querySelector(".nped-catalogo-erro"), null);
  assert.equal(document.querySelector("input[type=text]").value, "Maria");
  await ui.act(async () => document.querySelector(".nped-dropdown-trigger").click());
  assert.ok(document.querySelector(".nped-dropdown-option"), "catálogo carregado após retry");
});

test("catálogo com resposta sem JSON usa a mesma mensagem amigável, sem erro técnico", async t => {
  await abrir(t, {
    catalogo: () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      }
    })
  });
  const alerta = document.querySelector(".nped-catalogo-erro");
  assert.ok(alerta);
  assert.doesNotMatch(alerta.textContent, /Unexpected|SyntaxError/);
});

test("catálogo sem a lista de produtos é tratado como falha, não quebra a renderização", async t => {
  await abrir(t, { catalogo: () => json({}) });
  assert.ok(document.querySelector(".nped-catalogo-erro"));
});

const clienteInput = () => document.querySelector("input[id$='-cliente']");

test("foco: retry bem-sucedido devolve o foco ao primeiro campo do formulário", async t => {
  await abrir(t, { catalogo: n => (n === 1 ? json({}, false) : json({ produtos: [produto] })) });
  const retry = document.querySelector(".nped-catalogo-retry");
  retry.focus();
  await ui.act(async () => retry.click());
  await settle();
  assert.equal(document.querySelector(".nped-catalogo-erro"), null);
  assert.equal(document.activeElement, clienteInput());
});

test("foco: retry que falha de novo foca o bloco de erro", async t => {
  await abrir(t, { catalogo: () => json({}, false) });
  await ui.act(async () => document.querySelector(".nped-catalogo-retry").click());
  await settle();
  const alerta = document.querySelector(".nped-catalogo-erro");
  assert.ok(alerta);
  assert.equal(document.activeElement, alerta);
});

test("foco: modal fechado durante o retry não recebe foco nem quebra", async t => {
  let liberar;
  const pendente = new Promise(resolve => {
    liberar = resolve;
  });
  const h = await abrir(t, {
    catalogo: n => (n === 1 ? json({}, false) : pendente)
  });
  await ui.act(async () => document.querySelector(".nped-catalogo-retry").click());
  await ui.act(async () => h.handle.update({ open: false, onClose() {}, onCreated() {} }));
  const antes = document.activeElement;
  await ui.act(async () => liberar(json({ produtos: [produto] })));
  await settle();
  assert.equal(document.querySelector(".nped-modal"), null, "modal fechado");
  assert.equal(document.activeElement, antes, "foco não foi movido");
});
