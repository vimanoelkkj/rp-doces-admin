import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><button id="sentinel">Antes</button><div id="root"></div></body></html>',
  { url: "https://local.test" }
);

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
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
dom.window.matchMedia = query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false
});
dom.window.scrollTo = () => {};

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
      import { act } from "react";
      import { createRoot } from "react-dom/client";
      import { MemoryRouter } from "react-router-dom";
      import Header from "./src/components/Header";
      export { act };

      export function mount(container) {
        const root = createRoot(container);
        root.render(
          <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Header />
          </MemoryRouter>,
        );
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
  loader: { ".css": "empty", ".png": "dataurl" }
});

const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

async function flush() {
  await ui.act(async () => new Promise(resolve => setTimeout(resolve, 25)));
}

function activateWithKeyboard(button, key) {
  button.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
  button.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key, bubbles: true }));
  button.click();
}

test("Header: overlay fecha menu por Enter ou Espaço e restaura foco no botão de abertura", async () => {
  const sentinel = document.getElementById("sentinel");
  const container = document.getElementById("root");
  sentinel.focus();

  let root;
  await ui.act(async () => {
    root = ui.mount(container);
  });
  await flush();

  const initialFocusPreserved = document.activeElement === sentinel;
  const menuButton = container.querySelector(".mobile-menu-btn");
  const overlay = document.querySelector(".mobile-menu-overlay");
  assert.ok(menuButton);
  assert.ok(overlay);

  const focusAfterActivation = [];
  for (const key of ["Enter", " "]) {
    await ui.act(async () => {
      menuButton.focus();
      menuButton.click();
    });
    await flush();
    assert.equal(menuButton.getAttribute("aria-expanded"), "true");
    for (const svg of document.querySelectorAll("svg")) {
      assert.equal(svg.getAttribute("aria-hidden"), "true", "ícones do Header são decorativos");
    }

    overlay.focus();
    assert.equal(document.activeElement, overlay);
    await ui.act(async () => activateWithKeyboard(overlay, key));
    await flush();

    assert.equal(menuButton.getAttribute("aria-expanded"), "false");
    focusAfterActivation.push({ key, restored: document.activeElement === menuButton });
  }

  await ui.act(async () => {
    menuButton.focus();
    menuButton.click();
  });
  await flush();
  overlay.focus();
  await ui.act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  });
  await flush();
  const escapeClosed = menuButton.getAttribute("aria-expanded") === "false";
  const escapeFocusRestored = document.activeElement === menuButton;

  await ui.act(async () => root.unmount());

  assert.equal(initialFocusPreserved, true, "a montagem não deve mover o foco");
  for (const { key, restored } of focusAfterActivation) {
    assert.equal(restored, true, `foco deve voltar após ${JSON.stringify(key)}`);
  }
  assert.equal(escapeClosed, true, "Escape deve continuar fechando o menu");
  assert.equal(escapeFocusRestored, true, "Escape deve continuar restaurando o foco");
});
