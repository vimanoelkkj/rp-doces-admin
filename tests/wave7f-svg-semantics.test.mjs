import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

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
      import {MemoryRouter, Route, Routes} from 'react-router-dom';
      import {CartProvider} from './src/context/CartContext';
      import {StoreThemeProvider} from './src/context/StoreThemeContext';
      import Homepage from './src/pages/Homepage';
      import AcompanharPedido from './src/pages/AcompanharPedido';
      import PedidoConfirmado from './src/pages/PedidoConfirmado';
      export {act} from 'react';

      function Providers({children, initialEntries}) {
        return (
          <MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}} initialEntries={initialEntries}>
            <StoreThemeProvider><CartProvider>{children}</CartProvider></StoreThemeProvider>
          </MemoryRouter>
        );
      }

      export function mountHomepage(container) {
        const root = createRoot(container);
        root.render(<Providers initialEntries={['/']}><Homepage /></Providers>);
        return root;
      }

      export function mountTracking(container) {
        const root = createRoot(container);
        root.render(
          <Providers initialEntries={['/pedido/token-publico']}>
            <Routes><Route path="/pedido/:token" element={<AcompanharPedido />} /></Routes>
          </Providers>,
        );
        return root;
      }

      export function mountConfirmed(container, state) {
        const root = createRoot(container);
        root.render(
          <Providers initialEntries={[{pathname:'/pedido-confirmado',state}]}>
            <PedidoConfirmado />
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
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=wave7f-bundle.mjs`).toString("base64")}`
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
const flush = () =>
  ui.act(async () => {
    await new Promise(setImmediate);
    await new Promise(setImmediate);
  });

async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = "";
}

function timelineSteps() {
  return [...container.querySelectorAll(".confirmado-timeline .tl-step")];
}

function assertCurrentStep(index) {
  assert.deepEqual(
    timelineSteps().map(step => step.getAttribute("aria-current")),
    [0, 1, 2, 3].map(i => (i === index ? "step" : null))
  );
}

function assertCompletedIconsAreHidden() {
  for (const svg of container.querySelectorAll(".confirmado-timeline .tl-step--done svg")) {
    assert.equal(svg.getAttribute("aria-hidden"), "true");
  }
}

test("favicon identifica a R&P Doces sem alterar sua geometria", async () => {
  const source = await readFile("public/favicon.svg", "utf8");
  const favicon = new JSDOM(source, { contentType: "image/svg+xml" });
  const svg = favicon.window.document.documentElement;
  assert.equal(svg.getAttribute("viewBox"), "0 0 20 20");
  assert.equal(svg.querySelector("title")?.textContent, "R&P Doces");
  assert.equal(svg.querySelectorAll("path").length, 1);
  assert.equal(svg.querySelectorAll("circle").length, 3);
  favicon.window.close();
});

test("Homepage preserva os cinco conceitos em texto e oculta somente suas ilustracoes redundantes", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") {
      return Response.json({ config: storeConfig });
    }
    if (url === "/api/produtos") return Response.json({ produtos: [] });
    return Response.json({ ok: true });
  });
  let root;
  await ui.act(async () => {
    root = ui.mountHomepage(container);
  });
  await flush();
  try {
    const blocks = [
      [".trust-card:nth-child(1)", "Ingredientes Premium"],
      [".trust-card:nth-child(2)", "Feito com Carinho"],
      [".journey-step--1", "Seu pedido, do seu jeito"],
      [".journey-step--2", "Uma pausa para saborear"],
      [".journey-step--3", "Um carinho que acompanha"]
    ];
    for (const [selector, text] of blocks) {
      const block = container.querySelector(selector);
      assert.match(block.textContent, new RegExp(text));
      assert.equal(block.querySelector("svg").getAttribute("aria-hidden"), "true");
    }
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido comunica etapas concluidas, atual e pendentes durante as transicoes", async t => {
  let remoteStatus = "PREPARANDO";
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") return Response.json({ config: storeConfig });
    if (String(url).startsWith("/api/pedido-status")) {
      return Response.json({
        statusPagamento: "PAGO",
        statusPedido: remoteStatus,
        estoquePendente: false
      });
    }
    if (String(url).startsWith("/api/pedido")) {
      return Response.json({
        pedidoId: 7,
        clienteNome: "Cliente",
        valorTotalCentavos: 1500,
        criadoEm: "2026-09-28T10:00:00Z",
        itens: [
          {
            id: 1,
            produto_nome: "Bolo",
            quantidade: 1,
            valor_unitario_centavos: 1500,
            valor_total_centavos: 1500
          }
        ],
        statusPagamento: "PAGO",
        statusPedido: remoteStatus,
        estoquePendente: false
      });
    }
    return Response.json({ ok: true });
  });
  let root;
  await ui.act(async () => {
    root = ui.mountTracking(container);
  });
  await flush();
  try {
    assertCurrentStep(1);
    assert.match(timelineSteps()[0].textContent, /Pedido recebido: concluída/);
    assert.match(timelineSteps()[2].textContent, /Pronto para retirada: pendente/);
    assertCompletedIconsAreHidden();

    remoteStatus = "PRONTO";
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assertCurrentStep(2);
    assert.match(timelineSteps()[1].textContent, /Em preparação: concluída/);
    assert.match(timelineSteps()[3].textContent, /Retirado: pendente/);
    assertCompletedIconsAreHidden();

    remoteStatus = "ENTREGUE";
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assertCurrentStep(3);
    assert.match(timelineSteps()[2].textContent, /Pronto para retirada: concluída/);
    assertCompletedIconsAreHidden();
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido mantém o intervalo de polling quando o pedido muda sem trocar de status", async t => {
  let remoteStatus = "PREPARANDO";
  let leiturasDoPedido = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") return Response.json({ config: storeConfig });
    if (String(url).startsWith("/api/pedido-status")) {
      return Response.json({
        statusPagamento: "PAGO",
        statusPedido: remoteStatus,
        estoquePendente: false
      });
    }
    if (String(url).startsWith("/api/pedido")) {
      leiturasDoPedido += 1;
      return Response.json({
        pedidoId: 7,
        clienteNome: "Cliente",
        valorTotalCentavos: 1500,
        criadoEm: "2026-09-28T10:00:00Z",
        itens: [
          {
            id: 1,
            produto_nome: "Bolo",
            quantidade: 1,
            valor_unitario_centavos: 1500,
            valor_total_centavos: 1500
          }
        ],
        statusPagamento: "PAGO",
        statusPedido: remoteStatus,
        estoquePendente: false
      });
    }
    return Response.json({ ok: true });
  });

  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  const armados = [];
  const limpos = [];
  t.mock.method(window, "setInterval", (handler, delay, ...args) => {
    const id = realSetInterval.call(window, handler, delay, ...args);
    if (delay === 10_000) armados.push(id);
    return id;
  });
  t.mock.method(window, "clearInterval", id => {
    limpos.push(id);
    return realClearInterval.call(window, id);
  });

  let root;
  await ui.act(async () => {
    root = ui.mountTracking(container);
  });
  await flush();
  try {
    assert.equal(leiturasDoPedido, 1);
    assert.equal(armados.length, 1, "o polling é armado uma vez ao carregar o pedido");

    // Cada leitura troca o objeto `pedido`; com o mesmo status o intervalo deve permanecer.
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assert.equal(leiturasDoPedido, 2, "o foco releu o pedido");
    assert.equal(armados.length, 1, "mesmo status não recria o intervalo");
    assert.deepEqual(
      limpos.filter(id => armados.includes(id)),
      [],
      "o intervalo original continua ativo"
    );

    // Contraprova: status novo é o único gatilho que reinicia o polling.
    remoteStatus = "PRONTO";
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assert.equal(leiturasDoPedido, 3);
    assert.equal(armados.length, 2, "status novo recria o intervalo uma única vez");
    assert.deepEqual(
      limpos.filter(id => armados.includes(id)),
      [armados[0]]
    );
  } finally {
    await unmount(root);
  }
});

