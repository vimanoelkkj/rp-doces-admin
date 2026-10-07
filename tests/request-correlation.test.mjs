import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { app, fixture, barrier } from "./helpers/b3.mjs";

const paths = {
  context: "functions/lib/requestContext.ts",
  admin: "functions/api/admin/_middleware.ts"
};
async function compile(mutation) {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      export * as context from './functions/lib/requestContext';
      export * as root from './functions/_middleware';
      export * as admin from './functions/api/admin/_middleware';
      export * as auth from './functions/lib/auth';
      export * as checkout from './functions/api/checkout';
      export * as payment from './functions/api/admin/pedidos/[id]/pagamentos';
      export * as push from './functions/lib/pushNotifier';
    `
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: mutation
      ? [
          {
            name: "negative-control",
            setup(api) {
              api.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
                if (!path.replaceAll("\\", "/").endsWith(paths[mutation.path ?? "context"]))
                  return null;
                let source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
                for (const [from, to] of mutation.replacements) {
                  assert.equal(source.split(from).length - 1, 1, "Unique mutation anchor");
                  source = source.replace(from, to);
                }
                return { contents: source, loader: "ts" };
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
const production = await compile();
const request = (headers = {}, path = "/api/admin/probe") =>
  new Request(`https://local.test${path}`, { headers });
const validId = /^(req-[a-f0-9]{24}|cf-[a-f0-9]{16}-[a-z]{3})$/;
async function through(module, req, action, admin = true) {
  const data = {};
  const response = await module.root.onRequest({
    request: req,
    data,
    next: () => (admin ? module.admin.onRequest({ next: action }) : action())
  });
  assert.equal(data.requestId, response.headers.get("X-Request-Id"));
  return response;
}
const contracts = {};
contracts.response = async module => {
  const response = await through(
    module,
    request(),
    async () =>
      new Response("original body", {
        status: 202,
        statusText: "Accepted",
        headers: {
          "Set-Cookie": "session=SECRET; HttpOnly",
          "X-Functional": "original",
          "Content-Type": "text/plain",
          "Cache-Control": "public"
        }
      })
  );
  assert.equal(response.status, 202);
  assert.equal(response.statusText, "Accepted");
  assert.equal(await response.text(), "original body");
  assert.equal(response.headers.get("Set-Cookie"), "session=SECRET; HttpOnly");
  assert.equal(response.headers.get("X-Functional"), "original");
  assert.equal(response.headers.get("Content-Type"), "text/plain");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("X-Request-Id"), validId);
};
contracts.external = async module => {
  for (const value of [
    "user@example.test SECRET",
    "a".repeat(500),
    "550e8400-e29b-41d4-a716-446655440000"
  ]) {
    const req = request({ "X-Request-Id": value, "CF-Ray": "abcd1234abcd1234-GRU" });
    const response = await through(module, req, async () => new Response(null));
    assert.match(response.headers.get("X-Request-Id"), /^req-[a-f0-9]{24}$/);
    assert.equal(
      req.headers.get("X-Request-Id"),
      value,
      "Webhook signature header stays untouched"
    );
  }
};
contracts.secret = async (module, logs) => {
  const response = await through(
    module,
    request(
      {
        Authorization: "Bearer SECRET_TOKEN",
        Cookie: "session=SECRET_COOKIE",
        "X-Request-Id": "person@example.test"
      },
      "/api/probe?token=SECRET_QUERY"
    ),
    async () => {
      module.context.requestLogger.error(
        "SAFE_EVENT",
        new Error("push https://secret.invalid SECRET_BODY password=SECRET_PASSWORD")
      );
      return new Response("unchanged");
    }
  );
  assert.match(response.headers.get("X-Request-Id"), validId);
  const serialized = JSON.stringify(logs);
  for (const secret of [
    "SECRET_TOKEN",
    "SECRET_COOKIE",
    "SECRET_QUERY",
    "SECRET_BODY",
    "SECRET_PASSWORD",
    "person@example.test",
    "secret.invalid"
  ])
    assert.ok(!serialized.includes(secret));
  assert.equal(logs.at(-2)[1].requestId, response.headers.get("X-Request-Id"));
};
contracts.concurrent = async (module, logs) => {
  const rendezvous = barrier(2);
  const responses = await Promise.all(
    [1, 2].map(index =>
      through(module, request({}, `/api/probe${index}`), async () => {
        const before = module.context.getRequestContext().requestId;
        await rendezvous();
        await new Promise(setImmediate);
        const after = module.context.getRequestContext().requestId;
        assert.equal(after, before);
        module.context.requestLogger.warn(`CONCURRENT_${index}`, new Error("private"));
        return Response.json({ before, after });
      })
    )
  );
  const ids = responses.map(response => response.headers.get("X-Request-Id"));
  assert.notEqual(ids[0], ids[1]);
  for (let index = 0; index < 2; index++)
    assert.equal(logs.find(row => row[0] === `CONCURRENT_${index + 1}`)[1].requestId, ids[index]);
};

