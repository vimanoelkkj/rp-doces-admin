import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Characterization: real component, pricing, keys and modal hook; only HTTP is fake.
// Mutations are compiled in memory, never written to production source.
const sourcePath = "src/admin/Pedidos/TrocarItemModal.tsx";
const source = await readFile(sourcePath, "utf8");
const dom = new JSDOM(
  '<!doctype html><html><body><button id="opener">Open</button><div id="root"></div></body></html>',
  { url: "https://local.test" }
);
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

async function compile(mutation) {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import Modal from './${sourcePath}';
        export { act } from 'react';
        export function mount(container, props) {
          const root = createRoot(container);
          root.render(<Modal {...props} />);
          return { unmount: () => root.unmount(), update: props => root.render(<Modal {...props} />) };
        }`
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
    plugins: mutation
      ? [
          {
            name: "characterization-negative-control",
            setup(buildApi) {
              buildApi.onLoad({ filter: /TrocarItemModal\.tsx$/ }, () => {
                assert.ok(source.includes(mutation.from), `Mutation anchor: ${mutation.name}`);
                const contents = source.replace(mutation.from, mutation.to);
                assert.notEqual(contents, source);
                return { contents, loader: "tsx" };
              });
            }
          }
        ]
      : []
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}
const ui = await compile();
const products = [
  {
    id: 21,
    nome: "Maior",
    preco_centavos: 2345,
    estoque: 9,
    estoque_reservado: 2,
    ativo: 1,
    disponivel: 1,
    promocao_ativa: 0
  },
  {
    id: 22,
    nome: "Menor",
    preco_centavos: 789,
    estoque: 4,
    estoque_reservado: 1,
    ativo: 1,
    disponivel: 1,
    promocao_ativa: 0
  },
  { id: 23, nome: "Inativo", preco_centavos: 999, ativo: 0, disponivel: 1 },
  { id: 24, nome: "Indisponivel", preco_centavos: 999, ativo: 1, disponivel: 0 }
];
const legs = [
  {
    pagamentoId: 31,
    pagamentoAlocacaoId: 41,
    metodo: "DINHEIRO",
    valorCentavos: 300,
    confirmacaoManualPermitida: true
  },
  {
    pagamentoId: 32,
    pagamentoAlocacaoId: 42,
    metodo: "PIX_MP",
    valorCentavos: 411,
    confirmacaoManualPermitida: false
  }
];
const exchange = (status = "AGUARDANDO_REEMBOLSO") => ({
  id: 51,
  status,
  reembolsoPendenteCentavos: status === "AGUARDANDO_REEMBOLSO" ? 711 : 0,
  refundsPendentes: status === "AGUARDANDO_REEMBOLSO" ? structuredClone(legs) : [],
  estoqueOrigemEstado: "BAIXADO",
  financeiro: { totalCentavos: 789, liquidoCentavos: 1500, saldoCentavos: -711 }
});
const preview = (overrides = {}) => ({
  previewFingerprint: "fingerprint-1",
  itemDestino: { nome: "Maior", valorCentavos: 2345 },
  financeiro: {
    totalProjetadoCentavos: 2345,
    diferencaCentavos: 845,
    saldoProjetadoCentavos: 845,
    excessoProjetadoCentavos: 0
  },
  refundsPropostos: [],
  estoque: { acaoOrigem: "NAO_REPOR", acoesOrigemPermitidas: ["NAO_REPOR", "REPOR"] },
  bloqueios: [],
  trocaExecutavel: true,
  ...overrides
});
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(body, ok = true) {
  return { ok, json: async () => structuredClone(body) };
}
const base = "/api/admin/pedidos/7/itens/11";
const query = (id = 21, quantity = 1, price = 2345, action = "NAO_REPOR", path = base) =>
  `${path}/troca-preview?produtoDestinoId=${id}&quantidadeDestino=${quantity}&precoEsperadoCentavos=${price}&estoqueAcaoOrigem=${action}`;
async function harness(t, { api = ui, props = {}, route } = {}) {
  const h = {
    calls: [],
    changed: 0,
    closed: 0,
    products: structuredClone(products),
    preview: preview(),
    exchange: exchange(),
    post: response({ error: "POST failed" }, false),
    refundStatus: "PROCESSANDO"
  };
  h.props = {
    orderId: 7,
    item: { id: 11, produto_nome: "Origem", valor_total_centavos: 1500, estoque_estado: "BAIXADO" },
    onClose: () => {
      h.closed++;
    },
    onChanged: () => {
      h.changed++;
    },
    ...props
  };
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url,
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : undefined
    };
    h.calls.push(call);
    if (route) {
      const result = route(call, h);
      if (result !== undefined) return result;
    }
    if (url === "/api/admin/produtos") return response({ produtos: h.products });
    if (url.endsWith("/reconciliar")) return response({});
    if (url.includes("/troca-preview?")) return response(h.preview);
    if (url.endsWith("/reembolsos"))
      return response({ troca: h.exchange, refundStatus: h.refundStatus });
    if (url.endsWith("/trocas") && call.method === "GET") return response({ troca: h.exchange });
    if (url.endsWith("/trocas") && call.method === "POST") return h.post;
    assert.fail(`Unexpected request: ${call.method} ${url}`);
  };
  const act = callback =>
    api.act(async () => {
      await callback();
    });
  document.querySelector("#opener").focus();
  await act(() => {
    h.root = api.mount(document.querySelector("#root"), h.props);
  });
  t.after(async () => {
    await act(() => h.root.unmount());
  });
  h.click = async node => {
    assert.ok(node, "Clickable element exists");
    await act(() => node.click());
  };
  h.select = async (name = "Maior") => {
    await h.click(document.querySelector(".additem-dropdown-trigger"));
    const options = [...document.querySelectorAll(".additem-dropdown-option")];
    await h.click(options.find(node => node.textContent.startsWith(`${name} ·`)));
  };
  h.quantity = async value =>
    act(() => {
      const input = document.querySelector('input[type="number"]');
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(
        input,
        String(value)
      );
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  h.action = async () => {
    await h.click(document.querySelectorAll(".additem-dropdown-trigger")[1]);
    await h.click(
      [...document.querySelectorAll(".additem-dropdown-option")].find(
        node => node.textContent === "Voltou fisicamente ao estoque"
      )
    );
  };
  h.update = async changes => {
    h.props = { ...h.props, ...changes };
    await act(() => h.root.update(h.props));
  };
  h.settle = async (pending, value) => act(() => pending.resolve(value));
  h.submit = () => h.click(document.querySelector(".additem-confirm"));
  h.refund = index => h.click(document.querySelectorAll(".cancelpreview-refund-leg button")[index]);
  h.posts = () => h.calls.filter(call => call.method === "POST" && call.url.endsWith("/trocas"));
  h.refunds = () => h.calls.filter(call => call.url.endsWith("/reembolsos"));
  return h;
}
function value(label) {
  const row = [...document.querySelectorAll(".cancelpreview-values > div")].find(
    node => node.querySelector("span")?.textContent === label
  );
  assert.ok(row, `Value row: ${label}`);
  return row.querySelector("strong").textContent;
}
async function positiveContract(t, api = ui) {
  const pending = deferred();
  const h = await harness(t, {
    api,
    route: call =>
      call.method === "POST" && call.url.endsWith("/trocas") ? pending.promise : undefined
  });
  assert.equal(document.querySelector(".additem-confirm").disabled, true);
  await h.select();
  assert.equal(h.calls.at(-1).url, query());
  assert.equal(
    document.querySelector(".additem-dropdown-trigger span").textContent,
    "Maior · R$ 23,45 · 7 disponíveis"
  );
  assert.equal(value("Valor atual"), "R$ 15,00");
  assert.equal(value("Novo valor"), "R$ 23,45");
  assert.equal(value("Diferença"), "+ R$ 8,45");
  assert.equal(value("Saldo após troca"), "R$ 8,45");
  await h.submit();
  const { operationKey, ...body } = h.posts()[0].body;
  assert.ok(operationKey);
  assert.deepEqual(body, {
    produtoDestinoId: 21,
    quantidadeDestino: 1,
    precoEsperadoCentavos: 2345,
    estoqueAcaoOrigem: "NAO_REPOR",
    previewFingerprint: "fingerprint-1"
  });
  assert.deepEqual(h.posts()[0].headers, { "Content-Type": "application/json" });
  assert.equal(document.querySelector(".additem-confirm").disabled, true);
  assert.equal(document.querySelector(".additem-confirm").textContent, "Confirmando...");
  await h.submit();
  assert.equal(h.posts().length, 1);
  assert.equal(h.changed, 0);
  await h.settle(pending, response({ troca: exchange("AGUARDANDO_COBRANCA") }));
  assert.equal(
    document.querySelector(".cancelpreview-success strong").textContent,
    "AGUARDANDO COBRANCA"
  );
  assert.match(
    document.querySelector(".cancelpreview-success span").textContent,
    /diferença pode ser cobrada/
  );
  assert.equal(document.querySelector(".additem-form"), null);
  assert.equal(h.changed, 1);
  assert.equal(h.closed, 0);
}
test(
  "higher price: exact preview, cents, fingerprint, payload and saving to collection",
  positiveContract
);

test("lower price: negative difference, projected excess and individual refund legs", async t => {
  const h = await harness(t);
  h.preview = preview({
    itemDestino: { nome: "Menor", valorCentavos: 789 },
    financeiro: {
      totalProjetadoCentavos: 789,
      diferencaCentavos: -711,
      saldoProjetadoCentavos: -711,
      excessoProjetadoCentavos: 711
    },
    refundsPropostos: legs
  });
  h.post = response({ troca: exchange() });
  await h.select("Menor");
  assert.equal(h.calls.at(-1).url, query(22, 1, 789));
  assert.equal(value("Diferença"), "- R$ 7,11");
  assert.equal(value("Será necessário devolver"), "R$ 7,11");
  assert.equal(value("Saldo após troca"), "R$ -7,11");
  await h.submit();
  assert.equal(h.posts()[0].body.precoEsperadoCentavos, 789);
  assert.equal(
    document.querySelector(".cancelpreview-success strong").textContent,
    "AGUARDANDO REEMBOLSO"
  );
  const rows = [...document.querySelectorAll(".cancelpreview-refund-leg")];
  assert.deepEqual(
    rows.map(node => node.querySelector("strong").textContent),
    ["Dinheiro", "Pix Mercado Pago"]
  );
  assert.deepEqual(
    rows.map(node => node.querySelector("span").textContent),
    ["R$ 3,00", "R$ 4,11"]
  );
  assert.deepEqual(
    rows.map(node => node.querySelector("button").textContent),
    ["Confirmar devolução", "Solicitar estorno"]
  );
  assert.match(document.querySelector(".cancelpreview-footer").textContent, /Pendente: R\$ 7,11/);
  await h.refund(0);
  await h.refund(1);
  assert.deepEqual(
    h.refunds().map(({ body: { operationKey, ...body } }) => {
      assert.ok(operationKey);
      return body;
    }),
    legs.map(leg => ({
      pagamentoId: leg.pagamentoId,
      pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
      valorCentavos: leg.valorCentavos,
      confirmacao: true
    }))
  );
  assert.equal(h.changed, 3);
});

async function retryContract(t, api = ui) {
  const h = await harness(t, { api });
  await h.select();
  await h.submit();
  await h.submit();
  assert.equal(h.posts().length, 2);
  assert.equal(h.posts()[1].body.operationKey, h.posts()[0].body.operationKey);
  assert.equal(h.changed, 0);
  assert.equal(document.querySelector(".additem-error").textContent, "POST failed");
  assert.equal(document.querySelector(".additem-confirm").disabled, false);
}
test("exchange retry preserves the operation key after failed POST", retryContract);

for (const dependency of ["product", "quantity", "price", "action", "fingerprint"]) {
  test(`exchange signature: changing ${dependency} renews key`, async t => {
    const h = await harness(t);
    await h.select();
    await h.submit();
    const previous = h.posts()[0].body;
    if (dependency === "product") await h.select("Menor");
    if (dependency === "quantity") await h.quantity(2);
    if (dependency === "action") await h.action();
    if (dependency === "price") {
      h.products[0].preco_centavos = 2456;
      await h.update({ orderId: 8 });
    }
    if (dependency === "fingerprint") {
      h.preview.previewFingerprint = "fingerprint-2";
      // Same effective price and selection; reloading products renews preview.
      await h.update({ item: { ...h.props.item, id: 12 } });
    }
    await h.submit();
    const next = h.posts()[1].body;
    assert.notEqual(next.operationKey, previous.operationKey);
    const field = {
      product: "produtoDestinoId",
      quantity: "quantidadeDestino",
      price: "precoEsperadoCentavos",
      action: "estoqueAcaoOrigem",
      fingerprint: "previewFingerprint"
    }[dependency];
    assert.notEqual(next[field], previous[field]);
    if (dependency === "fingerprint")
      assert.deepEqual(
        {
          ...next,
          operationKey: previous.operationKey,
          previewFingerprint: previous.previewFingerprint
        },
        previous
      );
  });
}

async function blockedContract(t, api = ui) {
  const h = await harness(t, { api });
  h.preview = preview({
    trocaExecutavel: false,
    bloqueios: [
      { codigo: "ESTOQUE", mensagem: "Estoque insuficiente" },
      { codigo: "FINANCEIRO", mensagem: "Pagamento pendente" }
    ]
  });
  await h.select();
  assert.equal(document.querySelector(".additem-confirm").disabled, true);
  assert.deepEqual(
    [...document.querySelectorAll(".cancelpreview-block")].map(node => node.textContent),
    ["Estoque insuficiente", "Pagamento pendente"]
  );
  await h.submit();
  assert.equal(h.posts().length, 0);
}
test("blocked preview renders every message and disables confirmation", blockedContract);

for (const [state, action] of [
  ["RESERVADO", "LIBERAR_RESERVA"],
  ["BAIXADO", "NAO_REPOR"],
  ["SEM_ESTOQUE", "NENHUMA"],
  ["LIBERADO", "NENHUMA"]
]) {
  test(`origin ${state}: default ${action}`, async t => {
    const h = await harness(t, {
      props: {
        item: { id: 11, produto_nome: "Origem", valor_total_centavos: 1500, estoque_estado: state }
      }
    });
    await h.select();
    assert.equal(h.calls.at(-1).url, query(21, 1, 2345, action));
    assert.equal(
      document.querySelectorAll(".additem-dropdown-trigger").length,
      state === "BAIXADO" ? 2 : 1
    );
    await h.submit();
    assert.equal(h.posts()[0].body.estoqueAcaoOrigem, action);
  });
}
test("preview dependencies: selection, quantity, action, price, order and item; invalid quantity clears", async t => {
  const h = await harness(t);
  await h.select();
  assert.equal(h.calls.at(-1).url, query());
  await h.quantity(3);
  assert.equal(h.calls.at(-1).url, query(21, 3));
  assert.equal(document.querySelector("input").value, "3");
  await h.action();
  assert.equal(h.calls.at(-1).url, query(21, 3, 2345, "REPOR"));
  await h.select("Menor");
  assert.equal(document.querySelector("input").value, "1");
  assert.equal(h.calls.at(-1).url, query(22, 1, 789, "REPOR"));
  h.products[1].promocao_ativa = 1;
  h.products[1].preco_promocional_centavos = 678;
  await h.update({ orderId: 8 });
  assert.equal(h.calls.at(-1).url, query(22, 1, 678, "REPOR", "/api/admin/pedidos/8/itens/11"));
  await h.update({ item: { ...h.props.item, id: 12 } });
  assert.equal(h.calls.at(-1).url, query(22, 1, 678, "REPOR", "/api/admin/pedidos/8/itens/12"));
  const count = h.calls.length;
  await h.quantity(0);
  assert.equal(h.calls.length, count);
  assert.equal(document.querySelector(".cancelpreview-values"), null);
  assert.equal(document.querySelector(".additem-confirm").disabled, true);
  await h.quantity(2);
  assert.equal(h.calls.at(-1).url, query(22, 2, 678, "REPOR", "/api/admin/pedidos/8/itens/12"));
});
test("products filter active and available; zero difference has no sign or excess", async t => {
  const h = await harness(t);
  h.preview = preview({
    financeiro: { diferencaCentavos: 0, saldoProjetadoCentavos: 0, excessoProjetadoCentavos: 0 }
  });
  await h.click(document.querySelector(".additem-dropdown-trigger"));
  assert.equal(document.querySelectorAll(".additem-dropdown-option").length, 2);
  await h.click(document.querySelector(".additem-dropdown-option"));
  assert.equal(value("Diferença"), "R$ 0,00");
  assert.doesNotMatch(
    document.querySelector(".cancelpreview-values").textContent,
    /Será necessário devolver/
  );
});

async function orderContract(t, api = ui) {
  const pending = deferred();
  const h = await harness(t, {
    api,
    props: { existingExchangeId: 51 },
    route: call => (call.url.endsWith("/reconciliar") ? pending.promise : undefined)
  });
  assert.deepEqual(
    h.calls.map(call => [call.method, call.url]),
    [["POST", "/api/admin/pedidos/7/reconciliar"]]
  );
  assert.ok(document.querySelector(".additem-loading"));
  await h.settle(pending, response({}));
  assert.equal(h.calls[1].url, `${base}/trocas`);
  assert.equal(h.calls[1].method, "GET");
  assert.equal(
    document.querySelector(".cancelpreview-success strong").textContent,
    "AGUARDANDO REEMBOLSO"
  );
  assert.equal(document.querySelector(".additem-loading"), null);
  await h.update({ existingExchangeStatus: "CONCLUIDA" });
  assert.deepEqual(
    h.calls.slice(-2).map(call => call.url),
    ["/api/admin/pedidos/7/reconciliar", `${base}/trocas`]
  );
}
test("existing exchange waits for reconciliation before GET and reloads on status", orderContract);
for (const failure of ["network", "http"]) {
  test(`reconciliation ${failure} failure still loads existing exchange`, async t => {
    const h = await harness(t, {
      props: { existingExchangeId: 51 },
      route: call => {
        if (call.url.endsWith("/reconciliar"))
          return failure === "network"
            ? Promise.reject(new Error("offline"))
            : response({ error: "reconcile failed" }, false);
      }
    });
    assert.equal(h.calls[1].url, `${base}/trocas`);
    assert.ok(document.querySelector(".cancelpreview-success"));
    assert.equal(document.querySelector(".additem-error"), null);
  });
}
for (const failure of ["network", "http"]) {
  test(`existing exchange GET ${failure} failure renders error and stops loading`, async t => {
    const h = await harness(t, {
      props: { existingExchangeId: 51 },
      route: call => {
        if (call.url.endsWith("/trocas"))
          return failure === "network"
            ? Promise.reject(new Error("GET offline"))
            : response({ error: "GET rejected" }, false);
      }
    });
    assert.equal(h.calls.length, 2);
    assert.equal(
      document.querySelector(".additem-error").textContent,
      failure === "network" ? "GET offline" : "GET rejected"
    );
    assert.equal(document.querySelector(".additem-loading"), null);
    // Current fallback displays the form without fetching products.
    assert.ok(document.querySelector(".additem-form"));
  });
}

async function refundKeysContract(t, api = ui) {
  const h = await harness(t, { api, props: { existingExchangeId: 51 } });
  await h.refund(0);
  await h.refund(0);
  await h.refund(1);
  const keys = h.refunds().map(call => call.body.operationKey);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  h.refundStatus = "CONFIRMADO";
  await h.refund(0);
  assert.equal(h.refunds()[3].body.operationKey, keys[0]);
  await h.refund(0);
  assert.notEqual(h.refunds()[4].body.operationKey, keys[0]);
  // Confirmation of allocation 41 must not discard allocation 42's key.
  await h.refund(1);
  assert.equal(h.refunds()[5].body.operationKey, keys[2]);
}
test(
  "refund keys: pending retries reuse, allocations are independent, confirmed discards",
  refundKeysContract
);
for (const status of ["PENDENTE", "PROCESSANDO", "RECUSADO", "INCONCLUSIVO", undefined]) {
  test(`refund response ${status ?? "missing status"}: current key lifecycle`, async t => {
    const h = await harness(t, { props: { existingExchangeId: 51 } });
    h.refundStatus = status;
    await h.refund(0);
    await h.refund(0);
    if (status === undefined)
      assert.notEqual(h.refunds()[0].body.operationKey, h.refunds()[1].body.operationKey);
    else assert.equal(h.refunds()[0].body.operationKey, h.refunds()[1].body.operationKey);
  });
}
test("remote persisted key takes precedence; status labels and run eligibility", async t => {
  const h = await harness(t, { props: { existingExchangeId: 51 } });
  for (const [status, label, runnable] of [
    ["PENDENTE", "Aguardando envio", true],
    ["PROCESSANDO", "Processando", true],
    ["INCONCLUSIVO", "Verificar novamente", true],
    ["RECUSADO", "Recusado pelo provedor", false],
    ["CONFIRMADO", "Confirmado", false]
  ]) {
    h.exchange.refundsPendentes[1].refundRemoto = {
      status,
      operationKey: "persisted-remote-key",
      podeVerificar: true
    };
    await h.update({ existingExchangeStatus: status });
    const row = document.querySelectorAll(".cancelpreview-refund-leg")[1];
    assert.match(row.textContent, new RegExp(label));
    assert.equal(Boolean(row.querySelector("button")), runnable);
    if (runnable) {
      await h.refund(1);
      assert.equal(h.refunds().at(-1).body.operationKey, "persisted-remote-key");
    }
  }
  h.exchange.refundsPendentes[1].refundRemoto = {
    status: "PROCESSANDO",
    operationKey: "persisted-remote-key",
    podeVerificar: false
  };
  await h.update({ existingExchangeStatus: "NO_VERIFY" });
  assert.equal(
    document.querySelectorAll(".cancelpreview-refund-leg")[1].querySelector("button"),
    null
  );
});
test("refund saving disables all legs; confirmed exchange renders history and callback", async t => {
  const pending = deferred();
  const h = await harness(t, {
    props: { existingExchangeId: 51 },
    route: call => (call.url.endsWith("/reembolsos") ? pending.promise : undefined)
  });
  await h.refund(0);
  assert.ok(
    [...document.querySelectorAll(".cancelpreview-refund-leg button")].every(node => node.disabled)
  );
  await h.refund(1);
  assert.equal(h.refunds().length, 1);
  const completed = exchange("CONCLUIDA");
  completed.reembolsosConfirmados = [{ id: 61, metodo: "DINHEIRO", valorCentavos: 711 }];
  await h.settle(pending, response({ troca: completed, refundStatus: "CONFIRMADO" }));
  assert.equal(h.changed, 1);
  assert.match(
    document.querySelector(".cancelpreview-section").textContent,
    /DinheiroR\$ 7,11Confirmado/
  );
  assert.match(
    document.querySelector(".cancelpreview-footer").textContent,
    /Sem devoluções pendentes/
  );
  await h.click(document.querySelector(".cancelpreview-footer button"));
  assert.equal(h.closed, 1);
});

for (const failure of ["network", "http", "json"]) {
  test(`products GET ${failure}: current error handling`, async t => {
    await harness(t, {
      route: call => {
        if (call.url === "/api/admin/produtos") {
          if (failure === "network") return Promise.reject(new Error("offline"));
          if (failure === "json")
            return {
              ok: false,
              json: async () => {
                throw new Error("invalid JSON");
              }
            };
          // Products GET deliberately does not check response.ok.
          return response({ produtos: products }, false);
        }
      }
    });
    assert.equal(document.querySelector(".additem-loading"), null);
    assert.equal(
      document.querySelector(".additem-error")?.textContent ?? null,
      failure === "http" ? null : "Falha ao carregar produtos"
    );
  });
}
for (const endpoint of ["preview", "exchange", "refund"]) {
  for (const failure of ["network", "http", "json"]) {
    test(`${endpoint} ${failure} failure: error, no callback and retry state`, async t => {
      let failing = true;
      const fallback = {
        preview: "Falha ao calcular troca",
        exchange: "Falha ao executar troca",
        refund: "Falha ao registrar devolução"
      }[endpoint];
      const h = await harness(t, {
        props: endpoint === "refund" ? { existingExchangeId: 51 } : {},
        route: call => {
          const target =
            endpoint === "preview"
              ? call.url.includes("/troca-preview?")
              : endpoint === "exchange"
                ? call.method === "POST" && call.url.endsWith("/trocas")
                : call.url.endsWith("/reembolsos");
          if (!target || !failing) return undefined;
          if (failure === "network") return Promise.reject(new Error("offline"));
          if (failure === "http") return response({ error: "Request rejected" }, false);
          return {
            ok: false,
            json: async () => {
              throw new Error("invalid JSON");
            }
          };
        }
      });
      if (endpoint !== "refund") await h.select();
      if (endpoint === "exchange") await h.submit();
      if (endpoint === "refund") await h.refund(0);
      assert.equal(
        document.querySelector(".additem-error").textContent,
        failure === "network" ? "offline" : failure === "http" ? "Request rejected" : fallback
      );
      assert.equal(h.changed, 0);
      assert.equal(h.closed, 0);
      if (endpoint === "preview") {
        assert.equal(document.querySelector(".additem-confirm").disabled, true);
        failing = false;
        await h.quantity(2);
        assert.equal(document.querySelector(".additem-error"), null);
      } else if (endpoint === "exchange")
        assert.equal(document.querySelector(".additem-confirm").disabled, false);
      else {
        const key = h.refunds()[0].body.operationKey;
        failing = false;
        await h.refund(0);
        assert.equal(h.refunds()[1].body.operationKey, key);
        assert.equal(h.changed, 1);
      }
    });
  }
}
test("late preview is ignored; failed replacement currently preserves previous preview", async t => {
  const stale = deferred();
  const h = await harness(t, { route: call => (call.url === query() ? stale.promise : undefined) });
  await h.select();
  await h.quantity(2);
  assert.equal(value("Diferença"), "+ R$ 8,45");
  await h.settle(stale, response(preview({ financeiro: { diferencaCentavos: 99999 } })));
  assert.equal(value("Diferença"), "+ R$ 8,45");
  h.preview = preview();
  // A network error on the next request does not clear an already rendered preview.
  const fetch = globalThis.fetch;
  globalThis.fetch = (url, options) =>
    url === query(21, 3) ? Promise.reject(new Error("preview offline")) : fetch(url, options);
  await h.quantity(3);
  assert.equal(document.querySelector(".additem-error").textContent, "preview offline");
  assert.equal(value("Diferença"), "+ R$ 8,45");
  assert.equal(document.querySelector(".additem-confirm").disabled, false);
});

test("close controls, genuine overlay clicks, Escape and two-way focus trap", async t => {
  const h = await harness(t);
  await h.select();
  const close = document.querySelector(".additem-close");
  const submit = document.querySelector(".additem-confirm");
  assert.equal(document.querySelector('[role="dialog"]').getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement, close);
  submit.focus();
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
  );
  assert.equal(document.activeElement, close);
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
  );
  assert.equal(document.activeElement, submit);
  await h.click(close);
  assert.equal(h.closed, 1);
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(h.closed, 2);
  const overlay = document.querySelector(".additem-overlay");
  await h.click(overlay);
  assert.equal(h.closed, 2);
  overlay.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  document
    .querySelector(".additem-card")
    .dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
  await h.click(overlay);
  assert.equal(h.closed, 2);
  overlay.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  overlay.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
  await h.click(overlay);
  assert.equal(h.closed, 3);
  await h.click(document.querySelector(".additem-cancel"));
  assert.equal(h.closed, 4);
});

const mutations = [
  {
    name: "operationKey changed on retry",
    from: "operationKey: keyRef.current,",
    to: "operationKey: novaOperationKey(),",
    contract: retryContract
  },
  {
    name: "previewFingerprint changed",
    from: "previewFingerprint: preview.previewFingerprint",
    to: 'previewFingerprint: "wrong-fingerprint"',
    contract: positiveContract
  },
  {
    name: "confirmation block removed",
    from: "disabled={!preview?.trocaExecutavel || saving}",
    to: "disabled={saving}",
    contract: blockedContract
  },
  {
    name: "cent value changed",
    from: "precoEsperadoCentavos: price,",
    to: "precoEsperadoCentavos: price + 1,",
    contract: positiveContract
  },
  {
    name: "refund key shared across allocations",
    from: "refundKeys.current.get(leg.pagamentoAlocacaoId)",
    to: "refundKeys.current.values().next().value",
    contract: refundKeysContract
  },
  {
    name: "GET before reconciliation",
    from: `reconciliarPedido(orderId)\n        .then(() => fetch(\`/api/admin/pedidos/\${orderId}/itens/\${item.id}/trocas\`))`,
    to: `fetch(\`/api/admin/pedidos/\${orderId}/itens/\${item.id}/trocas\`)\n        .then(async r => { await reconciliarPedido(orderId); return r; })`,
    contract: orderContract
  }
];
for (const mutation of mutations) {
  test(`negative control detects ${mutation.name}`, async t => {
    const mutated = await compile(mutation);
    await assert.rejects(() => mutation.contract(t, mutated), { code: "ERR_ASSERTION" });
  });
}