test("AcompanharPedido lista os itens pelo id, na ordem recebida, e atualiza o conteúdo", async t => {
  const source = await readFile("src/pages/AcompanharPedido.tsx", "utf8");
  assert.match(source, /interface PedidoItem \{[^}]*\bid: number;/);
  assert.match(
    source,
    /pedido\.itens\.map\(item => \([\s\S]*?<div key=\{item\.id\} className="confirmado-item">/
  );
  assert.doesNotMatch(source, /key=\{i\}/);

  let itens = [
    {
      id: 2,
      produto_nome: "Bolo",
      quantidade: 2,
      valor_unitario_centavos: 5000,
      valor_total_centavos: 10000
    },
    {
      id: 3,
      produto_nome: "Bolo",
      quantidade: 1,
      valor_unitario_centavos: 5000,
      valor_total_centavos: 5000
    }
  ];
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") return Response.json({ config: storeConfig });
    if (String(url).startsWith("/api/pedido-status")) {
      return Response.json({
        statusPagamento: "PAGO",
        statusPedido: "PREPARANDO",
        estoquePendente: false
      });
    }
    if (String(url).startsWith("/api/pedido")) {
      return Response.json({
        pedidoId: 7,
        clienteNome: "Cliente",
        valorTotalCentavos: 15000,
        criadoEm: "2026-09-28T10:00:00Z",
        itens,
        statusPagamento: "PAGO",
        statusPedido: "PREPARANDO",
        estoquePendente: false
      });
    }
    return Response.json({ ok: true });
  });

  let root;
  await ui.act(async () => {
    root = ui.mountTracking(container);
  });
  await flush();
  try {
    const linhas = () => [...container.querySelectorAll(".confirmado-card .confirmado-item")];
    const texto = () => linhas().map(item => item.textContent.replace(/\s+/g, " ").trim());
    assert.deepEqual(texto(), ["BoloQuantidade: 2R$ 100,00", "BoloQuantidade: 1R$ 50,00"]);
    for (const item of linhas()) {
      assert.equal(item.className, "confirmado-item");
      assert.ok(item.querySelector(".confirmado-item-name"));
      assert.ok(item.querySelector(".confirmado-item-detail"));
      assert.ok(item.querySelector(".confirmado-item-price"));
    }

    itens = [
      {
        id: 2,
        produto_nome: "Bolo",
        quantidade: 3,
        valor_unitario_centavos: 5000,
        valor_total_centavos: 15000
      },
      {
        id: 3,
        produto_nome: "Bolo",
        quantidade: 1,
        valor_unitario_centavos: 5000,
        valor_total_centavos: 5000
      }
    ];
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assert.deepEqual(texto(), ["BoloQuantidade: 3R$ 150,00", "BoloQuantidade: 1R$ 50,00"]);
  } finally {
    await unmount(root);
  }
});