test("request correlation contract and negative controls", async t => {
  const logs = [];
  for (const level of ["info", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push(args));
  for (const [name, contract] of Object.entries(contracts))
    await t.test(name, async () => {
      logs.length = 0;
      await contract(production, logs);
    });
  await t.test("Cloudflare Ray reused only with runtime metadata", async () => {
    for (const [ray, expected] of [
      ["abcd1234abcd1234-GRU", "cf-abcd1234abcd1234-gru"],
      ["SECRET/invalid", null]
    ]) {
      const req = request({ "CF-Ray": ray });
      Object.defineProperty(req, "cf", { value: { colo: "GRU" } });
      const response = await through(production, req, async () => new Response(null));
      if (expected) assert.equal(response.headers.get("X-Request-Id"), expected);
      else assert.match(response.headers.get("X-Request-Id"), /^req-/);
    }
  });
  await t.test("nested async helpers and detached work retain same context", async () => {
    let background;
    const response = await through(production, request(), async () => {
      const id = production.context.getRequestContext().requestId;
      assert.equal(
        await production.context.withRequestContext(
          request(),
          async () => production.context.getRequestContext().requestId
        ),
        id
      );
      background = new Promise(resolve =>
        setImmediate(() => resolve(production.context.getRequestContext().requestId))
      );
      return new Response(null);
    });
    assert.equal(await background, response.headers.get("X-Request-Id"));
    assert.equal(production.context.getRequestContext(), undefined);
  });
  await t.test("public cache policy and empty response preserved", async () => {
    const response = await through(
      production,
      request({}, "/images/probe"),
      async () =>
        new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=60" } }),
      false
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  });
  await t.test("unexpected error stays unchanged and logs sanitized context", async () => {
    logs.length = 0;
    const error = new Error("SECRET_COOKIE");
    await assert.rejects(
      through(production, request(), async () => {
        throw error;
      }),
      value => value === error
    );
    assert.equal(logs[0][0], "UNEXPECTED_REQUEST_ERROR");
    assert.match(logs[0][1].requestId, validId);
    assert.ok(!JSON.stringify(logs).includes("SECRET_COOKIE"));
  });
  await t.test("real auth, checkout, payment and deep push logs carry ID", async () => {
    const db = await fixture(t);
    const session = await app.auth.createSession(db, 1);
    const cases = [
      [
        "AUTHENTICATION_REQUIRED",
        async req => {
          const result = await production.auth.requireUser(db, req);
          return result.error;
        }
      ],
      [
        "Erro inesperado no checkout",
        async req => {
          db.hook = () => {
            throw new Error("SECRET_TOKEN");
          };
          return production.checkout.onRequestPost({
            request: req,
            env: { DB: db, MP_ACCESS_TOKEN: "SECRET_TOKEN" }
          });
        }
      ],
      [
        "Erro ao registrar pagamento manual (admin)",
        async req => {
          db.hook = statements => {
            if (statements.some(s => s.sql.includes("pedido_operacoes")))
              throw new Error("SECRET_TOKEN");
          };
          return production.payment.onRequestPost({
            request: req,
            env: { DB: db },
            params: { id: "1" }
          });
        }
      ],
      [
        "Erro não-bloqueante ao despachar Web Push para pedido",
        async () => {
          db.hook = () => {
            throw new Error("SECRET_TOKEN");
          };
          await production.push.notificarNovoPedidoPagoSafe(db, { DB: db }, 1);
          return new Response(null);
        }
      ]
    ];
    for (const [label, action] of cases) {
      db.hook = null;
      logs.length = 0;
      const req = new Request("https://local.test/api/admin/probe", {
        method: "POST",
        headers: {
          Origin: "https://local.test",
          "Content-Type": "application/json",
          ...(label === "AUTHENTICATION_REQUIRED" ? {} : { Cookie: session.cookie.split(";")[0] })
        },
        body: JSON.stringify({
          items: [{ id: 1, quantity: 1 }],
          cliente: { nome: "private", whatsapp: "11999999999" },
          metodo: "DINHEIRO",
          valorCentavos: 100,
          operationKey: "11111111-1111-4111-8111-111111111111"
        })
      });
      const response = await through(production, req, () => action(req));
      const entry = logs.find(row => row[0] === label);
      assert.ok(entry, `Actual production log: ${label}`);
      assert.equal(entry[1].requestId, response.headers.get("X-Request-Id"));
      assert.ok(!JSON.stringify(logs).includes("SECRET_TOKEN"));
    }
    db.hook = null;
  });
  const controls = [
    {
      name: "shared global context",
      contract: "concurrent",
      replacements: [
        ["return requestStorage.getStore();", "return shared;"],
        [
          "const requestStorage = new AsyncLocalStorage<Readonly<RequestContext>>();",
          "let shared: Readonly<RequestContext> | undefined; const requestStorage = new AsyncLocalStorage<Readonly<RequestContext>>();"
        ],
        [
          "return requestStorage.run(",
          "return ((store, callback) => { shared = store; return callback(); })("
        ]
      ]
    },
    {
      name: "arbitrary external header trusted",
      contract: "external",
      replacements: [
        [
          'const ray = request.headers.get("cf-ray");',
          'const ray = request.headers.get("x-request-id");'
        ],
        ["request.cf?.colo && ray && /^[a-f0-9]{16}-[A-Z]{3}$/.test(ray)", "ray"]
      ]
    },
    {
      name: "secret used as ID",
      contract: "secret",
      replacements: [
        [
          "Object.freeze({ requestId, source:",
          'Object.freeze({ requestId: request.headers.get("authorization") ?? requestId, source:'
        ]
      ]
    },
    {
      name: "admin cache control lost",
      contract: "response",
      path: "admin",
      replacements: [
        ['headers.set("Cache-Control", "no-store")', 'headers.set("Cache-Control", "public")']
      ]
    }
  ];
  for (const mutation of controls)
    await t.test(`negative control: ${mutation.name}`, async () => {
      logs.length = 0;
      const mutated = await compile(mutation);
      await assert.rejects(contracts[mutation.contract](mutated, logs), { code: "ERR_ASSERTION" });
    });
});

test("Workers nodejs_als runtime supports root middleware", async t => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `import {onRequest} from './functions/_middleware'; import {getRequestContext} from './functions/lib/requestContext'; export default {fetch(request,env){return onRequest({request,env,data:{},next:async()=>Response.json({requestId:getRequestContext().requestId})});}}`
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    external: ["node:async_hooks"]
  });
  const worker = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2024-09-23",
    compatibilityFlags: ["nodejs_als"],
    cf: false
  });
  t.after(() => worker.dispose());
  const response = await worker.dispatchFetch("https://local.test/api/probe");
  assert.equal((await response.json()).requestId, response.headers.get("X-Request-Id"));
  assert.match(response.headers.get("X-Request-Id"), validId);
});

