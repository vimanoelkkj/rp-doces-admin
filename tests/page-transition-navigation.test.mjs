import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://local.test/"
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.scrollTo = () => {};

test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

// Espelha o uso do App.tsx: <Routes location={location}> congela a localização em `children`,
// e é isso que o PageTransition guarda como página exibida durante a animação.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import {createRoot} from "react-dom/client";
      import {MemoryRouter, Routes, Route, useLocation, useNavigate} from "react-router-dom";
      import PageTransition from "./src/components/PageTransition";
      export {act} from "react";

      let navigate;
      let pathname = "/";
      function Probe() {
        navigate = useNavigate();
        pathname = useLocation().pathname;
        return null;
      }
      function Routing() {
        const location = useLocation();
        return (
          <PageTransition locationKey={location.key}>
            <Routes location={location}>
              <Route path="/" element={<div id="page">A</div>} />
              <Route path="/b" element={<div id="page">B</div>} />
              <Route path="/c" element={<div id="page">C</div>} />
              <Route path="/d" element={<div id="page">D</div>} />
            </Routes>
          </PageTransition>
        );
      }
      export function mount(container) {
        const root = createRoot(container);
        root.render(
          <MemoryRouter initialEntries={["/"]}>
            <Probe />
            <Routing />
          </MemoryRouter>
        );
        return root;
      }
      export const go = to => navigate(to);
      export const url = () => pathname;
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

const container = document.getElementById("root");
const FASE_MS = 350;
const fase = () => container.querySelector(".page-transition").className.match(/--(\w+)$/)[1];
const pagina = () => container.querySelector("#page").textContent;
const estado = () => [fase(), pagina(), ui.url()];

// Conta os timers de 350 ms do componente que ainda não dispararam nem foram limpos.
function espiarTimers() {
  const pendentes = new Set();
  const setReal = globalThis.setTimeout;
  const clearReal = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = setReal(() => {
      pendentes.delete(id);
      fn(...args);
    }, ms);
    if (ms === FASE_MS) pendentes.add(id);
    return id;
  };
  globalThis.clearTimeout = id => {
    pendentes.delete(id);
    return clearReal(id);
  };
  return {
    pendentes: () => pendentes.size,
    restaurar() {
      globalThis.setTimeout = setReal;
      globalThis.clearTimeout = clearReal;
    }
  };
}

// Timers simulados: cada `avancar` dispara os timers vencidos e deixa o React reagendar o próximo.
async function montar(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timers = espiarTimers();
  let root;
  await ui.act(async () => {
    root = ui.mount(container);
  });
  return {
    timers,
    ir: to => ui.act(async () => ui.go(to)),
    avancar: ms =>
      ui.act(async () => {
        t.mock.timers.tick(ms);
      }),
    async desmontar() {
      await ui.act(async () => root.unmount());
      container.innerHTML = "";
      timers.restaurar();
      t.mock.timers.reset();
    }
  };
}

test("navegação normal anima out → in → idle e exibe o destino, inclusive na navegação seguinte", async t => {
  const { ir, avancar, desmontar } = await montar(t);
  try {
    assert.deepEqual(estado(), ["idle", "A", "/"]);

    await ir("/b");
    assert.deepEqual(estado(), ["out", "A", "/b"], "a página antiga sai antes de trocar");
    await avancar(FASE_MS);
    assert.deepEqual(estado(), ["in", "B", "/b"]);
    await avancar(FASE_MS);
    assert.deepEqual(estado(), ["idle", "B", "/b"]);

    await ir("/c");
    await avancar(FASE_MS);
    await avancar(FASE_MS);
    assert.deepEqual(estado(), ["idle", "C", "/c"]);
  } finally {
    await desmontar();
  }
});

test("navegar de novo durante phase=out: a mais recente vence, sem segunda animação", async t => {
  const { ir, avancar, desmontar } = await montar(t);
  try {
    await ir("/b");
    await avancar(100);
    assert.deepEqual(estado(), ["out", "A", "/b"]);

    await ir("/c");
    await avancar(FASE_MS - 100);
    assert.deepEqual(estado(), ["in", "C", "/c"], "a página intermediária B é pulada");
    await avancar(FASE_MS);
    assert.deepEqual(
      estado(),
      ["idle", "C", "/c"],
      "uma única animação: 700 ms desde a primeira navegação"
    );
  } finally {
    await desmontar();
  }
});

test("navegar de novo durante phase=in: ao terminar a animação o conteúdo alcança a URL", async t => {
  const { ir, avancar, desmontar } = await montar(t);
  try {
    await ir("/b");
    await avancar(FASE_MS);
    await avancar(100);
    assert.deepEqual(estado(), ["in", "B", "/b"]);

    await ir("/c");
    assert.deepEqual(estado(), ["in", "B", "/c"], "a animação em curso não é interrompida");
    await avancar(FASE_MS - 100);
    await avancar(FASE_MS);
    await avancar(FASE_MS);
    assert.deepEqual(estado(), ["idle", "C", "/c"]);
  } finally {
    await desmontar();
  }
});

test("várias navegações rápidas: o destino final prevalece e nenhum timer fica órfão", async t => {
  const { ir, avancar, desmontar, timers } = await montar(t);
  try {
    // Rajada durante phase=out.
    await ir("/b");
    await avancar(100);
    await ir("/c");
    await avancar(100);
    await ir("/d");
    await avancar(FASE_MS - 200);
    assert.deepEqual(estado(), ["in", "D", "/d"]);

    // Nova rajada durante phase=in, terminando de volta em uma rota intermediária anterior.
    await avancar(100);
    await ir("/b");
    await avancar(50);
    await ir("/c");
    assert.equal(ui.url(), "/c");

    let passos = 0;
    while (fase() !== "idle" && passos < 4) {
      await avancar(FASE_MS);
      passos += 1;
    }
    assert.deepEqual(estado(), ["idle", "C", "/c"], "estabiliza na localização atual");
    assert.ok(passos <= 3, `estabilizou em ${passos} passos de ${FASE_MS} ms`);
    assert.equal(timers.pendentes(), 0, "nenhum timer de fase sobra depois de estabilizar");

    await avancar(10 * FASE_MS);
    assert.deepEqual(estado(), ["idle", "C", "/c"], "nada muda sozinho depois de estabilizar");
  } finally {
    await desmontar();
  }
});

test("voltar à origem durante phase=out termina exibindo a origem", async t => {
  const { ir, avancar, desmontar } = await montar(t);
  try {
    await ir("/b");
    await avancar(100);
    await ir("/");
    await avancar(FASE_MS - 100);
    await avancar(FASE_MS);
    assert.deepEqual(estado(), ["idle", "A", "/"]);
  } finally {
    await desmontar();
  }
});

test("mudança de hash na mesma rota não anima; desmontar durante a animação não deixa timers", async t => {
  const { ir, avancar, desmontar, timers } = await montar(t);
  try {
    await ir("/#secao");
    assert.deepEqual(estado(), ["idle", "A", "/"], "só o pathname dispara a animação");
    assert.equal(timers.pendentes(), 0);

    await ir("/b");
    await avancar(100);
    assert.equal(timers.pendentes(), 1, "a fase out mantém exatamente um timer");
  } finally {
    await desmontar();
  }
  assert.equal(timers.pendentes(), 0, "desmontar limpa o timer da fase em curso");
});
