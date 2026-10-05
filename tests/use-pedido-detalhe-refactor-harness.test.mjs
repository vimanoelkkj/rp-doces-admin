import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const hookPath = "src/admin/Pedidos/PedidoDetalhe/usePedidoDetalhe.ts";
const paymentHookPath = "src/admin/Pedidos/PedidoDetalhe/usePedidoDetalhePagamento.ts";
const pixHookPath = "src/admin/Pedidos/PedidoDetalhe/usePedidoDetalhePix.ts";
const intentPath = "src/admin/Pedidos/PedidoDetalhe/manualPaymentIntent.ts";
const sources = new Map(
  await Promise.all(
    [hookPath, paymentHookPath, pixHookPath, intentPath].map(async path => [
      resolve(path),
      await readFile(path, "utf8")
    ])
  )
);
const lockMutations = {
  guard: [
    "if (capacidadeCobravelCentavos === undefined || pagamentoEmVooRef.current) return;",
    "if (capacidadeCobravelCentavos === undefined) return;"
  ],
  state: [
    "if (capacidadeCobravelCentavos === undefined || pagamentoEmVooRef.current) return;",
    "if (capacidadeCobravelCentavos === undefined || pagamentoEmVoo) return;"
  ],
  activation: [
    "pagamentoEmVooRef.current = true;",
    "queueMicrotask(() => { pagamentoEmVooRef.current = true; });"
  ],
  earlyRelease: [
    "pagamentoEmVooRef.current = true;",
    "pagamentoEmVooRef.current = true; pagamentoEmVooRef.current = false;"
  ],
  release: [
    "pagamentoEmVooRef.current = false;\n        setPagamentoEmVoo(false);",
    "setPagamentoEmVoo(false);"
  ]
};
const mutations = {
  ordering: [
    `.then(() => fetch(\`/api/admin/pedidos/\${orderId}\`))`,
    `.then(() => Promise.resolve(fetch(\`/api/admin/pedidos/\${orderId}\`)))`
  ],
  clock: ["1000);", "1100);"],
  polling: ["5000);", "5100);"],
  cleanup: ["return () => clearInterval(interval);", "return () => {};"],
  retry: ["let operationKey = pixKeysRef.current.get(acao);", "let operationKey = undefined;"],
  identity: [
    `const acao = substituiId ? \`regen:\${substituiId}\` : "novo";`,
    'const acao = "novo";'
  ],
  lock: lockMutations[process.env.LOCK_MUTATION ?? "guard"],
  callback: ["onStatusChangedRef.current?.();", "onStatusChanged?.();"],
  reset: [
    "setAdicionandoItem(false);\n    setEditandoNome(false);",
    "setHistoricoAberto(false);\n    setAdicionandoItem(false);\n    setEditandoNome(false);"
  ],
  staleGeneration: ["leituraRef.current.generation === generation", "true"],
  staleOrder: ["if (!podeAplicarLeitura()) return;", ""],
  staleSequence: ["sequence >= leituraRef.current.appliedSequence", "true"],
  staleReset: ["leituraRef.current.generation++;", "leituraRef.current.generation = 0;"],
  staleError: [
    "if (!podeAplicarLeitura()) return;\n          leituraRef.current.appliedSequence = sequence;\n          setError(err.message);",
    "setError(err.message);"
  ],
  staleLoading: [
    "pertenceAoPedidoAtual() && sequence >= leituraRef.current.loadingSequence",
    "!silencioso"
  ],
  staleUnmount: ["leituraRef.current.orderId = null;\n      leituraRef.current.generation++;", ""],
  intentAmbiguous: [
    ".catch(err => setPagamentoError(err.message))",
    ".catch(err => { resolvePaymentIntent(intent); setPagamentoError(err.message); })"
  ],
  intentReopen: [
    "const pending = readPaymentIntents(orderId).slice(-1)[0];",
    "const pending = undefined;"
  ],
  intentPayload: ["intent.payload.metodo === payload.metodo", "true"],
  intentOrder: ["intent.pedidoId === pedidoId &&", "true &&"],
  intentSuccess: ["resolvePaymentIntent(intent);", ""],
  intentValueOnly: [
    "pending.operationKey !== intent.operationKey",
    "pending.payload.valorCentavos !== intent.payload.valorCentavos"
  ],
  intentPremature: [
    "storePaymentIntent(intent);",
    "storePaymentIntent(intent); resolvePaymentIntent(intent);"
  ]
};
if (process.env.HOOK_MUTATION) {
  const [before, after] = mutations[process.env.HOOK_MUTATION];
  const targets = [...sources].filter(([, source]) =>
    source.replaceAll("\r\n", "\n").includes(before)
  );
  assert.ok(targets.length > 0, "Mutation anchor must exist");
  for (const [path, original] of targets) {
    let source = original.replaceAll("\r\n", "\n").replaceAll(before, after);
    if (process.env.HOOK_MUTATION === "ordering") {
      source = source.replace(
        `return fetch(\`/api/admin/pedidos/\${orderId}/reconciliar\`, { method: "POST" })`,
        `const premature = fetch(\`/api/admin/pedidos/\${orderId}\`); return fetch(\`/api/admin/pedidos/\${orderId}/reconciliar\`, { method: "POST" })`
      );
    }
    sources.set(path, source);
  }
}
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
const NativeCrypto = globalThis.crypto;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://local.test" });
for (const name of ["window", "document", "navigator", "HTMLElement"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {usePedidoDetalhe} from './${hookPath}';
    export {act} from 'react';
    export let current;
    function Probe(props){current=usePedidoDetalhe(props);return null;}
    export function mount(container){const root=createRoot(container);return {
      render(props){root.render(<Probe {...props}/>);},unmount(){root.unmount();}
    };}
  `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "hook-source",
      setup(b) {
        b.onLoad(
          { filter: /(?:usePedidoDetalhe(?:Pagamento|Pix)?|manualPaymentIntent)\.ts$/ },
          args => ({
            contents: sources.get(args.path),
            loader: "ts",
            resolveDir: args.path.replace(/[/\\][^/\\]+$/, "")
          })
        );
      }
    }
  ]
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});
const fixture = (id = 1, extra = {}) => ({
  pedido: {
    id,
    cliente_nome: "Cliente",
    cliente_whatsapp: "11999999999",
    observacao: "",
    valor_total_centavos: 1000,
    status_pagamento: "PENDENTE",
    status_pedido: "NOVO",
    status_comanda: "ABERTA",
    criado_em: "2026-01-01",
    pago_em: null,
    origem_pedido: "MANUAL",
    arquivado: 0,
    arquivado_em: null
  },
  itens: [
    {
      id: 11,
      produto_id: 1,
      produto_nome: "Bolo",
      emoji: null,
      quantidade: 1,
      valor_unitario_centavos: 1000,
      valor_total_centavos: 1000,
      status_item: "ATIVO",
      estoque_estado: "RESERVADO",
      cancelamento_id: null,
      cancelamento_status: null,
      troca_id: 2,
      troca_status: "AGUARDANDO_COBRANCA",
      troca_item_origem_id: null
    }
  ],
  financeiro: { status: "PENDENTE", pagoCentavos: 0, totalCentavos: 1000 },
  capacidadeCobravelCentavos: 1000,
  pixAdminPendentes: [],
  operacoesInconclusivas: [],
  anulacao: null,
  ...extra
});
const pending = () =>
  fixture(1, {
    pixAdminPendentes: [
      { id: 7, valorCentavos: 1000, qrCode: "code", expiresAt: new Date(1500).toISOString() }
    ]
  });
async function harness(
  t,
  {
    preserveStorage = false,
    storage = dom.window.sessionStorage,
    keyOffset = 0,
    realTimers = false
  } = {}
) {
  const requests = [],
    events = [],
    timers = new Map();
  let now = 0,
    nextTimer = 0,
    nextKey = keyOffset;
  const originals = new Map();
  const patch = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  if (!preserveStorage) storage.clear();
  patch("sessionStorage", storage);
  patch(
    "fetch",
    (url, options = {}) =>
      new Promise((resolve, reject) =>
        requests.push({
          url,
          method: options.method ?? "GET",
          headers: options.headers,
          body: options.body ? JSON.parse(options.body) : undefined,
          resolve,
          reject
        })
      )
  );
  patch("crypto", {
    subtle: NativeCrypto.subtle,
    getRandomValues: NativeCrypto.getRandomValues.bind(NativeCrypto),
    randomUUID: () => `operation-${++nextKey}`
  });
  for (const [name, repeat] of [
    ["setInterval", true],
    ["setTimeout", false]
  ]) {
    if (realTimers) continue;
    patch(name, (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, delay, at: now + delay, repeat });
      return id;
    });
  }
  if (!realTimers)
    for (const name of ["clearInterval", "clearTimeout"]) patch(name, id => timers.delete(id));
  const realNow = Date.now;
  if (!realTimers) Date.now = () => now;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: text => {
        events.push(`copy:${text}`);
        return Promise.resolve();
      }
    }
  });
  const root = ui.mount(document.getElementById("root"));
  let props = {
    orderId: 1,
    onClose: () => events.push("close:old"),
    onStatusChanged: () => events.push("status:old")
  };
  const flush = () =>
    ui.act(async () => {
      await new Promise(setImmediate);
    });
  const call = async fn => {
    await ui.act(async () => {
      fn(ui.current);
    });
    await flush();
  };
  const render = async extra => {
    props = { ...props, ...extra };
    await ui.act(async () => root.render(props));
    await flush();
  };
  const reply = async (request, body = {}, status = 200) => {
    assert.ok(request, "Expected captured request");
    await ui.act(async () =>
      request.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
    );
    await flush();
  };
  const fail = async request => {
    await ui.act(async () => request.reject(new Error("network")));
    await flush();
  };
  const load = async (body = fixture(), reconciliation = requests.at(-1)) => {
    assert.equal(reconciliation.method, "POST");
    assert.match(reconciliation.url, /\/reconciliar$/);
    const count = requests.length;
    await reply(reconciliation);
    assert.equal(requests.length, count + 1);
    await reply(requests.at(-1), body);
  };
  const tick = async ms => {
    const end = now + ms;
    await ui.act(async () => {
      while (true) {
        const entry = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(id);
        timer.fn();
      }
      now = end;
    });
    await flush();
  };
  let mounted = true;
  const unmount = async () => {
    await ui.act(async () => root.unmount());
    mounted = false;
  };
  t.after(async () => {
    if (mounted) await unmount();
    Date.now = realNow;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await render({});
  return {
    get state() {
      return ui.current;
    },
    requests,
    events,
    timers,
    call,
    render,
    reply,
    fail,
    load,
    tick,
    unmount,
    flush
  };
}

test("load: reconciliation ordering, network/HTTP failures, normal/silent and invalid GET", async t => {
  const h = await harness(t);
  assert.deepEqual(
    h.requests.map(r => [r.method, r.url]),
    [["POST", "/api/admin/pedidos/1/reconciliar"]]
  );
  await h.load();
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.state.data, fixture());
  await h.call(s => s.carregarPedido());
  assert.equal(h.state.loading, true);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await h.fail(h.requests.at(-1));
  } finally {
    console.warn = warn;
  }
  assert.equal(h.requests.at(-1).method, "GET");
  await h.reply(h.requests.at(-1), fixture());
  await h.call(s => s.carregarPedido(true));
  assert.equal(h.state.loading, false);
  await h.reply(h.requests.at(-1), {}, 503);
  assert.equal(h.requests.at(-1).method, "GET");
  await h.reply(h.requests.at(-1), {}, 500);
  assert.equal(h.state.error, "Falha ao carregar pedido");
  assert.deepEqual(h.state.data, fixture());
  await h.call(s => s.carregarPedido());
  await h.reply(h.requests.at(-1));
  await h.reply(h.requests.at(-1), {});
  assert.match(h.state.error, /status/);
  assert.equal(h.state.loading, false);
  await h.call(s => s.carregarPedido());
  await h.reply(h.requests.at(-1));
  await h.fail(h.requests.at(-1));
  assert.equal(h.state.error, "network");
});

test("reset: exact partial snapshot, surviving locks and discarded old order response", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.setAdicionandoItem(true);
    s.setEditandoNome(true);
    s.setRegistrandoPagamento(true);
    s.setPagamentoError("payment");
    s.setClienteNome("draft");
    s.setValorPagamento("2,00");
    s.selecionarMetodoPagamento("CARTAO");
    s.setHistoricoAberto(true);
    s.setItemTroca(s.data.itens[0]);
    s.setItemCancelamentoPreviewId(11);
    s.setConfirmarArquivamento(true);
    s.setConfirmarExclusao(true);
    s.setPixAviso("warning");
    s.copiarCodigo(7, "code");
  });
  await h.call(s => {
    s.gerarPix();
    s.registrarPagamento();
    s.alterarStatus("PRONTO");
    s.executarArquivamento(true);
    s.salvarNome();
  });
  const oldPix = h.requests.find(r => r.url.endsWith("/pix"));
  await h.call(s => s.carregarPedido(true));
  const oldReconcile = h.requests.at(-1);
  await h.reply(oldReconcile);
  const oldGet = h.requests.at(-1);
  await h.render({ orderId: 2 });
  const keys = [
    "data",
    "loading",
    "error",
    "alterando",
    "statusError",
    "arquivando",
    "arquivamentoError",
    "confirmarArquivamento",
    "confirmarExclusao",
    "editandoNome",
    "clienteNome",
    "salvandoNome",
    "nomeError",
    "registrandoPagamento",
    "metodoPagamento",
    "valorPagamento",
    "pagamentoEmVoo",
    "pagamentoError",
    "gerando",
    "regenerandoId",
    "pixError",
    "pixAviso",
    "agora",
    "copiedId",
    "adicionandoItem",
    "itemCancelamentoPreviewId",
    "itemTroca",
    "historicoAberto"
  ];
  assert.deepEqual(Object.fromEntries(keys.map(k => [k, h.state[k]])), {
    data: null,
    loading: true,
    error: null,
    alterando: true,
    statusError: null,
    arquivando: true,
    arquivamentoError: null,
    confirmarArquivamento: true,
    confirmarExclusao: true,
    editandoNome: false,
    clienteNome: "draft",
    salvandoNome: true,
    nomeError: null,
    registrandoPagamento: false,
    metodoPagamento: "CARTAO",
    valorPagamento: "2,00",
    pagamentoEmVoo: true,
    pagamentoError: null,
    gerando: true,
    regenerandoId: null,
    pixError: null,
    pixAviso: null,
    agora: 0,
    copiedId: 7,
    adicionandoItem: false,
    itemCancelamentoPreviewId: 11,
    itemTroca: fixture().itens[0],
    historicoAberto: true
  });
  assert.equal(h.state.pagamentoKeyRef.current, null);
  await h.load(fixture(2));
  await h.call(s => s.gerarPix());
  assert.equal(
    h.requests.filter(r => r.url.endsWith("/pix")).length,
    1,
    "Pix in-flight set survives order change"
  );
  await h.reply(oldGet, fixture(1));
  assert.deepEqual(h.state.data, fixture(2));
  assert.deepEqual(h.events, ["copy:code"]);
  await h.fail(oldPix);
});

test("polling: exact clock, overlap, archived orders, stop/restart and cleanup", async t => {
  const h = await harness(t);
  const data = pending();
  data.pedido.arquivado = 1;
  await h.load(data);
  assert.deepEqual(
    [...h.timers.values()].map(x => x.delay).sort((a, b) => a - b),
    [1000, 5000]
  );
  await h.tick(999);
  assert.equal(h.state.agora, 0);
  await h.tick(1);
  assert.equal(h.state.agora, 1000);
  await h.tick(3999);
  assert.equal(h.requests.length, 2);
  await h.tick(1);
  const first = h.requests.at(-1);
  assert.equal(h.requests.length, 3);
  await h.tick(5000);
  const second = h.requests.at(-1);
  assert.equal(h.requests.length, 4);
  await h.reply(second);
  const secondGet = h.requests.at(-1);
  await h.reply(first);
  const firstGet = h.requests.at(-1);
  await h.reply(
    secondGet,
    fixture(1, { financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 } })
  );
  assert.equal(h.timers.size, 0);
  await h.reply(firstGet, pending());
  assert.equal(h.state.data.financeiro.status, "PAGO");
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.events, ["status:old"]);
  await h.call(s => s.carregarPedido(true));
  await h.load(pending());
  assert.equal(h.state.data.financeiro.status, "PENDENTE");
  assert.equal(h.timers.size, 2);
  await h.tick(2000);
  assert.ok(h.state.agora > Date.parse(h.state.data.pixAdminPendentes[0].expiresAt));
  assert.equal(h.state.data.pedido.status_pagamento, "PENDENTE");
  assert.equal(h.state.data.pixAdminPendentes.length, 1);
  await h.unmount();
  assert.equal(h.timers.size, 0);
  const count = h.requests.length;
  await h.tick(10000);
  assert.equal(h.requests.length, count);
});

test("stale: returning to the same order never reuses an earlier generation", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.carregarPedido(true));
  await h.reply(h.requests.at(-1));
  const oldGet = h.requests.at(-1);
  await h.render({ orderId: 2 });
  const otherReconcile = h.requests.at(-1);
  await h.render({ orderId: 1 });
  const currentReconcile = h.requests.at(-1);
  await h.reply(oldGet, pending());
  assert.equal(h.state.data, null);
  assert.equal(h.state.loading, true);
  assert.equal(h.timers.size, 0);
  await h.load(fixture(), currentReconcile);
  await h.load(fixture(2, { anulacao: { id: 1 } }), otherReconcile);
  assert.deepEqual(h.state.data, fixture());
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.events, []);
});

test("stale: older valid read can finish while a newer read is pending", async t => {
  const h = await harness(t);
  await h.load(pending());
  await h.tick(5000);
  await h.reply(h.requests.at(-1));
  const firstGet = h.requests.at(-1);
  await h.tick(5000);
  const secondReconcile = h.requests.at(-1);
  const first = pending();
  first.itens[0].troca_status = "CONCLUIDA";
  await h.reply(firstGet, first);
  assert.deepEqual(h.state.data, first);
  assert.equal(h.state.trocaAguardandoCobranca, false);
  await h.load(fixture(), secondReconcile);
  assert.deepEqual(h.state.data, fixture());
  assert.equal(h.timers.size, 0);
});

test("stale: errors from old reads cannot replace the latest successful read", async t => {
  for (const failure of ["network", "http", "invalid"])
    await t.test(failure, async t => {
      const h = await harness(t);
      await h.load();
      await h.call(s => s.carregarPedido());
      await h.reply(h.requests.at(-1));
      const oldGet = h.requests.at(-1);
      await h.call(s => s.carregarPedido());
      const current = fixture(1, {
        financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 }
      });
      await h.load(current);
      if (failure === "network") await h.fail(oldGet);
      else await h.reply(oldGet, {}, failure === "http" ? 500 : 200);
      assert.deepEqual(h.state.data, current);
      assert.equal(h.state.error, null);
      assert.equal(h.state.loading, false);
      assert.deepEqual(h.events, []);
    });
});

test("stale: loading belongs to the current foreground read", async t => {
  const h = await harness(t);
  await h.reply(h.requests.at(-1));
  const oldGet = h.requests.at(-1);
  await h.render({ orderId: 2 });
  const currentReconcile = h.requests.at(-1);
  await h.reply(oldGet, fixture());
  assert.equal(h.state.data, null);
  assert.equal(h.state.loading, true);
  await h.reply(currentReconcile);
  const firstGet = h.requests.at(-1);
  await h.call(s => s.carregarPedido());
  const newerReconcile = h.requests.at(-1);
  await h.reply(firstGet, fixture(2));
  assert.equal(h.state.loading, true);
  await h.load(fixture(2), newerReconcile);
  assert.equal(h.state.loading, false);
});

test("stale: newer silent success releases superseded foreground loading", async t => {
  const h = await harness(t);
  await h.reply(h.requests.at(-1));
  const oldGet = h.requests.at(-1);
  await h.call(s => s.carregarPedido(true));
  await h.load(pending());
  assert.equal(h.state.loading, false);
  await h.reply(oldGet, fixture());
  assert.deepEqual(h.state.data, pending());
  assert.equal(h.state.loading, false);
});

test("stale: old reload callback cannot invalidate or refresh the new order", async t => {
  const h = await harness(t);
  await h.load();
  const oldReload = h.state.carregarPedido;
  await h.render({ orderId: 2 });
  const count = h.requests.length;
  await h.call(() => oldReload(true));
  assert.equal(h.requests.length, count);
  await h.load(fixture(2));
  assert.deepEqual(h.state.data, fixture(2));
});

test("stale: discarded annulment cannot close children or notify the parent", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.carregarPedido(true));
  await h.reply(h.requests.at(-1));
  const oldGet = h.requests.at(-1);
  await h.render({ orderId: 2 });
  await h.load(fixture(2));
  await h.call(s => {
    s.setAdicionandoItem(true);
    s.setRegistrandoPagamento(true);
    s.setItemTroca(s.data.itens[0]);
  });
  await h.reply(
    oldGet,
    fixture(1, {
      anulacao: { id: 1 },
      financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 }
    })
  );
  assert.deepEqual(h.state.data, fixture(2));
  assert.equal(h.state.adicionandoItem, true);
  assert.equal(h.state.registrandoPagamento, true);
  assert.deepEqual(h.state.itemTroca, fixture(2).itens[0]);
  assert.deepEqual(h.events, []);
});

test("Pix: action identity, synchronous locks, retry, ambiguous/conclusive errors and success", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.gerarPix(undefined, 100);
    s.gerarPix(undefined, 200);
    s.gerarPix(7);
    s.gerarPix(7);
    s.gerarPix(8);
  });
  const pix = h.requests.filter(r => r.url.endsWith("/pix"));
  assert.equal(pix.length, 3);
  assert.deepEqual(
    pix.map(r => r.body),
    [
      { operationKey: "operation-1", valorCentavos: 100 },
      { substituiId: 7, operationKey: "operation-2" },
      { substituiId: 8, operationKey: "operation-3" }
    ]
  );
  for (const r of pix) {
    assert.equal(r.method, "POST");
    assert.deepEqual(r.headers, { "Content-Type": "application/json" });
  }
  await h.fail(pix[0]);
  assert.equal(h.state.pixError, "network");
  assert.equal(h.state.gerando, false);
  assert.equal(h.state.regenerandoId, null);
  await h.call(s => s.gerarPix(undefined, 900));
  assert.equal(h.requests.at(-1).body.operationKey, "operation-1");
  assert.equal(h.requests.at(-1).body.valorCentavos, 900);
  for (const code of ["MERCADO_PAGO_INDISPONIVEL", "OPERACAO_EM_PROCESSAMENTO"]) {
    await h.reply(h.requests.at(-1), { code, error: code }, 503);
    assert.equal(h.state.pixAviso, code);
    assert.equal(h.state.pixError, null);
    await h.call(s => s.gerarPix());
    assert.equal(h.requests.at(-1).body.operationKey, "operation-1");
  }
  await h.reply(h.requests.at(-1), { error: "conclusive" }, 400);
  assert.equal(h.state.pixError, "conclusive");
  await h.call(s => s.gerarPix());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-4");
  await h.reply(h.requests.at(-1));
  assert.equal(h.state.loading, false);
  await h.load();
  await h.call(s => s.gerarPix());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-5");
  await h.fail(pix[1]);
  await h.call(s => s.gerarPix(7));
  assert.equal(h.requests.at(-1).body.operationKey, "operation-2");
});

test("manual: synchronous lock, validation, retry and distinct payload identities", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.abrirRegistroPagamento());
  assert.equal(h.state.valorPagamento, "10,00");
  for (const value of ["", "0", "-1", "abc", "1,001", "9007199254740992"]) {
    const count = h.requests.length;
    await h.call(s => s.setValorPagamento(value));
    await h.call(s => s.registrarPagamento());
    assert.equal(h.state.pagamentoError, "Informe um valor válido.");
    assert.equal(h.requests.length, count);
  }
  await h.call(s => s.setValorPagamento("10,01"));
  await h.call(s => s.registrarPagamento());
  assert.equal(h.state.pagamentoError, "O valor não pode ultrapassar o saldo em aberto.");
  await h.call(s => s.setValorPagamento(" 10,00 "));
  await h.call(s => {
    s.registrarPagamento();
    s.registrarPagamento();
  });
  assert.equal(h.requests.filter(r => r.url.endsWith("/pagamentos")).length, 1);
  const request = h.requests.at(-1);
  assert.deepEqual(request.body, {
    metodo: "DINHEIRO",
    valorCentavos: 1000,
    operationKey: "operation-1"
  });
  assert.deepEqual(request.headers, { "Content-Type": "application/json" });
  await h.fail(request);
  await h.call(s => s.setValorPagamento("2,00"));
  await h.call(s => s.registrarPagamento());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-2");
  await h.reply(h.requests.at(-1), { error: "denied" }, 400);
  assert.equal(h.state.pagamentoError, "denied");
  await h.call(s => s.setRegistrandoPagamento(false));
  assert.equal(h.state.pagamentoKeyRef.current, null);
  // Closing and editing the form must not erase persisted unresolved intents.
  const modal = await readFile("src/admin/Pedidos/PedidoDetalheModal.tsx", "utf8");
  assert.doesNotMatch(modal, /detalhe\.pagamentoKeyRef\.current = null/);
  await h.call(s => {
    s.setValorPagamento("3,00");
    s.setPagamentoError(null);
    s.pagamentoKeyRef.current = null;
  });
  await h.call(s => s.registrarPagamento());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-3");
  await h.fail(h.requests.at(-1));
  await h.call(s => s.selecionarMetodoPagamento("PIX_EXTERNO"));
  await h.call(s => s.registrarPagamento());
  assert.deepEqual(h.requests.at(-1).body, {
    metodo: "PIX_EXTERNO",
    valorCentavos: 300,
    operationKey: "operation-4"
  });
  await h.fail(h.requests.at(-1));
  await h.call(s => s.abrirRegistroPagamento());
  assert.equal(h.state.pagamentoKeyRef.current, "operation-4");
  await h.call(s => s.registrarPagamento());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-4");
  await h.reply(h.requests.at(-1), { ok: true });
  assert.equal(h.state.registrandoPagamento, false);
  assert.equal(h.state.pagamentoKeyRef.current, null);
  assert.equal(h.state.loading, false);
  await h.load(
    fixture(1, { financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 } })
  );
  assert.deepEqual(h.events, ["status:old"]);
  await h.call(s => s.registrarPagamento());
  assert.equal(h.requests.at(-1).body.operationKey, "operation-5");
});

test("callbacks: refreshed refs, captured status/close, order and double notification", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.iniciarEdicaoNome();
    s.setClienteNome(" New ");
  });
  await h.call(s => {
    s.salvarNome();
    s.alterarStatus("PRONTO");
    s.executarArquivamento(true);
    s.carregarPedido(true);
  });
  const [name, status, archive, reconcile] = h.requests.slice(2);
  await h.render({
    onStatusChanged: () => h.events.push("status:new"),
    onClose: () => h.events.push("close:new")
  });
  await h.reply(name, { clienteNome: "Canonical" });
  assert.equal(h.state.data.pedido.cliente_nome, "Canonical");
  await h.reply(status);
  assert.equal(h.state.data.pedido.status_pedido, "PRONTO");
  await h.reply(archive);
  await h.reply(reconcile);
  await h.reply(
    h.requests.at(-1),
    fixture(1, {
      anulacao: { id: 1 },
      financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 }
    })
  );
  assert.deepEqual(h.events, [
    "status:new",
    "status:old",
    "status:new",
    "close:old",
    "status:new",
    "status:new"
  ]);
});

test("name/status/archive: complete payloads, guards, errors, confirmation and unarchive", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.iniciarEdicaoNome());
  assert.equal(h.state.clienteNome, "Cliente");
  for (const [value, message] of [
    [" ", "Informe o nome da cliente."],
    ["x".repeat(201), "O nome deve ter no máximo 200 caracteres."]
  ]) {
    await h.call(s => s.setClienteNome(value));
    await h.call(s => s.salvarNome());
    assert.equal(h.state.nomeError, message);
  }
  await h.call(s => s.setClienteNome(" Cliente "));
  await h.call(s => s.salvarNome());
  assert.equal(h.state.editandoNome, false);
  assert.equal(h.requests.length, 2);
  await h.call(s => s.setClienteNome(" New "));
  await h.call(s => s.salvarNome());
  assert.deepEqual(h.requests.at(-1).body, { clienteNome: "New" });
  assert.equal(h.requests.at(-1).method, "PATCH");
  await h.reply(h.requests.at(-1), { error: "name error" }, 400);
  assert.equal(h.state.nomeError, "name error");
  await h.call(s => s.salvarNome());
  await h.reply(h.requests.at(-1), {});
  assert.equal(h.state.data.pedido.cliente_nome, "New");
  const count = h.requests.length;
  await h.call(s => s.alterarStatus("NOVO"));
  assert.equal(h.requests.length, count);
  await h.call(s => s.alterarStatus("ENTREGUE"));
  assert.deepEqual(h.requests.at(-1).body, { statusPedido: "ENTREGUE" });
  await h.reply(h.requests.at(-1), { error: "status error" }, 400);
  assert.equal(h.state.statusError, "status error");
  assert.equal(h.state.data.pedido.status_pedido, "NOVO");
  await h.call(s => s.clicarArquivar());
  assert.equal(h.state.confirmarArquivamento, true);
  assert.equal(h.requests.length, count + 1);
  await h.call(s => s.executarArquivamento(true));
  assert.deepEqual(h.requests.at(-1).body, { arquivado: true });
  const archive = h.requests.at(-1);
  await h.call(s => s.clicarArquivar());
  assert.equal(h.requests.at(-1), archive);
  await h.reply(archive, { error: "archive error" }, 400);
  assert.equal(h.state.arquivamentoError, "archive error");
  await h.call(s => s.carregarPedido());
  await h.load(fixture(1, { pedido: { ...fixture().pedido, arquivado: 1 } }));
  await h.call(s => s.clicarArquivar());
  assert.deepEqual(h.requests.at(-1).body, { arquivado: false });
  await h.reply(h.requests.at(-1));
  assert.equal(h.state.data.pedido.arquivado, 1);
  assert.deepEqual(h.events.slice(-2), ["status:old", "close:old"]);
});

test("children: history navigation, polling refresh and annulment closes all except history", async t => {
  const h = await harness(t);
  await h.load(pending());
  await h.call(s => {
    s.setHistoricoAberto(true);
    s.verCancelamentoDoHistorico(11);
  });
  assert.equal(h.state.historicoAberto, false);
  assert.equal(h.state.itemCancelamentoPreviewId, 11);
  await h.call(s => {
    s.setHistoricoAberto(true);
    s.verTrocaDoHistorico(11);
  });
  assert.equal(h.state.historicoAberto, false);
  assert.deepEqual(h.state.itemTroca, fixture().itens[0]);
  await h.tick(5000);
  const changed = pending();
  changed.itens[0].troca_status = "CONCLUIDA";
  await h.load(changed);
  assert.equal(h.state.itemTroca.troca_status, "CONCLUIDA");
  assert.equal(h.state.trocaAguardandoCobranca, false);
  await h.call(s => {
    s.setAdicionandoItem(true);
    s.setEditandoNome(true);
    s.setRegistrandoPagamento(true);
    s.setConfirmarArquivamento(true);
    s.setConfirmarExclusao(true);
    s.setHistoricoAberto(true);
    s.carregarPedido(true);
  });
  await h.load(fixture(1, { anulacao: { id: 1 } }));
  for (const key of [
    "adicionandoItem",
    "editandoNome",
    "registrandoPagamento",
    "confirmarArquivamento",
    "confirmarExclusao"
  ])
    assert.equal(h.state[key], false, key);
  assert.equal(h.state.itemTroca, null);
  assert.equal(h.state.itemCancelamentoPreviewId, null);
  assert.equal(h.state.historicoAberto, true);
  assert.equal(h.state.anulado, true);
  await h.call(s => {
    s.verTrocaDoHistorico(11);
    s.verCancelamentoDoHistorico(11);
  });
  assert.equal(h.state.historicoAberto, true);
  assert.equal(h.state.itemTroca, null);
});

test("unmount: late read is discarded, mutation callback and copy timeout survive", async t => {
  const h = await harness(t);
  await h.load(pending());
  await h.call(s => {
    s.copiarCodigo(7, "a");
    s.copiarCodigo(8, "b");
  });
  await h.tick(1999);
  assert.equal(h.state.copiedId, 8);
  await h.tick(1);
  assert.equal(h.state.copiedId, null);
  await h.call(s => {
    s.copiarCodigo(7, "late");
    s.carregarPedido(true);
    s.alterarStatus("PRONTO");
  });
  const reconcile = h.requests.at(-2),
    status = h.requests.at(-1);
  await h.reply(reconcile);
  const get = h.requests.at(-1);
  await h.unmount();
  assert.deepEqual(
    [...h.timers.values()].map(x => x.delay),
    [2000]
  );
  await h.reply(
    get,
    fixture(1, { financeiro: { status: "PAGO", pagoCentavos: 1000, totalCentavos: 1000 } })
  );
  await h.reply(status);
  assert.deepEqual(h.events, ["copy:a", "copy:b", "copy:late", "status:old"]);
  await h.tick(2000);
  assert.equal(h.timers.size, 0);
});

if (!process.env.HOOK_MUTATION)
  test("negative controls: in-memory mutants must fail behavioral assertions", async t => {
    const run = promisify(execFile);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    for (const [mutation, pattern] of Object.entries({
      ordering: "^load:",
      clock: "^polling:",
      polling: "^polling:",
      cleanup: "^polling:",
      retry: "^Pix:",
      identity: "^Pix:",
      lock: "^manual:",
      callback: "^callbacks:",
      reset: "^reset:",
      staleGeneration: "^stale: returning",
      staleOrder: "^reset:",
      staleSequence: "^polling:",
      staleReset: "^stale: returning",
      staleError: "^stale: errors",
      staleLoading: "^stale: loading",
      staleUnmount: "^unmount:",
      intentAmbiguous: "^manual intent: retry",
      intentReopen: "^manual intent: reopen",
      intentPayload: "^manual intent: payload",
      intentOrder: "^manual intent: orders",
      intentSuccess: "^manual intent: conclusive",
      intentValueOnly: "^manual intent: payload",
      intentPremature: "^manual intent: retry"
    })) {
      await t.test(mutation, async () => {
        for (const variant of mutation === "lock" ? Object.keys(lockMutations) : [undefined]) {
          let result;
          try {
            await run(
              process.execPath,
              [
                "--test",
                `--test-name-pattern=${pattern}`,
                "tests/use-pedido-detalhe-refactor-harness.test.mjs"
              ],
              {
                env: { ...childEnv, HOOK_MUTATION: mutation, LOCK_MUTATION: variant },
                timeout: 30000,
                maxBuffer: 2_000_000
              }
            );
          } catch (error) {
            result = error;
          }
          assert.ok(result, `${mutation}${variant ? `/${variant}` : ""} survived`);
          assert.equal(result.code, 1);
          assert.match(result.stdout, /ERR_ASSERTION/);
          assert.doesNotMatch(result.stdout, /Mutation anchor must exist/);
        }
      });
    }
  });
test("reload callbacks: Pix/manual success use latest ref during their silent reload", async t => {
  for (const action of ["pix", "manual"])
    await t.test(action, async t => {
      const h = await harness(t);
      await h.load();
      if (action === "manual") await h.call(s => s.abrirRegistroPagamento());
      await h.call(s => (action === "pix" ? s.gerarPix() : s.registrarPagamento()));
      const request = h.requests.at(-1);
      await h.render({ onStatusChanged: () => h.events.push("status:new") });
      await h.reply(request, action === "manual" ? { ok: true } : {});
      await h.load(
        fixture(1, { financeiro: { status: "PARCIAL", pagoCentavos: 100, totalCentavos: 1000 } })
      );
      assert.deepEqual(h.events, ["status:new"]);
    });
});

test("reset errors: errors, warning, method and clock survive a new order", async t => {
  const h = await harness(t);
  await h.load(pending());
  await h.tick(1000);
  await h.call(s => s.setClienteNome(""));
  await h.call(s => s.salvarNome());
  await h.call(s => {
    s.alterarStatus("PRONTO");
    s.executarArquivamento(true);
    s.gerarPix(7);
  });
  const [status, archive, pix] = h.requests.slice(2);
  await h.reply(status, { error: "status" }, 400);
  await h.reply(archive, { error: "archive" }, 400);
  await h.reply(pix, { error: "pix" }, 400);
  await h.call(s => {
    s.setPixAviso("warning");
    s.selecionarMetodoPagamento("CARTAO");
    s.setPagamentoError("cleared");
    s.carregarPedido(true);
  });
  await h.reply(h.requests.at(-1));
  await h.fail(h.requests.at(-1));
  await h.render({ orderId: 2 });
  assert.deepEqual(
    [
      h.state.error,
      h.state.statusError,
      h.state.arquivamentoError,
      h.state.nomeError,
      h.state.pixError,
      h.state.pixAviso,
      h.state.metodoPagamento,
      h.state.agora,
      h.state.pagamentoError
    ],
    [
      "network",
      "status",
      "archive",
      "Informe o nome da cliente.",
      "pix",
      "warning",
      "CARTAO",
      1000,
      null
    ]
  );
});

const paymentSlot = id => `rp:pedido:${id}:pagamento-manual:intents`;
const savedIntents = (id = 1) => JSON.parse(sessionStorage.getItem(paymentSlot(id)) ?? "[]");

test("manual intent: retry preserves the persisted identity before and after network loss", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.abrirRegistroPagamento();
    s.setValorPagamento("2,00");
    s.selecionarMetodoPagamento("CARTAO");
  });
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  assert.deepEqual(savedIntents(), [
    {
      version: 1,
      state: "pending",
      pedidoId: 1,
      operationKey: first.body.operationKey,
      payload: { metodo: "CARTAO", valorCentavos: 200 }
    }
  ]);
  await h.fail(first);
  assert.equal(savedIntents()[0]?.operationKey, first.body.operationKey);
  await h.call(s => s.registrarPagamento());
  assert.deepEqual(h.requests.at(-1).body, first.body);
});

test("manual intent: reopen restores the original payload and key without treating close as abandonment", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.abrirRegistroPagamento();
    s.setValorPagamento("2,00");
    s.selecionarMetodoPagamento("CARTAO");
  });
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  await h.fail(first);
  await h.call(s => s.setRegistrandoPagamento(false));
  await h.call(s => s.abrirRegistroPagamento());
  assert.equal(h.state.valorPagamento, "2,00");
  assert.equal(h.state.metodoPagamento, "CARTAO");
  assert.equal(h.state.pagamentoKeyRef.current, first.body.operationKey);
  await h.call(s => s.registrarPagamento());
  assert.deepEqual(h.requests.at(-1).body, first.body);
});

test("manual intent: payload changes create distinct pending intentions, including equal values", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.abrirRegistroPagamento();
    s.setValorPagamento("2,00");
  });
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  await h.fail(first);
  await h.call(s => s.selecionarMetodoPagamento("CARTAO"));
  await h.call(s => s.registrarPagamento());
  const second = h.requests.at(-1);
  assert.notEqual(second.body.operationKey, first.body.operationKey);
  assert.equal(savedIntents().length, 2);
  await h.fail(second);
  await h.call(s => {
    s.selecionarMetodoPagamento("DINHEIRO");
    s.setValorPagamento("3,00");
  });
  await h.call(s => s.registrarPagamento());
  const third = h.requests.at(-1);
  assert.notEqual(third.body.operationKey, first.body.operationKey);
  await h.fail(third);
  await h.call(s => s.setValorPagamento("2,00"));
  await h.call(s => s.registrarPagamento());
  assert.deepEqual(h.requests.at(-1).body, first.body);
  await h.fail(h.requests.at(-1));
  await h.call(s => s.setRegistrandoPagamento(false));
  await h.call(s => s.abrirRegistroPagamento());
  assert.equal(h.state.valorPagamento, "2,00");
  assert.equal(h.state.metodoPagamento, "DINHEIRO");
});

test("manual intent: orders isolate keys and reject a foreign record in their own slot", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.abrirRegistroPagamento());
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  await h.fail(first);
  sessionStorage.setItem(paymentSlot(2), sessionStorage.getItem(paymentSlot(1)));
  await h.render({ orderId: 2 });
  await h.load(fixture(2));
  await h.call(s => s.abrirRegistroPagamento());
  await h.call(s => s.registrarPagamento());
  const second = h.requests.at(-1);
  assert.equal(second.url, "/api/admin/pedidos/2/pagamentos");
  assert.notEqual(second.body.operationKey, first.body.operationKey);
  assert.equal(savedIntents(2)[0].pedidoId, 2);
  await h.fail(second);
  await h.render({ orderId: 1 });
  await h.load();
  await h.call(s => s.abrirRegistroPagamento());
  await h.call(s => s.registrarPagamento());
  assert.deepEqual(h.requests.at(-1).body, first.body);
});

test("manual intent: conclusive success allows two legitimate equal payments with different keys", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => {
    s.abrirRegistroPagamento();
    s.setValorPagamento("2,00");
  });
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  await h.reply(first, { ok: true }, 201);
  assert.deepEqual(savedIntents(), []);
  assert.equal(h.state.pagamentoPendente, false);
  await h.load();
  await h.call(s => {
    s.abrirRegistroPagamento();
    s.setValorPagamento("2,00");
  });
  await h.call(s => s.registrarPagamento());
  assert.notEqual(h.requests.at(-1).body.operationKey, first.body.operationKey);
  assert.equal(h.requests.at(-1).body.valorCentavos, first.body.valorCentavos);
});

test("manual intent: definitive rejection clears only the rejected intention", async t => {
  for (const [status, code] of [
    [400, undefined],
    [409, "VALOR_ACIMA_DO_SALDO"],
    [409, "OPERACAO_CONFLITO_PAYLOAD"],
    [404, "PEDIDO_NAO_ENCONTRADO"]
  ])
    await t.test(`${status}/${code}`, async t => {
      const h = await harness(t);
      await h.load();
      await h.call(s => s.abrirRegistroPagamento());
      await h.call(s => s.registrarPagamento());
      const first = h.requests.at(-1);
      await h.reply(first, { error: "rejected", ...(code ? { code } : {}) }, status);
      assert.deepEqual(savedIntents(), []);
      assert.equal(h.state.pagamentoKeyRef.current, null);
      await h.call(s => s.registrarPagamento());
      assert.notEqual(h.requests.at(-1).body.operationKey, first.body.operationKey);
    });
});

test("manual intent: ambiguous HTTP, authentication and malformed responses preserve identity", async t => {
  for (const [status, code] of [
    [500, undefined],
    [408, undefined],
    [429, undefined],
    [401, undefined],
    [403, undefined],
    [409, "OPERACAO_EM_PROCESSAMENTO"],
    [409, "OPERACAO_INCOMPLETA"],
    [201, undefined]
  ])
    await t.test(`${status}/${code}`, async t => {
      const h = await harness(t);
      await h.load();
      await h.call(s => s.abrirRegistroPagamento());
      await h.call(s => s.registrarPagamento());
      const first = h.requests.at(-1);
      await h.reply(first, { error: "uncertain", ...(code ? { code } : {}) }, status);
      assert.equal(savedIntents()[0].operationKey, first.body.operationKey);
      await h.call(s => s.registrarPagamento());
      assert.deepEqual(h.requests.at(-1).body, first.body);
    });
});

test("manual intent: invalid JSON and storage failure cannot turn uncertainty into a new payment", async t => {
  const h = await harness(t);
  await h.load();
  await h.call(s => s.abrirRegistroPagamento());
  await h.call(s => s.registrarPagamento());
  const first = h.requests.at(-1);
  await h.call(() =>
    first.resolve({
      ok: true,
      status: 201,
      json: async () => {
        throw new Error("truncated JSON");
      }
    })
  );
  assert.equal(savedIntents()[0].operationKey, first.body.operationKey);
  const count = h.requests.length;
  t.mock.method(sessionStorage.constructor.prototype, "setItem", () => {
    throw new Error("quota");
  });
  await h.call(s => s.registrarPagamento());
  assert.equal(h.requests.length, count);
  assert.match(h.state.pagamentoError, /armazenamento/);
});

test("manual intent: corrupt and resolved records are never reused", async t => {
  for (const raw of [
    "{",
    "null",
    JSON.stringify([{ version: 0 }]),
    JSON.stringify([
      {
        version: 1,
        state: "resolved",
        pedidoId: 1,
        operationKey: "old-operation",
        payload: { metodo: "DINHEIRO", valorCentavos: 1000 }
      }
    ]),
    JSON.stringify([
      {
        version: 1,
        state: "pending",
        pedidoId: 1,
        operationKey: "old-operation",
        payload: { metodo: "DINHEIRO", valorCentavos: "1000" }
      }
    ])
  ])
    await t.test(raw, async t => {
      const h = await harness(t);
      sessionStorage.setItem(paymentSlot(1), raw);
      await h.load();
      await h.call(s => s.abrirRegistroPagamento());
      await h.call(s => s.registrarPagamento());
      assert.equal(h.requests.at(-1).body.operationKey, "operation-1");
      assert.equal(savedIntents()[0].state, "pending");
    });
});

test("manual intent integration: committed payment, lost response, reload and replay", async t => {
  const { app, fixture: databaseFixture, state } = await import("./helpers/b3.mjs");
  for (const mode of ["retry", "reopen", "remount", "reload", "fully paid reload"])
    await t.test(mode, async t => {
      const db = await databaseFixture(t, { ledger: false });
      const session = await app.auth.createSession(db, 1);
      const commit = request =>
        app.adminPayment.onRequestPost({
          env: { DB: db },
          params: { id: "1" },
          request: new Request("https://local.test/api/admin/pedidos/1/pagamentos", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://local.test",
              Cookie: session.cookie.split(";")[0]
            },
            body: JSON.stringify(request.body)
          })
        });
      const h = await harness(t, { realTimers: true });
      await h.load(fixture(1, { capacidadeCobravelCentavos: 10000 }));
      await h.call(s => {
        s.abrirRegistroPagamento();
        s.setValorPagamento(mode === "fully paid reload" ? "100,00" : "30,00");
      });
      await h.call(s => s.registrarPagamento());
      const first = h.requests.at(-1);
      assert.equal((await commit(first)).status, 201);
      assert.equal((await state(db)).pagamentos.length, 1);
      await h.fail(first);
      const persisted = Object.entries(dom.window.sessionStorage);
      let reloaded = h;
      if (mode === "retry" || mode === "reopen") {
        await h.call(s => s.carregarPedido(true));
        await h.load(fixture(1, { capacidadeCobravelCentavos: 7000 }));
        if (mode === "reopen") {
          await h.call(s => s.setRegistrandoPagamento(false));
          await h.call(s => s.abrirRegistroPagamento());
        }
      } else {
        await h.unmount();
        // Reload restores only serialized Storage, with a fresh hook and key generator.
        const reloadDom = new JSDOM("", { url: "https://local.test" });
        t.after(() => reloadDom.window.close());
        for (const [key, value] of persisted) reloadDom.window.sessionStorage.setItem(key, value);
        reloaded = await harness(t, {
          preserveStorage: true,
          storage: mode === "remount" ? dom.window.sessionStorage : reloadDom.window.sessionStorage,
          keyOffset: 100,
          realTimers: true
        });
        await reloaded.load(
          fixture(1, { capacidadeCobravelCentavos: mode === "fully paid reload" ? 0 : 7000 })
        );
        await reloaded.call(s => s.abrirRegistroPagamento());
      }
      assert.equal(
        reloaded.state.valorPagamento,
        mode === "fully paid reload" ? "100,00" : "30,00"
      );
      await reloaded.call(s => s.registrarPagamento());
      const retry = reloaded.requests.at(-1);
      const response = await commit(retry);
      assert.equal(response.status, 201);
      assert.equal((await state(db)).pagamentos.length, 1, "reload must not create a second fact");
      assert.equal((await state(db)).operacoes.length, 1);
      assert.equal((await state(db)).alocacoes.length, 1);
      assert.equal(retry.body.operationKey, first.body.operationKey);
      const body = await response.json();
      assert.equal(body.replay, true);
      await reloaded.reply(retry, body, response.status);
      assert.deepEqual(savedIntents(), []);
      await reloaded.load();
    });
});