test("requestLogger errorMeta vs error security and allowlist validation", async t => {
  const logs = [];
  for (const level of ["info", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push(args));

  const req = request({}, "/api/test-meta");

  // 1. requestLogger.error continua sanitizando Error como antes (gerando SafePushError)
  await through(production, req, async () => {
    logs.length = 0;
    production.context.requestLogger.error("TEST_ERROR", new Error("secret message token=123"));
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], "TEST_ERROR");
    assert.match(logs[0][1].requestId, validId);
    assert.deepEqual(logs[0][1].error, { category: "UNKNOWN", code: "UNKNOWN_ERROR" });
    assert.ok(!JSON.stringify(logs[0]).includes("secret message"));
    return new Response(null);
  });

  // 2. errorMeta registra somente os campos allowlisted (httpStatus, mpRequestId, motivo, code)
  await through(production, req, async () => {
    logs.length = 0;
    production.context.requestLogger.errorMeta("TEST_VALID_META", {
      httpStatus: 400,
      mpRequestId: "req-mp-test-12345",
      motivo: "HTTP_INDISPONIVEL",
      code: "invalid_parameter"
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], "TEST_VALID_META");
    assert.match(logs[0][1].requestId, validId);
    assert.equal(logs[0][1].httpStatus, 400);
    assert.equal(logs[0][1].mpRequestId, "req-mp-test-12345");
    assert.equal(logs[0][1].motivo, "HTTP_INDISPONIVEL");
    assert.equal(logs[0][1].code, "invalid_parameter");
    return new Response(null);
  });

  // 3. campos extras/sensíveis NÃO escapam (tokens, cookies, auth, payload bruto, etc.)
  await through(production, req, async () => {
    logs.length = 0;
    production.context.requestLogger.errorMeta("TEST_SENSITIVE_DISCARD", {
      httpStatus: 500,
      mpRequestId: "req-mp-ok",
      motivo: "TRANSPORTE",
      authorization: "Bearer SECRET_TOKEN",
      cookie: "session=SECRET_COOKIE",
      token: "SECRET_ACCESS_TOKEN",
      body: { sensitive: "data" },
      payer: { email: "secret@example.com" },
      qrCode: "000201...",
      insecureCode: "invalid code with spaces and malicious chars"
    });
    assert.equal(logs.length, 1);
    const entry = logs[0][1];
    assert.match(entry.requestId, validId);
    assert.equal(entry.httpStatus, 500);
    assert.equal(entry.mpRequestId, "req-mp-ok");
    assert.equal(entry.motivo, "TRANSPORTE");
    assert.equal(entry.code, undefined, "código inválido/inseguro deve ser descartado");
    assert.equal(entry.authorization, undefined);
    assert.equal(entry.cookie, undefined);
    assert.equal(entry.token, undefined);
    assert.equal(entry.body, undefined);
    assert.equal(entry.payer, undefined);
    assert.equal(entry.qrCode, undefined);
    const serialized = JSON.stringify(logs[0]);
    for (const secret of [
      "SECRET_TOKEN",
      "SECRET_COOKIE",
      "SECRET_ACCESS_TOKEN",
      "secret@example.com",
      "000201"
    ]) {
      assert.ok(!serialized.includes(secret));
    }
    return new Response(null);
  });
});

