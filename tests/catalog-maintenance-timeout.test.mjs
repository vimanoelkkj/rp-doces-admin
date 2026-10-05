import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const path = "src/api/products.ts";
let source = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
const mutations = {
  timeout: [
    "timeout = setTimeout(() => {\n          controller.abort();\n          resolve();\n        }, RESERVATION_MAINTENANCE_TIMEOUT_MS);",
    "timeout = undefined;"
  ],
  ordering: [
    "await liberarReservasVencidas();",
    'const premature = fetch("/api/produtos"); await liberarReservasVencidas();'
  ],
  sharedSignal: [
    'const response = await fetch("/api/produtos");',
    'const response = await fetch("/api/produtos", { signal: sharedController.signal });'
  ],
  swallowedGet: [
    `throw new Error(\`Falha ao carregar produtos (\${response.status})\`);`,
    "return [];"
  ],
  duplicateGet: [
    'const response = await fetch("/api/produtos");',
    'await fetch("/api/produtos"); const response = await fetch("/api/produtos");'
  ]
};
if (process.env.CATALOG_MUTATION) {
  const [before, after] = mutations[process.env.CATALOG_MUTATION];
  assert.ok(source.includes(before), "Mutation anchor must exist");
  source = source.replace(before, after);
  if (process.env.CATALOG_MUTATION === "sharedSignal") {
    const controllerAnchor = "const controller = new AbortController();";
    assert.ok(source.includes(controllerAnchor), "Mutation anchor must exist");
    source = `const sharedController = new AbortController();\n${source.replace(controllerAnchor, "const controller = sharedController;")}`;
  }
}

const dom = new JSDOM('<div id="root"></div>', { url: "https://local.test" });
for (const name of ["window", "document", "navigator", "HTMLElement"])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useCatalogProducts} from './src/hooks/useCatalogProducts';
      export {fetchProducts} from './src/api/products';
      export {act} from 'react';
      export let current;
      function Probe(){current=useCatalogProducts();return null;}
      export function mount(container){const root=createRoot(container);root.render(<Probe/>);return root;}
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
      name: "products-source",
      setup(b) {
        b.onLoad({ filter: /[/\\]src[/\\]api[/\\]products\.ts$/ }, () => ({
          contents: source,
          loader: "ts",
          resolveDir: `${process.cwd()}/src/api`
        }));
      }
    }
  ]
});
const app = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=rp-catalog-maintenance-bundle.mjs`).toString("base64")}`
);
test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

const apiRow = {
  id: 1,
  nome: "Bolo",
  categoria: "bolo",
  categoria_nome: "Bolos",
  descricao: "",
  preco_centavos: 2500,
  preco_promocional_centavos: null,
  promocao_ativa: 0,
  promocao_inicio: null,
  promocao_fim: null,
  destaque: 0,
  ordem: 0,
  estoque: 3,
  estoque_reservado: 1,
  image_key: null
};
const catalog = { produtos: [apiRow] };

function harness(t) {
  const requests = [],
    timers = new Map();
  let now = 0,
    nextTimer = 0,
    root;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (fn, delay) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  t.mock.method(
    globalThis,
    "fetch",
    (url, options = {}) =>
      new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
      })
  );
  const flush = () =>
    app.act(async () => {
      await new Promise(setImmediate);
    });
  const reply = async (request, body = catalog, status = 200) => {
    assert.ok(request, "Expected captured request");
    await app.act(async () => request.resolve(Response.json(body, { status })));
    await flush();
  };
  const fail = async request => {
    await app.act(async () => request.reject(new Error("network")));
    await flush();
  };
  const tick = async ms => {
    now += ms;
    await app.act(async () => {
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
    });
    await flush();
  };
  const start = () => {
    const result = { settled: false };
    result.promise = app.fetchProducts().then(
      value => {
        result.settled = true;
        result.value = value;
      },
      error => {
        result.settled = true;
        result.error = error;
      }
    );
    return result;
  };
  const mount = async () => {
    await app.act(async () => {
      root = app.mount(document.getElementById("root"));
    });
    await flush();
  };
  t.after(async () => {
    if (root) await app.act(async () => root.unmount());
  });
  return { requests, timers, start, reply, fail, tick, flush, mount };
}

test("maintenance: success waits for POST, preserves mapping and clears timeout", async t => {
  const h = harness(t),
    result = h.start();
  assert.deepEqual(
    h.requests.map(r => r.url),
    ["/api/reservas/reconciliar"]
  );
  assert.equal(h.requests[0].options.method, "POST");
  await h.reply(h.requests[0], { ok: true });
  assert.deepEqual(
    h.requests.map(r => r.url),
    ["/api/reservas/reconciliar", "/api/produtos"]
  );
  assert.equal(h.timers.size, 0);
  await h.reply(h.requests[1]);
  assert.equal(h.requests.length, 2, "one maintenance produces exactly one GET");
  await result.promise;
  assert.equal(result.error, undefined);
  assert.equal(result.value[0].disponibilidade, 2);
  assert.equal(result.value[0].price, 25);
  await h.tick(60_000);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].options.signal.aborted, false);
});

