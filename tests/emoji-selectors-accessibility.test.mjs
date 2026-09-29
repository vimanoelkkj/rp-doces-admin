import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://local.test/admin"
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
  "MouseEvent"
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
      import CategoriasModal from "./src/admin/Produtos/CategoriasModal";
      import NovoProdutoModal from "./src/admin/Produtos/NovoProdutoModal";
      export {act} from "react";

      const noop = () => {};
      export function mount(container, component) {
        const root = createRoot(container);
        const element = {
          categorias: <CategoriasModal open onClose={noop} />,
          novoProduto: <NovoProdutoModal open onClose={noop} />,
          duasCategorias: <><CategoriasModal open onClose={noop} /><CategoriasModal open onClose={noop} /></>,
        }[component];
        root.render(element);
        return root;
      }
    `
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

const postRequests = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === "POST") postRequests.push({ url: String(url), init });
  return Response.json({ categorias: [] });
};

async function render(component) {
  const container = document.getElementById("root");
  postRequests.length = 0;
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

function assertNativeRadioGroup(selector, initiallySelected) {
  const fieldset = document.querySelector(selector);
  assert.ok(fieldset instanceof dom.window.HTMLFieldSetElement);
  assert.equal(fieldset.querySelector("legend")?.textContent.trim(), "EMOJI");

  const radios = [...fieldset.querySelectorAll('input[type="radio"]')];
  assert.equal(radios.length, 10);
  assert.equal(new Set(radios.map(radio => radio.name)).size, 1);
  assert.ok(radios[0].name, "o grupo precisa de um nome exclusivo");
  assert.equal(radios.filter(radio => radio.checked).length, initiallySelected ? 1 : 0);

  for (const radio of radios) {
    assert.ok(radio.id);
    assert.equal(radio.labels.length, 1);
    assert.ok(radio.labels[0].textContent.trim(), "cada opção precisa de nome acessível");
    assert.equal(
      radio.labels[0].querySelector("svg")?.getAttribute("aria-hidden"),
      "true",
      "a ilustração não deve repetir o nome textual da opção"
    );
  }

  radios[0].focus();
  assert.equal(document.activeElement, radios[0], "radios nativos devem permanecer focáveis");
  return radios;
}

test("categorias usa radios nativos, anuncia a seleção e permite alterá-la", async () => {
  const unmount = await render("categorias");
  try {
    const radios = assertNativeRadioGroup(".catm-emoji-fieldset", true);
    await ui.act(async () => radios[1].click());
    assert.equal(radios[0].checked, false);
    assert.equal(radios[1].checked, true);
  } finally {
    await unmount();
  }
});

test("novo produto preserva seleção inicial vazia e radio não submete o formulário", async () => {
  const unmount = await render("novoProduto");
  try {
    const radios = assertNativeRadioGroup(".np-emoji-fieldset", false);
    await ui.act(async () => radios[2].click());
    assert.equal(radios.filter(radio => radio.checked).length, 1);
    assert.equal(radios[2].checked, true);
    assert.equal(postRequests.length, 0);
  } finally {
    await unmount();
  }
});

test("instâncias simultâneas mantêm IDs e grupos de radio independentes", async () => {
  const unmount = await render("duasCategorias");
  try {
    const groups = [...document.querySelectorAll(".catm-emoji-fieldset")];
    assert.equal(groups.length, 2);
    const radios = groups.flatMap(group => [...group.querySelectorAll('input[type="radio"]')]);
    assert.equal(new Set(radios.map(radio => radio.id)).size, radios.length);
    assert.equal(new Set(groups.map(group => group.querySelector("input").name)).size, 2);
  } finally {
    await unmount();
  }
});

test("estilos preservam a grade e tornam o foco do radio visível", async () => {
  const [categoriasCss, produtoCss, darkCss] = await Promise.all([
    readFile("src/admin/Produtos/CategoriasModal.css", "utf8"),
    readFile("src/admin/Produtos/NovoProdutoModal.css", "utf8"),
    readFile("src/admin/theme/admin-dark-theme.css", "utf8")
  ]);

  assert.match(categoriasCss, /\.catm-emoji-grid\s*{[^}]*repeat\(5, 1fr\)/s);
  assert.match(produtoCss, /\.np-emoji-grid\s*{[^}]*repeat\(5, 1fr\)/s);
  assert.match(categoriasCss, /\.catm-emoji-radio:focus-visible \+ \.catm-emoji-item/);
  assert.match(produtoCss, /\.np-emoji-radio:focus-visible \+ \.np-emoji-item/);
  assert.match(darkCss, /\.catm-emoji-radio:focus-visible \+ \.catm-emoji-item/);
  assert.match(darkCss, /\.np-emoji-radio:focus-visible \+ \.np-emoji-item/);
});
