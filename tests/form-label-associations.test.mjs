import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://local.test/admin",
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "localStorage",
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
dom.window.scrollTo = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    contents: `
      import {createRoot} from "react-dom/client";
      import AlterarSenhaModal from "./src/admin/Administradores/AlterarSenhaModal";
      import NovoAdminModal from "./src/admin/Administradores/NovoAdminModal";
      import GastoModal from "./src/admin/Despesas/GastoModal";
      import NovoPedidoModal from "./src/admin/Pedidos/NovoPedidoModal";
      import CategoriasModal from "./src/admin/Produtos/CategoriasModal";
      import NovoProdutoModal from "./src/admin/Produtos/NovoProdutoModal";
      import Checkout from "./src/pages/Checkout";
      import {CartProvider} from "./src/context/CartContext";
      import {MemoryRouter} from "react-router-dom";
      export {act} from "react";

      const noop = () => {};
      export function mount(container, component) {
        const root = createRoot(container);
        const element = {
          alterarSenha: <AlterarSenhaModal adminId={1} adminNome="Ana" isSelf onClose={noop} onSaved={noop} />,
          novoAdmin: <NovoAdminModal open onClose={noop} onSaved={noop} />,
          gasto: <GastoModal modo="criar" descricoesConhecidas={[]} onClose={noop} onSaved={noop} />,
          novoPedido: <NovoPedidoModal open onClose={noop} />,
          categorias: <CategoriasModal open onClose={noop} />,
          novoProduto: <NovoProdutoModal open onClose={noop} />,
          checkout: <MemoryRouter><CartProvider><Checkout /></CartProvider></MemoryRouter>,
        }[component];
        root.render(element);
        return root;
      }
    `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty", ".png": "dataurl" },
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("/categorias")) return Response.json({ categorias: [] });
  if (target.includes("/admin/produtos")) return Response.json({ produtos: [] });
  if (target.endsWith("/api/produtos")) {
    return Response.json({
      produtos: [{
        id: 1,
        nome: "Bolo",
        categoria: "BOLO",
        categoria_nome: "Bolo",
        descricao: "Doce",
        destaque: 0,
        ordem: 1,
        estoque: 10,
        estoque_reservado: 0,
        image_key: null,
        preco_centavos: 1000,
        preco_promocional_centavos: null,
        promocao_ativa: 0,
        promocao_inicio: null,
        promocao_fim: null,
      }],
    });
  }
  return Response.json({});
};

async function render(component) {
  const container = document.getElementById("root");
  localStorage.clear();
  if (component === "checkout") {
    localStorage.setItem(
      "rp-doces:cart",
      JSON.stringify([{ id: 1, name: "Bolo", price: 10, image: "", quantity: 1 }]),
    );
  }
  let root;
  await ui.act(async () => {
    root = ui.mount(container, component);
  });
  await ui.act(async () => new Promise(setImmediate));
  return async () => {
    await ui.act(async () => root.unmount());
    container.innerHTML = "";
  };
}

for (const component of [
  "alterarSenha",
  "novoAdmin",
  "gasto",
  "novoPedido",
  "categorias",
  "novoProduto",
  "checkout",
]) {
  test(`${component}: labels apontam para controles e IDs não se repetem`, async () => {
    const unmount = await render(component);
    try {
      const labels = [...document.querySelectorAll("label")];
      assert.ok(labels.length > 0, "o formulário deve expor labels nativos");
      for (const label of labels) {
        assert.ok(label.control, `label sem controle: ${label.textContent.trim()}`);
      }

      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      assert.equal(new Set(ids).size, ids.length, "IDs do modal devem ser únicos");

      for (const element of document.querySelectorAll("[aria-labelledby]")) {
        for (const id of element.getAttribute("aria-labelledby").split(" ")) {
          assert.ok(document.getElementById(id), `aria-labelledby aponta para ID ausente: ${id}`);
        }
      }
    } finally {
      await unmount();
    }
  });
}