test("checkout HTTP 400 recusa definitiva preserva httpStatus e mpRequestId nos logs", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const db = await fixture(t);

  t.mock.method(globalThis, "fetch", async () => {
    return new Response(JSON.stringify({ message: "invalid_parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "x-request-id": "mp-req-400-checkout" }
    });
  });

  const req = new Request("https://local.test/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://local.test",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [{ id: 1, quantity: 1 }],
      cliente: { nome: "Cliente", whatsapp: "11999999999" },
      operationKey: "op-checkout-400-log"
    })
  });

  const response = await through(production, req, () =>
    production.checkout.onRequestPost({
      request: req,
      env: { DB: db, MP_ACCESS_TOKEN: "fake-token" }
    })
  );

  assert.equal(response.status, 502);
  const checkoutErrorLog = logs.find(r => r[0] === "Mercado Pago checkout error");
  assert.ok(checkoutErrorLog, "log de erro do checkout deve ter sido emitido");
  const payload = checkoutErrorLog[1];
  assert.equal(payload.httpStatus, 400);
  assert.equal(payload.mpRequestId, "mp-req-400-checkout");
  assert.equal(payload.code, "invalid_parameter");
  assert.match(payload.requestId, validId);
  assert.notEqual(
    payload.requestId,
    payload.mpRequestId,
    "requestId da CF deve ser separado do mpRequestId"
  );
});

test("checkout AMBIGUO preserva motivo, httpStatus e mpRequestId nos logs", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const db = await fixture(t);

  t.mock.method(globalThis, "fetch", async () => {
    return new Response("Service Unavailable", {
      status: 503,
      headers: { "x-request-id": "mp-req-503-checkout" }
    });
  });

  const req = new Request("https://local.test/api/checkout", {
    method: "POST",
    headers: {
      Origin: "https://local.test",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [{ id: 1, quantity: 1 }],
      cliente: { nome: "Cliente", whatsapp: "11999999999" },
      operationKey: "op-checkout-503-log"
    })
  });

  const response = await through(production, req, () =>
    production.checkout.onRequestPost({
      request: req,
      env: { DB: db, MP_ACCESS_TOKEN: "fake-token" }
    })
  );

  assert.equal(response.status, 502);
  const ambiguoLog = logs.find(r => r[0] === "Resultado ambíguo ao criar pagamento Pix (checkout)");
  assert.ok(ambiguoLog, "log de ambíguo do checkout deve ter sido emitido");
  const payload = ambiguoLog[1];
  assert.equal(payload.httpStatus, 503);
  assert.equal(payload.motivo, "HTTP_INDISPONIVEL");
  assert.equal(payload.mpRequestId, "mp-req-503-checkout");
  assert.match(payload.requestId, validId);
});
