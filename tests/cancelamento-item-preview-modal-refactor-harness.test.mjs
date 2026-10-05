import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Characterization: real component, keys, reconciliation and modal hook; only HTTP is fake.
// Mutations are compiled in memory, never written to production source.
const sourcePath = "src/admin/Pedidos/CancelamentoItemPreviewModal.tsx";
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
              buildApi.onLoad({ filter: /CancelamentoItemPreviewModal\.tsx$/ }, () => {
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
const base = "/api/admin/pedidos/7/itens/11";
const legs = [
  {
    pagamentoId: 31,
    pagamentoAlocacaoId: 41,
    metodo: "DINHEIRO",
    valorCentavos: 301,
    confirmacaoManualPermitida: true
  },
  {
    pagamentoId: 32,
    pagamentoAlocacaoId: 42,
    metodo: "PIX_MP",
    valorCentavos: 700,
    confirmacaoManualPermitida: false
  }
];
function preview({ paid = 1001, state = "BAIXADO", fingerprint = "preview-1" } = {}) {
  return {
    pedidoId: 7,
    previewFingerprint: fingerprint,
    item: {
      id: 11,
      nome: "Bolo",
      quantidade: 3,
      valorCentavos: 3003,
      statusItem: "ATIVO",
      estoqueEstado: state
    },
    financeiro: {
      valorItemCentavos: 3003,
      coberturaConfirmadaCentavos: paid,
      valorNaoPagoCentavos: 3003 - paid,
      reembolsoNecessarioCentavos: paid
    },
    pagamentos: paid
      ? [
          {
            pagamentoId: 31,
            pagamentoAlocacaoId: 41,
            metodo: "DINHEIRO",
            reembolsoPropostoCentavos: paid
          }
        ]
      : [],
    estoque: {
      estadoAtual: state,
      acaoPadrao:
        state === "RESERVADO" ? "LIBERAR_RESERVA" : state === "BAIXADO" ? "NAO_REPOR" : "NENHUMA"
    },
    bloqueios: [],
    cancelamentoExecutavel: true
  };
}
function cancellation(status = "AGUARDANDO_REEMBOLSO") {
  return {
    id: 51,
    status,
    estoqueAcao: "NAO_REPOR",
    estoqueEstado: "BAIXADO",
    reembolsoPendenteCentavos: status === "CONCLUIDO" ? 0 : 1001,
    pernasPendentes: status === "CONCLUIDO" ? [] : structuredClone(legs),
    reembolsosConfirmados: [],
    financeiro: {
      status: "PARCIAL",
      totalCentavos: 3003,
      liquidoCentavos: 1001,
      saldoCentavos: 2002
    }
  };
}
function response(body, ok = true) {
  return { ok, json: async () => structuredClone(body) };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const money = text => text.replaceAll("\u00a0", " ");
function value(label) {
  const row = [...document.querySelectorAll(".cancelpreview-values > div")].find(
    node => node.querySelector("span")?.textContent === label
  );
  assert.ok(row, label);
  return money(row.querySelector("strong").textContent);
}
async function harness(t, { api = ui, props = {}, route, initialPreview = preview() } = {}) {
  const h = {
    calls: [],
    events: [],
    changed: 0,
    closed: 0,
    preview: initialPreview,
    cancellation: cancellation(),
    refundStatus: "PROCESSANDO",
    post: response({ error: "Cancel rejected" }, false)
  };
  h.props = {
    orderId: 7,
    itemId: 11,
    onClose: () => {
      h.closed++;
      h.events.push("close");
    },
    onChanged: () => {
      h.changed++;
      h.events.push("changed");
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
    h.events.push(`${call.method} ${url}`);
    if (route) {
      const result = route(call, h);
      if (result !== undefined) return result;
    }
    if (url.endsWith("/reconciliar")) return response({});
    if (url.endsWith("/cancelamento-preview")) return response(h.preview);
    if (url.endsWith("/reembolsos"))
      return response({ cancelamento: h.cancellation, refundStatus: h.refundStatus });
    if (url.endsWith("/cancelamentos") && call.method === "GET")
      return response({ cancelamento: h.cancellation });
    if (url.endsWith("/cancelamentos") && call.method === "POST") return h.post;
    assert.fail(`Unexpected request: ${call.method} ${url}`);
  };
  h.act = callback =>
    api.act(async () => {
      await callback();
    });
  h.mount = async () => {
    document.querySelector("#opener").focus();
    await h.act(() => {
      h.root = api.mount(document.querySelector("#root"), h.props);
    });
  };
  h.unmount = async () => {
    if (h.root) {
      await h.act(() => h.root.unmount());
      h.root = null;
    }
  };
  t.after(h.unmount);
  h.click = async node => {
    assert.ok(node, "Clickable element exists");
    await h.act(() => node.click());
  };
  h.submit = () => h.click(document.querySelector(".cancelpreview-confirm"));
  h.refund = index => h.click(document.querySelectorAll(".cancelpreview-refund-leg button")[index]);
  h.reason = async reason =>
    h.act(() => {
      const node = document.querySelector("textarea");
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(
        node,
        reason
      );
      node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  h.action = async (action = "REPOR") => {
    await h.click(document.querySelector(".cancelpreview-dropdown-trigger"));
    await h.click(
      [...document.querySelectorAll(".cancelpreview-dropdown-option")].find(
        node =>
          node.textContent ===
          (action === "REPOR" ? "Produto devolvido: repor no estoque" : "Não repor no estoque")
      )
    );
  };
  h.update = async props => {
    h.props = { ...h.props, ...props };
    await h.act(() => h.root.update(h.props));
  };
  h.settle = (pending, body) => h.act(() => pending.resolve(body));
  h.posts = () =>
    h.calls.filter(call => call.method === "POST" && call.url.endsWith("/cancelamentos"));
  h.refunds = () => h.calls.filter(call => call.url.endsWith("/reembolsos"));
  await h.mount();
  return h;
}

for (const [label, paid, unpaid] of [
  ["unpaid", 0, "R$ 30,03"],
  ["partially paid", 1001, "R$ 20,02"],
  ["fully paid", 3003, "R$ 0,00"]
]) {
  test(`preview ${label}: exact cent values and formatting`, async t => {
    const h = await harness(t, { initialPreview: preview({ paid }) });
    assert.deepEqual(
      h.calls.map(call => [call.method, call.url]),
      [["GET", `${base}/cancelamento-preview`]]
    );
    assert.equal(value("Valor do item"), "R$ 30,03");
    assert.equal(
      value("Valor já pago associado"),
      paid === 0 ? "R$ 0,00" : paid === 1001 ? "R$ 10,01" : "R$ 30,03"
    );
    assert.equal(value("Valor ainda não pago"), unpaid);
    assert.equal(value("Valor a devolver"), value("Valor já pago associado"));
    assert.equal(
      money(document.querySelector(".cancelpreview-product span").textContent),
      "3x · R$ 30,03"
    );
    assert.equal(document.querySelector(".cancelpreview-confirm").disabled, false);
    assert.equal(document.querySelector(".cancelpreview-state"), null);
    if (!paid)
      assert.match(
        document.querySelector(".cancelpreview-payments").textContent,
        /Nenhum pagamento confirmado/
      );
  });
}
async function payloadContract(t, api = ui) {
  const h = await harness(t, { api });
  await h.reason("  Cliente pediu  ");
  await h.action();
  await h.submit();
  assert.equal(document.querySelector('input[type="number"]'), null);
  assert.equal(document.querySelector("textarea").maxLength, 300);
  assert.equal(h.posts()[0].url, `${base}/cancelamentos`);
  assert.deepEqual(h.posts()[0].headers, { "Content-Type": "application/json" });
  const { operationKey, ...body } = h.posts()[0].body;
  assert.equal(typeof operationKey, "string");
  assert.ok(operationKey.length > 0);
  assert.deepEqual(body, {
    motivo: "  Cliente pediu  ",
    estoqueAcao: "REPOR",
    previewFingerprint: "preview-1"
  });
  assert.equal(Object.hasOwn(body, "quantidade"), false);
  assert.equal(Object.hasOwn(body, "quantity"), false);
  assert.equal(h.changed, 0);
}
test("whole line quantity >1: complete cancellation payload has no quantity", payloadContract);

for (const [state, action] of [
  ["RESERVADO", "LIBERAR_RESERVA"],
  ["BAIXADO", "NAO_REPOR"],
  ["SEM_RESERVA", "NENHUMA"],
  ["LIBERADO", "NENHUMA"]
]) {
  test(`stock ${state}: default ${action} and complete line`, async t => {
    const h = await harness(t, { initialPreview: preview({ state }) });
    assert.equal(
      Boolean(document.querySelector(".cancelpreview-dropdown-trigger")),
      state === "BAIXADO"
    );
    assert.match(
      document.querySelector(".cancelpreview-stock").textContent,
      state === "RESERVADO"
        ? /reserva de 3 unidades será liberada/
        : state === "BAIXADO"
          ? /confirmação física/
          : /Nenhum efeito físico/
    );
    await h.submit();
    assert.equal(h.posts()[0].body.estoqueAcao, action);
  });
}
async function blockedContract(t, api = ui) {
  const p = preview();
  p.cancelamentoExecutavel = false;
  p.bloqueios = [
    { codigo: "PIX", mensagem: "Pix pendente" },
    { codigo: "PRONTO", mensagem: "Pedido pronto" }
  ];
  const h = await harness(t, { api, initialPreview: p });
  assert.equal(document.querySelector(".cancelpreview-confirm").disabled, true);
  assert.deepEqual(
    [...document.querySelectorAll(".cancelpreview-block")].map(node => node.textContent),
    ["Pix pendente", "Pedido pronto"]
  );
  await h.submit();
  assert.equal(h.posts().length, 0);
}
test("blocks render individually and disable confirmation", blockedContract);

async function retryContract(t, api = ui) {
  const h = await harness(t, { api });
  await h.submit();
  await h.submit();
  assert.equal(h.posts().length, 2);
  assert.equal(h.posts()[0].body.operationKey, h.posts()[1].body.operationKey);
  assert.equal(document.querySelector(".cancelpreview-error").textContent, "Cancel rejected");
  assert.equal(h.changed, 0);
  await h.reason("Changed reason");
  await h.action();
  await h.submit();
  assert.equal(h.posts()[2].body.operationKey, h.posts()[0].body.operationKey);
  assert.equal(h.posts()[2].body.motivo, "Changed reason");
  assert.equal(h.posts()[2].body.estoqueAcao, "REPOR");
  assert.equal(document.querySelector(".cancelpreview-confirm").disabled, false);
}
test("retry and changed reason/stock action preserve the current operation key", retryContract);
for (const hasPreview of [true, false]) {
  test(`PREVIEW_OBSOLETO ${hasPreview ? "with" : "without"} replacement controls key renewal`, async t => {
    const h = await harness(t);
    await h.reason("Keep reason");
    await h.action();
    const fresh = preview({ fingerprint: "preview-2", paid: 3003 });
    h.post = response(
      {
        error: "Review again",
        code: "PREVIEW_OBSOLETO",
        ...(hasPreview ? { preview: fresh } : {})
      },
      false
    );
    await h.submit();
    assert.equal(h.posts().length, 1, "No automatic resubmission");
    assert.equal(document.querySelector("textarea").value, "Keep reason");
    assert.equal(document.querySelector(".cancelpreview-error").textContent, "Review again");
    await h.submit();
    const [first, second] = h.posts().map(call => call.body);
    if (hasPreview) {
      assert.notEqual(second.operationKey, first.operationKey);
      assert.equal(second.previewFingerprint, "preview-2");
      assert.equal(second.estoqueAcao, "NAO_REPOR");
      assert.equal(value("Valor a devolver"), "R$ 30,03");
    } else {
      assert.equal(second.operationKey, first.operationKey);
      assert.equal(second.previewFingerprint, "preview-1");
      assert.equal(second.estoqueAcao, "REPOR");
    }
    assert.equal(h.changed, 0);
  });
}
test("saving awaits POST and callback; success stays open and renders current finances", async t => {
  const pending = deferred();
  const callback = deferred();
  const h = await harness(t, {
    route: call =>
      call.method === "POST" && call.url.endsWith("/cancelamentos") ? pending.promise : undefined
  });
  await h.update({
    onChanged: async () => {
      h.changed++;
      h.events.push("changed:start");
      await callback.promise;
      h.events.push("changed:end");
    }
  });
  await h.submit();
  assert.equal(document.querySelector(".cancelpreview-confirm").textContent, "Confirmando...");
  assert.equal(document.querySelector(".cancelpreview-confirm").disabled, true);
  assert.equal(document.querySelector(".cancelpreview-dropdown-trigger").disabled, true);
  await h.submit();
  assert.equal(h.posts().length, 1);
  assert.equal(h.changed, 0);
  await h.settle(pending, response({ cancelamento: cancellation() }));
  assert.equal(h.changed, 1);
  assert.equal(h.closed, 0);
  assert.equal(document.querySelector(".cancelpreview-confirm"), null);
  assert.equal(
    document.querySelector(".cancelpreview-success strong").textContent,
    "Aguardando reembolso"
  );
  assert.match(document.querySelector(".cancelpreview-success span").textContent, /continua ativo/);
  assert.equal(value("Total atual"), "R$ 30,03");
  assert.equal(value("Pago líquido"), "R$ 10,01");
  assert.equal(value("Saldo"), "R$ 20,02");
  assert.equal(value("Estoque do item"), "BAIXADO");
  assert.ok(
    [...document.querySelectorAll(".cancelpreview-refund-leg button")].every(node => node.disabled)
  );
  await h.settle(callback, undefined);
  assert.deepEqual(h.events, [
    `GET ${base}/cancelamento-preview`,
    `POST ${base}/cancelamentos`,
    "changed:start",
    "changed:end"
  ]);
  assert.ok(
    [...document.querySelectorAll(".cancelpreview-refund-leg button")].every(node => !node.disabled)
  );
});

async function refundPayloadContract(t, api = ui) {
  const h = await harness(t, { api, props: { existingCancellationId: 51 } });
  const rows = [...document.querySelectorAll(".cancelpreview-refund-leg")];
  assert.deepEqual(
    rows.map(node => node.querySelector("strong").textContent),
    ["Dinheiro", "Pix Mercado Pago"]
  );
  assert.deepEqual(
    rows.map(node => money(node.querySelector("span").textContent)),
    ["R$ 3,01", "R$ 7,00"]
  );
  assert.deepEqual(
    rows.map(node => node.querySelector("button").textContent),
    ["Confirmar devolução", "Solicitar estorno"]
  );
  for (const index of [0, 1]) {
    await h.refund(index);
    const call = h.refunds()[index];
    assert.equal(call.url, "/api/admin/pedidos/7/cancelamentos/51/reembolsos");
    assert.deepEqual(call.headers, { "Content-Type": "application/json" });
    const { operationKey, ...body } = call.body;
    assert.ok(operationKey);
    assert.deepEqual(body, {
      pagamentoId: legs[index].pagamentoId,
      pagamentoAlocacaoId: legs[index].pagamentoAlocacaoId,
      valorCentavos: legs[index].valorCentavos,
      confirmacao: true
    });
  }
  assert.equal(h.changed, 2);
  assert.deepEqual(h.events, [
    "POST /api/admin/pedidos/7/reconciliar",
    `GET ${base}/cancelamentos`,
    "POST /api/admin/pedidos/7/cancelamentos/51/reembolsos",
    "changed",
    "POST /api/admin/pedidos/7/cancelamentos/51/reembolsos",
    "changed"
  ]);
}
test(
  "manual and remote refunds: exact payloads, cents, labels and callback sequence",
  refundPayloadContract
);
async function refundKeysContract(t, api = ui) {
  const h = await harness(t, { api, props: { existingCancellationId: 51 } });
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
  await h.refund(1);
  assert.equal(h.refunds()[5].body.operationKey, keys[2]);
}
test(
  "refund keys are independent, retry until confirmed, and discarded only for the confirmed allocation",
  refundKeysContract
);
for (const status of ["PENDENTE", "PROCESSANDO", "INCONCLUSIVO", "RECUSADO", undefined]) {
  test(`refund ${status ?? "missing status"}: current local key retention/discard`, async t => {
    const h = await harness(t, { props: { existingCancellationId: 51 } });
    h.refundStatus = status;
    await h.refund(0);
    await h.refund(0);
    if (status === undefined)
      assert.notEqual(h.refunds()[0].body.operationKey, h.refunds()[1].body.operationKey);
    else assert.equal(h.refunds()[0].body.operationKey, h.refunds()[1].body.operationKey);
  });
}
test("persisted remote keys and labels govern eligibility, including terminal refusal", async t => {
  const h = await harness(t, { props: { existingCancellationId: 51 } });
  for (const [status, label, runnable] of [
    ["PENDENTE", "Aguardando envio", true],
    ["PROCESSANDO", "Processando", true],
    ["INCONCLUSIVO", "Verificar novamente", true],
    ["RECUSADO", "Recusado pelo provedor", false],
    ["CONFIRMADO", "Confirmado", false]
  ]) {
    h.cancellation.pernasPendentes[1].refundRemoto = {
      status,
      operationKey: "persisted-key",
      podeVerificar: true
    };
    await h.update({ existingCancellationId: h.props.existingCancellationId + 1 });
    const row = document.querySelectorAll(".cancelpreview-refund-leg")[1];
    assert.match(row.textContent, new RegExp(label));
    assert.equal(Boolean(row.querySelector("button")), runnable);
    if (runnable) {
      await h.refund(1);
      assert.equal(h.refunds().at(-1).body.operationKey, "persisted-key");
    }
  }
  h.cancellation.pernasPendentes[1].refundRemoto.podeVerificar = false;
  h.cancellation.pernasPendentes[1].refundRemoto.status = "PROCESSANDO";
  await h.update({ existingCancellationId: 99 });
  assert.equal(
    document.querySelectorAll(".cancelpreview-refund-leg")[1].querySelector("button"),
    null
  );
});
test("confirmed cancellation shows refund history and closes without another mutation", async t => {
  const h = await harness(t, {
    props: { existingCancellationId: 51 },
    route: (call, h) => {
      if (call.url.endsWith("/cancelamentos")) {
        h.cancellation = cancellation("CONCLUIDO");
        h.cancellation.financeiro.saldoCentavos = -101;
        h.cancellation.reembolsosConfirmados = [{ id: 61, metodo: "PIX_MP", valorCentavos: 101 }];
      }
    }
  });
  assert.equal(
    document.querySelector(".cancelpreview-success strong").textContent,
    "Cancelamento concluído"
  );
  assert.equal(document.querySelector(".cancelpreview-success span"), null);
  assert.equal(value("Saldo"), "-R$ 1,01");
  assert.match(
    money(document.querySelector(".cancelpreview-section").textContent),
    /Pix Mercado PagoR\$ 1,01Confirmado/
  );
  assert.equal(document.querySelectorAll(".cancelpreview-refund-leg button").length, 0);
  await h.click(document.querySelector(".cancelpreview-footer button"));
  assert.equal(h.closed, 1);
  assert.equal(h.refunds().length, 0);
});
async function orderContract(t, api = ui) {
  const pending = deferred();
  const h = await harness(t, {
    api,
    props: { existingCancellationId: 51 },
    route: call => (call.url.endsWith("/reconciliar") ? pending.promise : undefined)
  });
  assert.deepEqual(
    h.calls.map(call => [call.method, call.url]),
    [["POST", "/api/admin/pedidos/7/reconciliar"]]
  );
  assert.equal(document.querySelector(".cancelpreview-state").textContent, "Calculando impacto...");
  await h.settle(pending, response({}));
  assert.deepEqual(
    h.calls.map(call => [call.method, call.url]),
    [
      ["POST", "/api/admin/pedidos/7/reconciliar"],
      ["GET", `${base}/cancelamentos`]
    ]
  );
  assert.equal(document.querySelector(".cancelpreview-state"), null);
  assert.ok(document.querySelector(".cancelpreview-success"));
}
test("existing cancellation waits for reconciliation before the read-only GET", orderContract);
for (const failure of ["network", "http"]) {
  test(`reconciliation ${failure} failure remains best-effort`, async t => {
    const h = await harness(t, {
      props: { existingCancellationId: 51 },
      route: call => {
        if (call.url.endsWith("/reconciliar"))
          return failure === "network"
            ? Promise.reject(new Error("offline"))
            : response({ error: "Reconcile rejected" }, false);
      }
    });
    assert.equal(h.calls[1].url, `${base}/cancelamentos`);
    assert.equal(document.querySelector(".cancelpreview-error"), null);
    assert.ok(document.querySelector(".cancelpreview-success"));
  });
}
for (const endpoint of ["preview", "existing", "cancel", "refund"]) {
  for (const failure of ["network", "http", "json"]) {
    test(`${endpoint} ${failure} error: message, loading/saving reset and no callback`, async t => {
      let failing = true;
      const existing = endpoint === "existing" || endpoint === "refund";
      const h = await harness(t, {
        props: existing ? { existingCancellationId: 51 } : {},
        route: call => {
          const target =
            endpoint === "preview"
              ? call.url.endsWith("/cancelamento-preview")
              : endpoint === "existing"
                ? call.url.endsWith("/cancelamentos") && call.method === "GET"
                : endpoint === "cancel"
                  ? call.url.endsWith("/cancelamentos") && call.method === "POST"
                  : call.url.endsWith("/reembolsos");
          if (!target || !failing) return undefined;
          if (failure === "network") return Promise.reject(new Error("offline"));
          if (failure === "http") return response({ error: "Rejected" }, false);
          return {
            ok: false,
            json: async () => {
              throw new SyntaxError("invalid JSON");
            }
          };
        }
      });
      if (endpoint === "cancel") await h.submit();
      if (endpoint === "refund") await h.refund(0);
      const fallback =
        endpoint === "cancel"
          ? "Falha ao cancelar item"
          : endpoint === "refund"
            ? "Falha ao registrar devolução"
            : "Falha ao carregar cancelamento";
      assert.equal(
        document.querySelector(".cancelpreview-error").textContent,
        failure === "network" ? "offline" : failure === "http" ? "Rejected" : fallback
      );
      assert.equal(document.querySelector(".cancelpreview-state"), null);
      assert.equal(h.changed, 0);
      assert.equal(h.closed, 0);
      if (endpoint === "cancel")
        assert.equal(document.querySelector(".cancelpreview-confirm").disabled, false);
      if (endpoint === "refund") {
        assert.ok(
          [...document.querySelectorAll(".cancelpreview-refund-leg button")].every(
            node => !node.disabled
          )
        );
        failing = false;
        await h.refund(0);
        assert.equal(h.refunds()[0].body.operationKey, h.refunds()[1].body.operationKey);
        assert.equal(h.changed, 1);
      }
    });
  }
}
for (const endpoint of ["preview", "existing"]) {
  test(`${endpoint} late GET after unmount does not populate a remounted modal`, async t => {
    const pending = deferred();
    let first = true;
    const h = await harness(t, {
      props: endpoint === "existing" ? { existingCancellationId: 51 } : {},
      route: call => {
        if (first && call.method === "GET") {
          first = false;
          return pending.promise;
        }
      }
    });
    assert.ok(document.querySelector(".cancelpreview-state"));
    await h.unmount();
    assert.equal(document.querySelector(".cancelpreview-card"), null);
    h.preview = preview({ paid: 0 });
    h.cancellation = cancellation("CONCLUIDO");
    await h.mount();
    await h.settle(
      pending,
      response(endpoint === "preview" ? preview({ paid: 3003 }) : { cancelamento: cancellation() })
    );
    if (endpoint === "preview") assert.equal(value("Valor a devolver"), "R$ 0,00");
    else
      assert.equal(
        document.querySelector(".cancelpreview-success strong").textContent,
        "Cancelamento concluído"
      );
    assert.equal(h.changed, 0);
  });
}
test("close X, Escape, genuine overlay, Voltar and two-way focus trap", async t => {
  const h = await harness(t);
  const close = document.querySelector(".cancelpreview-close");
  const last = document.querySelector(".cancelpreview-confirm");
  assert.equal(close.getAttribute("aria-label"), "Fechar");
  assert.equal(document.querySelector('[role="dialog"]').getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement, close);
  last.focus();
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
  assert.equal(document.activeElement, last);
  await h.click(close);
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(h.closed, 2);
  const overlay = document.querySelector(".cancelpreview-overlay");
  await h.click(overlay);
  assert.equal(h.closed, 2);
  overlay.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  document
    .querySelector(".cancelpreview-card")
    .dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
  await h.click(overlay);
  assert.equal(h.closed, 2);
  overlay.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  overlay.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true }));
  await h.click(overlay);
  await h.click(document.querySelector(".cancelpreview-footer button"));
  assert.deepEqual(h.events.slice(1), ["close", "close", "close", "close"]);
  assert.equal(h.changed, 0);
  await h.unmount();
  assert.equal(document.activeElement, document.querySelector("#opener"));
});
for (const endpoint of ["cancel", "refund"]) {
  test(`closing during ${endpoint} saving unmounts but its late success still calls onChanged`, async t => {
    const pending = deferred();
    const h = await harness(t, {
      props: endpoint === "refund" ? { existingCancellationId: 51 } : {},
      route: call => {
        if (call.method === "POST" && !call.url.endsWith("/reconciliar")) return pending.promise;
      }
    });
    await h.update({
      onClose: () => {
        h.closed++;
        h.events.push("close");
        h.root.unmount();
        h.root = null;
      }
    });
    if (endpoint === "refund") {
      await h.refund(0);
      await h.refund(1);
      assert.equal(h.refunds().length, 1);
    } else await h.submit();
    await h.click(document.querySelector(".cancelpreview-close"));
    assert.equal(document.querySelector(".cancelpreview-card"), null);
    assert.equal(h.changed, 0);
    await h.settle(
      pending,
      response({ cancelamento: cancellation("CONCLUIDO"), refundStatus: "CONFIRMADO" })
    );
    assert.equal(h.changed, 1);
    assert.equal(h.closed, 1);
    assert.deepEqual(h.events.slice(-2), ["close", "changed"]);
  });
}
test("remount resets reason, stock choice, error, dropdown and cancellation key", async t => {
  const h = await harness(t);
  await h.reason("Old reason");
  await h.action();
  await h.submit();
  const oldKey = h.posts()[0].body.operationKey;
  await h.click(document.querySelector(".cancelpreview-dropdown-trigger"));
  await h.unmount();
  await h.mount();
  assert.equal(document.querySelector("textarea").value, "");
  assert.equal(document.querySelector(".cancelpreview-error"), null);
  assert.equal(document.querySelector(".cancelpreview-dropdown-list"), null);
  assert.equal(
    document.querySelector(".cancelpreview-dropdown-trigger span").textContent,
    "Não repor no estoque"
  );
  await h.submit();
  assert.notEqual(h.posts()[1].body.operationKey, oldKey);
});
test("remount discards local refund keys and reloads cancellation", async t => {
  const h = await harness(t, { props: { existingCancellationId: 51 } });
  await h.refund(0);
  const key = h.refunds()[0].body.operationKey;
  await h.unmount();
  await h.mount();
  await h.refund(0);
  assert.notEqual(h.refunds()[1].body.operationKey, key);
  assert.equal(h.calls.filter(call => call.url.endsWith("/reconciliar")).length, 2);
});

const mutations = [
  {
    name: "operationKey changed on retry",
    from: "operationKey: operationKey.current,",
    to: "operationKey: novaOperationKey(),",
    contract: retryContract
  },
  {
    name: "wrong fingerprint",
    from: "previewFingerprint: preview.previewFingerprint",
    to: 'previewFingerprint: "wrong"',
    contract: payloadContract
  },
  {
    name: "wrong refund cents",
    from: "valorCentavos: leg.valorCentavos,",
    to: "valorCentavos: leg.valorCentavos + 1,",
    contract: refundPayloadContract
  },
  {
    name: "quantity added to cancellation payload",
    from: "motivo,\n          estoqueAcao: acao,",
    to: "motivo,\n          quantidade: preview.item.quantidade,\n          estoqueAcao: acao,",
    contract: payloadContract
  },
  {
    name: "confirmation block removed",
    from: "disabled={!preview.cancelamentoExecutavel || saving}",
    to: "disabled={saving}",
    contract: blockedContract
  },
  {
    name: "GET before reconciliation",
    from: "(existingCancellationId ? reconciliarPedido(orderId) : Promise.resolve())\n      .then(() => fetch(path))",
    to: "fetch(path)\n      .then(async r => { if (existingCancellationId) await reconciliarPedido(orderId); return r; })",
    contract: orderContract
  },
  {
    name: "refund key shared across allocations",
    from: "refundKeys.current.get(leg.pagamentoAlocacaoId)",
    to: "refundKeys.current.values().next().value",
    contract: refundKeysContract
  }
];
for (const mutation of mutations) {
  test(`negative control detects ${mutation.name}`, async t => {
    const mutated = await compile(mutation);
    await assert.rejects(() => mutation.contract(t, mutated), { code: "ERR_ASSERTION" });
  });
}