test("maintenance: rejection still reads products and clears timeout", async t => {
  const h = harness(t),
    result = h.start();
  await h.fail(h.requests[0]);
  assert.equal(h.requests[1]?.url, "/api/produtos");
  assert.equal(h.timers.size, 0);
  await h.reply(h.requests[1]);
  await result.promise;
  assert.equal(result.value.length, 1);
});

test("maintenance: hung POST times out at 2000ms without aborting or duplicating GET", async t => {
  const h = harness(t),
    result = h.start();
  const post = h.requests[0];
  await h.tick(1999);
  assert.equal(h.requests.length, 1);
  assert.equal(post.options.signal.aborted, false);
  await h.tick(1);
  assert.equal(h.requests.length, 2);
  const get = h.requests[1];
  assert.equal(get.url, "/api/produtos");
  assert.equal(post.options.signal.aborted, true);
  assert.ok(get.options.signal === undefined, "GET must not receive the maintenance signal");
  await h.tick(60_000);
  assert.equal(result.settled, false, "maintenance deadline must not cancel a slow GET");
  await h.reply(get);
  await result.promise;
  assert.equal(result.value.length, 1);
  await h.reply(post, { ok: true });
  assert.equal(h.requests.length, 2, "late maintenance never repeats the GET");
  assert.equal(h.timers.size, 0);
});

test("GET: HTTP, network and JSON errors continue propagating", async t => {
  for (const failure of ["http", "network", "json"])
    await t.test(failure, async t => {
      const h = harness(t),
        result = h.start();
      await h.reply(h.requests[0], { ok: true });
      const get = h.requests[1];
      assert.ok(get, "Expected GET");
      if (failure === "http") await h.reply(get, {}, 503);
      else if (failure === "network") await h.fail(get);
      else {
        await app.act(async () =>
          get.resolve({
            ok: true,
            json: async () => {
              throw new Error("invalid JSON");
            }
          })
        );
        await h.flush();
      }
      await result.promise;
      assert.ok(result.error instanceof Error);
      assert.equal(
        result.error.message,
        failure === "http"
          ? "Falha ao carregar produtos (503)"
          : failure === "network"
            ? "network"
            : "invalid JSON"
      );
      assert.equal(result.value, undefined);
    });
});

test("hook: in-flight deduplication survives maintenance timeout and pending GET", async t => {
  const h = harness(t);
  await h.mount();
  assert.equal(app.current.loading, true);
  window.dispatchEvent(new dom.window.Event("focus"));
  await h.tick(2000);
  assert.equal(h.requests.length, 2);
  window.dispatchEvent(new dom.window.Event("focus"));
  document.dispatchEvent(new dom.window.Event("visibilitychange"));
  await h.flush();
  assert.equal(h.requests.length, 2);
  await h.reply(h.requests[1]);
  assert.equal(app.current.loading, false);
  assert.equal(app.current.error, null);
  assert.equal(app.current.products.length, 1);
  window.dispatchEvent(new dom.window.Event("focus"));
  await h.flush();
  assert.equal(h.requests.length, 3, "revalidation resumes once GET settles");
  await h.reply(h.requests[2], { ok: true });
  await h.reply(h.requests[3]);
  window.dispatchEvent(new dom.window.Event("focus"));
  await h.flush();
  assert.equal(h.requests.length, 4, "existing 2s revalidation interval is preserved");
});

test("hook: GET failure releases in-flight and preserves error feedback", async t => {
  const h = harness(t);
  await h.mount();
  await h.tick(2000);
  await h.reply(h.requests[1], {}, 500);
  assert.equal(app.current.loading, false);
  assert.equal(app.current.error, "Falha ao carregar produtos (500)");
  window.dispatchEvent(new dom.window.Event("focus"));
  await h.flush();
  assert.equal(h.requests.length, 3);
  await h.reply(h.requests[2]);
  await h.reply(h.requests[3]);
  assert.equal(app.current.error, null);
  assert.equal(app.current.products.length, 1);
});

if (!process.env.CATALOG_MUTATION)
  test("negative controls: mutants must fail behavioral assertions", async t => {
    const run = promisify(execFile),
      env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    for (const [mutation, pattern] of Object.entries({
      timeout: "^maintenance: hung",
      ordering: "^maintenance: success",
      sharedSignal: "^maintenance: hung",
      swallowedGet: "^GET:",
      duplicateGet: "^maintenance: success"
    }))
      await t.test(mutation, async () => {
        let failure;
        try {
          await run(
            process.execPath,
            [
              "--test",
              `--test-name-pattern=${pattern}`,
              "tests/catalog-maintenance-timeout.test.mjs"
            ],
            { env: { ...env, CATALOG_MUTATION: mutation }, timeout: 30000, maxBuffer: 2_000_000 }
          );
        } catch (error) {
          failure = error;
        }
        assert.ok(failure, `${mutation} survived`);
        assert.equal(failure.code, 1);
        assert.match(failure.stdout, /ERR_ASSERTION/);
        assert.doesNotMatch(failure.stdout, /Mutation anchor must exist/);
      });
  });
