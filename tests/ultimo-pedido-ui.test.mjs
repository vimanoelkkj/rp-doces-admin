import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Monta as páginas reais (Router, Providers, effects) num DOM simulado; nada de copiar a lógica.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://local.test"
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
  "Element",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
  "localStorage"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const raf = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
dom.window.requestAnimationFrame = raf;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
dom.window.matchMedia = query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false
});
globalThis.matchMedia = dom.window.matchMedia;
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
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter, Route, Routes, useLocation, useNavigationType} from 'react-router-dom';
      import {CartProvider} from './src/context/CartContext';
      import {StoreThemeProvider} from './src/context/StoreThemeContext';
      import Homepage from './src/pages/Homepage';
      import AcompanharPedido from './src/pages/AcompanharPedido';
      import PedidoConfirmado from './src/pages/PedidoConfirmado';
      export {act} from 'react';
      export let currentPath;
      export let navigationType;

      function Probe() {
        const location = useLocation();
        currentPath = location.pathname;
        navigationType = useNavigationType();
        return null;
      }

      function Providers({children, initialEntries}) {
        return (
          <MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}} initialEntries={initialEntries}>
            <StoreThemeProvider><CartProvider><Probe />{children}</CartProvider></StoreThemeProvider>
          </MemoryRouter>
        );
      }

      export function mountHomepage(container) {
        const root = createRoot(container);
        root.render(
          <Providers initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<Homepage />} />
              <Route path="/pedido/:token" element={<p>Acompanhamento</p>} />
            </Routes>
          </Providers>,
        );
        return root;
      }

      export function mountTracking(container, token) {
        const root = createRoot(container);
        root.render(
          <Providers initialEntries={['/pedido/' + token]}>
            <Routes><Route path="/pedido/:token" element={<AcompanharPedido />} /></Routes>
          </Providers>,
        );
        return root;
      }

      export function mountConfirmed(container, state) {
        const root = createRoot(container);
        root.render(
          <Providers initialEntries={[{pathname:'/pedido-confirmado', state}]}>
            <Routes>
              <Route path="/pedido-confirmado" element={<PedidoConfirmado />} />
              <Route path="/pedido/:token" element={<p>Acompanhamento</p>} />
              <Route path="*" element={<p>Home</p>} />
            </Routes>
          </Providers>,
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
  loader: { ".css": "empty", ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl" }
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=ultimo-pedido-ui-bundle.mjs`).toString("base64")}`
);

const container = document.getElementById("root");
const storeConfig = {
  days: [],
  openTime: "09:00",
  closeTime: "20:00",
  localName: "R&P Doces",
  address: "",
  mapsLink: "",
  deliveryStatus: "unavailable",
  whatsapp: "11999999999",
  defaultMessage: ""
};
const flush = async () => {
  for (let i = 0; i < 3; i += 1) {
    await ui.act(async () => {
      await new Promise(setImmediate);
    });
  }
};
async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = "";
}

const CHAVE = "rp-doces:ultimo-pedido:v1";
const TOKEN = "token-publico";
const OUTRO_TOKEN = "outro-token";
const HORA = 60 * 60 * 1000;
const gravar = (token = TOKEN, salvoEm = Date.now()) =>
  localStorage.setItem(CHAVE, JSON.stringify({ tokenPublico: token, salvoEm }));
const gravado = () => localStorage.getItem(CHAVE);

beforeEach(() => localStorage.clear());

// API pública do pedido: GET /api/pedido (detalhe), POST /api/pedido-status (reconciliação).
function mockApi(
  t,
  {
    pedido = { statusPagamento: "PAGO", statusPedido: "PREPARANDO" },
    reconciliado = pedido,
    detalheHttp = 200,
    semRede = false
  } = {}
) {
  t.mock.method(globalThis, "fetch", async url => {
    const alvo = String(url);
    if (alvo === "/api/config") return Response.json({ config: storeConfig });
    if (alvo.startsWith("/api/pedido-status")) {
      return Response.json({ ...reconciliado, estoquePendente: false });
    }
    if (alvo.startsWith("/api/pedido")) {
      if (semRede) throw new TypeError("Failed to fetch");
      if (detalheHttp === 404) {
        return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
      }
      return Response.json({
        pedidoId: 7,
        clienteNome: "Cliente",
        valorTotalCentavos: 1500,
        criadoEm: "2026-09-28T10:00:00Z",
        itens: [],
        ...pedido,
        estoquePendente: false
      });
    }
    return Response.json({ ok: true });
  });
}

async function acompanhar(token) {
  let root;
  await ui.act(async () => {
    root = ui.mountTracking(container, token);
  });
  await flush();
  return root;
}

// ───────────────────────── AcompanharPedido: limpeza do registro ─────────────────────────

for (const [statusPagamento, statusPedido, limpa] of [
  ["PAGO", "ENTREGUE", true],
  ["PAGO", "CANCELADO", true],
  ["CANCELADO", "NOVO", true],
  ["REEMBOLSADO", "NOVO", true],
  ["PENDENTE", "NOVO", false],
  ["PAGO", "NOVO", false],
  ["PAGO", "PREPARANDO", false],
  ["PAGO", "PRONTO", false],
  // Um Pix tardio ainda pode virar PAGO: EXPIRADO fica até o TTL.
  ["EXPIRADO", "NOVO", false]
]) {
  test(`AcompanharPedido: ${statusPagamento}/${statusPedido} ${limpa ? "remove" : "mantém"} o último pedido`, async t => {
    gravar();
    mockApi(t, { pedido: { statusPagamento, statusPedido } });
    const root = await acompanhar(TOKEN);
    try {
      assert.equal(gravado() === null, limpa);
    } finally {
      await unmount(root);
    }
  });
}

test("AcompanharPedido: estado terminal vindo da reconciliação (POST) também remove o registro", async t => {
  gravar();
  mockApi(t, {
    pedido: { statusPagamento: "PAGO", statusPedido: "PRONTO" },
    reconciliado: { statusPagamento: "PAGO", statusPedido: "ENTREGUE" }
  });
  const root = await acompanhar(TOKEN);
  try {
    assert.equal(gravado(), null);
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido: 404 do mesmo token guardado remove o registro", async t => {
  gravar();
  mockApi(t, { detalheHttp: 404 });
  const root = await acompanhar(TOKEN);
  try {
    assert.match(container.textContent, /Pedido não encontrado/);
    assert.equal(gravado(), null);
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido: 404 de outro token não toca no registro", async t => {
  gravar(TOKEN);
  mockApi(t, { detalheHttp: 404 });
  const root = await acompanhar(OUTRO_TOKEN);
  try {
    assert.match(container.textContent, /Pedido não encontrado/);
    assert.equal(JSON.parse(gravado()).tokenPublico, TOKEN);
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido: estado terminal de outro pedido não derruba o último pedido guardado", async t => {
  gravar(TOKEN);
  mockApi(t, { pedido: { statusPagamento: "PAGO", statusPedido: "ENTREGUE" } });
  const root = await acompanhar(OUTRO_TOKEN);
  try {
    assert.equal(JSON.parse(gravado()).tokenPublico, TOKEN);
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido: falha de rede nunca remove o registro", async t => {
  gravar();
  mockApi(t, { semRede: true });
  const root = await acompanhar(TOKEN);
  try {
    assert.match(container.textContent, /Failed to fetch/);
    assert.equal(JSON.parse(gravado()).tokenPublico, TOKEN);
  } finally {
    await unmount(root);
  }
});

// ───────────────────────── PedidoConfirmado sem location.state ─────────────────────────

async function confirmar(state) {
  let root;
  await ui.act(async () => {
    root = ui.mountConfirmed(container, state);
  });
  await flush();
  return root;
}

test("PedidoConfirmado sem state e com último pedido válido vai (replace) para o acompanhamento", async t => {
  gravar(TOKEN);
  mockApi(t);
  const root = await confirmar(undefined);
  try {
    assert.equal(ui.currentPath, `/pedido/${TOKEN}`);
    assert.equal(ui.navigationType, "REPLACE");
    assert.equal(JSON.parse(gravado()).tokenPublico, TOKEN, "o registro segue guardado");
  } finally {
    await unmount(root);
  }
});

test("PedidoConfirmado sem state e sem registro volta para a Home, como antes", async t => {
  mockApi(t);
  const root = await confirmar(undefined);
  try {
    assert.equal(ui.currentPath, "/");
    assert.equal(ui.navigationType, "REPLACE");
  } finally {
    await unmount(root);
  }
});

test("PedidoConfirmado sem state e com registro vencido ou corrompido volta para a Home e o remove", async t => {
  for (const [caso, registro] of [
    ["vencido", JSON.stringify({ tokenPublico: TOKEN, salvoEm: Date.now() - 49 * HORA })],
    ["corrompido", "{nao-e-json"],
    ["com dado a mais", JSON.stringify({ tokenPublico: TOKEN, salvoEm: Date.now(), nome: "Maria" })]
  ]) {
    localStorage.setItem(CHAVE, registro);
    mockApi(t);
    const root = await confirmar(undefined);
    try {
      assert.equal(ui.currentPath, "/", caso);
      assert.equal(gravado(), null, `${caso}: registro removido`);
    } finally {
      await unmount(root);
    }
  }
});

test("PedidoConfirmado com state continua na confirmação, mesmo havendo último pedido guardado", async t => {
  gravar(OUTRO_TOKEN);
  mockApi(t);
  const state = {
    pedidoId: 8,
    tokenPublico: TOKEN,
    items: [{ id: 1, name: "Pudim", price: 12, image: "", quantity: 1 }],
    totalCentavos: 1200
  };
  const root = await confirmar(state);
  try {
    assert.equal(ui.currentPath, "/pedido-confirmado");
    assert.match(container.textContent, /Pagamento aprovado/);
  } finally {
    await unmount(root);
  }
});

// ───────────────────────── UltimoPedidoLink na Home ─────────────────────────

function mockHome(t) {
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") return Response.json({ config: storeConfig });
    if (url === "/api/produtos") return Response.json({ produtos: [] });
    return Response.json({ ok: true });
  });
}

async function abrirHome() {
  let root;
  await ui.act(async () => {
    root = ui.mountHomepage(container);
  });
  await flush();
  return root;
}

const linksDoUltimoPedido = () => [...container.querySelectorAll(".ultimo-pedido-link")];

test("Home mostra um único 'Acompanhar último pedido' para /pedido/:token quando há registro válido", async t => {
  gravar(TOKEN);
  mockHome(t);
  const root = await abrirHome();
  try {
    const links = linksDoUltimoPedido();
    assert.equal(links.length, 1);
    assert.equal(links[0].tagName, "A");
    assert.equal(links[0].textContent.trim(), "Acompanhar último pedido");
    assert.equal(links[0].getAttribute("href"), `/pedido/${TOKEN}`);
  } finally {
    await unmount(root);
  }
});

test("Home: o link leva ao acompanhamento do pedido guardado", async t => {
  gravar(TOKEN);
  mockHome(t);
  const root = await abrirHome();
  try {
    await ui.act(async () => {
      linksDoUltimoPedido()[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      );
    });
    assert.equal(ui.currentPath, `/pedido/${TOKEN}`);
    assert.match(container.textContent, /Acompanhamento/);
  } finally {
    await unmount(root);
  }
});

test("Home: o link fica nas ações do Hero, logo depois do CTA principal, com ícones decorativos ocultos", async t => {
  gravar(TOKEN);
  mockHome(t);
  const root = await abrirHome();
  try {
    const cta = container.querySelector(".hero-actions .hero-cta");
    const link = linksDoUltimoPedido()[0];
    assert.ok(cta, "o CTA principal segue nas ações do Hero");
    assert.ok(link.previousElementSibling === cta, "logo depois do CTA principal");

    // O nome acessível é só o texto: o ícone do pedido e a seta são decorativos.
    assert.equal(link.textContent.trim(), "Acompanhar último pedido");
    const icones = [...link.querySelectorAll("svg")];
    assert.equal(icones.length, 2);
    for (const svg of icones) assert.equal(svg.getAttribute("aria-hidden"), "true");
  } finally {
    await unmount(root);
  }
});

test("Home sem registro não mostra o link nem deixa nada além do CTA nas ações do Hero", async t => {
  mockHome(t);
  const root = await abrirHome();
  try {
    assert.equal(linksDoUltimoPedido().length, 0);
    const acoes = container.querySelector(".hero-actions");
    assert.equal(acoes.children.length, 1);
    assert.ok(acoes.children[0].classList.contains("hero-cta"));
  } finally {
    await unmount(root);
  }
});

test("UltimoPedidoLink.css usa só tokens do tema e respeita prefers-reduced-motion", async () => {
  const css = await readFile("src/components/UltimoPedidoLink.css", "utf8");
  assert.doesNotMatch(
    css,
    /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/,
    "sem cor literal: só var(--store-*)"
  );

  const reduzido = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(reduzido, "bloco de movimento reduzido");
  assert.match(reduzido[1], /transition:\s*none/);
  assert.match(reduzido[1], /transform:\s*none/);
});

test("Home com registro vencido, corrompido ou com dado a mais não mostra o link e o remove", async t => {
  for (const [caso, registro] of [
    ["vencido", JSON.stringify({ tokenPublico: TOKEN, salvoEm: Date.now() - 49 * HORA })],
    ["corrompido", "{nao-e-json"],
    ["com dado a mais", JSON.stringify({ tokenPublico: TOKEN, salvoEm: Date.now(), nome: "Maria" })]
  ]) {
    localStorage.setItem(CHAVE, registro);
    mockHome(t);
    const root = await abrirHome();
    try {
      assert.equal(linksDoUltimoPedido().length, 0, caso);
      assert.equal(gravado(), null, `${caso}: registro removido`);
    } finally {
      await unmount(root);
    }
  }
});
