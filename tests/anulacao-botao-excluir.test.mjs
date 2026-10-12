import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Botão "Excluir pedido": não promete uma exclusão que o servidor vai recusar. O motivo vem do
// servidor (`anulacaoBloqueio`, ver tests/anulacao-elegibilidade-visual.test.mjs).

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://local.test" });
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
test.after(() => {
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
      import Header from './src/admin/Pedidos/PedidoDetalhe/PedidoHeader';
      export { act } from 'react';
      export function mount(container, props) {
        const root = createRoot(container);
        root.render(<Header {...props} />);
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

async function renderizar(t, excluirBloqueio) {
  let excluiu = 0;
  let handle;
  await ui.act(async () => {
    handle = ui.mount(document.querySelector("#root"), {
      orderId: 1,
      pedido: {
        id: 1,
        cliente_nome: "Cliente",
        status_pedido: "NOVO",
        arquivado: 0,
        status_pagamento: "PAGO"
      },
      anulado: false,
      editandoNome: false,
      clienteNome: "Cliente",
      salvandoNome: false,
      nomeError: null,
      alterando: false,
      arquivando: false,
      onIniciarEdicaoNome() {},
      onCancelarEdicaoNome() {},
      onSalvarNome() {},
      onClienteNomeChange() {},
      onAlterarStatus() {},
      onArquivar() {},
      onExcluir() {
        excluiu++;
      },
      excluirBloqueio,
      onClose() {}
    });
  });
  t.after(async () => ui.act(async () => handle.unmount()));
  return { excluiu: () => excluiu };
}
const botaoExcluir = () =>
  [...document.querySelectorAll(".pedmodal-more button")].find(
    b => b.textContent === "Excluir pedido"
  );

test("botão: com bloqueio do servidor fica desabilitado, explica o motivo e não dispara a exclusão", async t => {
  const h = await renderizar(t, "Histórico Pix não quitado.");
  const botao = botaoExcluir();
  assert.equal(botao.disabled, true);
  assert.equal(botao.title, "Histórico Pix não quitado.");
  assert.match(
    document.querySelector(".pedmodal-more-aviso").textContent,
    /Histórico Pix não quitado/
  );
  await ui.act(async () => botao.click());
  assert.equal(h.excluiu(), 0);
});

test("botão: sem bloqueio fica habilitado e abre a exclusão", async t => {
  const h = await renderizar(t, null);
  const botao = botaoExcluir();
  assert.equal(botao.disabled, false);
  assert.equal(document.querySelector(".pedmodal-more-aviso"), null);
  await ui.act(async () => botao.click());
  assert.equal(h.excluiu(), 1);
});