test("PedidoConfirmado move a etapa atual ate concluir toda a timeline", async t => {
  let remoteStatus = "PREPARANDO";
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "/api/config") return Response.json({ config: storeConfig });
    if (String(url).startsWith("/api/pedido"))
      return Response.json({ statusPagamento: "PAGO", statusPedido: remoteStatus });
    return Response.json({ ok: true });
  });
  const state = {
    pedidoId: 8,
    tokenPublico: "token-publico",
    items: [{ id: 1, name: "Pudim", price: 12, image: "", quantity: 1 }],
    totalCentavos: 1200
  };
  let root;
  await ui.act(async () => {
    root = ui.mountConfirmed(container, state);
  });
  await flush();
  try {
    assertCurrentStep(2);
    assert.match(timelineSteps()[0].textContent, /Pedido recebido: concluída/);
    assert.match(timelineSteps()[1].textContent, /Pagamento confirmado: concluída/);
    assert.match(timelineSteps()[3].textContent, /Pronto para retirada: pendente/);
    assertCompletedIconsAreHidden();

    remoteStatus = "PRONTO";
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assertCurrentStep(3);
    assert.match(timelineSteps()[2].textContent, /Em preparação: concluída/);
    assertCompletedIconsAreHidden();

    remoteStatus = "ENTREGUE";
    await ui.act(async () => window.dispatchEvent(new Event("focus")));
    await flush();
    assertCurrentStep(-1);
    assert.match(timelineSteps()[3].textContent, /Retirado: concluída/);
    assertCompletedIconsAreHidden();
  } finally {
    await unmount(root);
  }
});
