import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspect } from "node:util";
import { build } from "esbuild";
import { app, fixture } from "./helpers/b3.mjs";

const paths = {
  helper: "functions/lib/pushError.ts",
  notifier: "functions/lib/pushNotifier.ts",
  endpoint: "functions/api/admin/push/test.ts"
};
const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")])
  )
);
const bridge = Symbol.for("rp-doces.push-error-test");
const endpoint = "https://push.example.invalid/private-device?token=SECRET_TOKEN";
const secret = `${endpoint} Authorization: Bearer SECRET_AUTH privateKey=SECRET_KEY`;
const unknown = { category: "UNKNOWN", code: "UNKNOWN_ERROR" };
const cases = [
  ["safe error", new Error("Unexpected failure"), unknown],
  ["URL", new Error("https://internal.example.invalid/path"), unknown],
  ["endpoint and credentials", new Error(secret), unknown],
  ["query string", new Error("request?token=SECRET_TOKEN"), unknown],
  [
    "HTTP 500",
    Object.assign(new Error(secret), { statusCode: 500 }),
    { category: "HTTP_TRANSIENT", code: "HTTP_500", status: 500 }
  ],
  [
    "HTTP 404",
    Object.assign(new Error(secret), { statusCode: 404 }),
    { category: "SUBSCRIPTION_EXPIRED", code: "HTTP_404", status: 404 }
  ],
  [
    "HTTP 410",
    Object.assign(new Error(secret), { statusCode: 410 }),
    { category: "SUBSCRIPTION_EXPIRED", code: "HTTP_410", status: 410 }
  ],
  [
    "HTTP 429",
    { status: 429, message: secret, endpoint, headers: { Authorization: secret } },
    { category: "RATE_LIMIT", code: "HTTP_429", status: 429 }
  ],
  ["HTTP 401", { statusCode: 401 }, { category: "HTTP_ERROR", code: "HTTP_401", status: 401 }],
  [
    "network code",
    Object.assign(new Error(secret), { code: "ECONNRESET" }),
    { category: "NETWORK", code: "ECONNRESET" }
  ],
  [
    "network message",
    new Error(`connect ECONNREFUSED 10.0.4.15 ${secret}`),
    { category: "NETWORK", code: "ECONNREFUSED" }
  ],
  [
    "fetch failure",
    new TypeError(`fetch failed ${secret}`),
    { category: "NETWORK", code: "NETWORK_ERROR" }
  ],
  [
    "timeout",
    Object.assign(new Error(secret), { name: "TimeoutError" }),
    { category: "NETWORK", code: "TIMEOUT" }
  ],
  [
    "VAPID",
    new Error(`VAPID subject must be a URI: ${secret}`),
    { category: "CONFIGURATION", code: "VAPID_INVALID" }
  ],
  [
    "subscription key",
    new Error(`Invalid subscription auth secret: ${secret}`),
    { category: "CONFIGURATION", code: "SUBSCRIPTION_INVALID" }
  ],
  ["no message", { endpoint, code: secret }, unknown],
  ["non-Error string", secret, unknown],
  ["null", null, unknown],
  ["undefined", undefined, unknown],
  ["long message", new Error(secret.repeat(10000)), unknown],
  ["invalid status", { statusCode: "410", message: secret }, unknown]
];

async function compile(overrides = {}) {
  const bundle = await build({
    stdin: {
      contents: `export * as helper from './${paths.helper}';
        export * as notifier from './${paths.notifier}';
        export * as endpoint from './${paths.endpoint}';
        export * as retry from './functions/api/admin/push/retry';
        export * as subscribe from './functions/api/admin/push/subscribe';
        export * as unsubscribe from './functions/api/admin/push/unsubscribe';`,
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "controlled-push-boundary",
        setup(builder) {
          builder.onResolve({ filter: /^@mmmike\/web-push\/send$/ }, () => ({
            path: "send",
            namespace: "push"
          }));
          builder.onLoad({ filter: /.*/, namespace: "push" }, () => ({
            contents:
              'export const sendPushNotification = (...args) => globalThis[Symbol.for("rp-doces.push-error-test")](...args);'
          }));
          for (const [key, contents] of Object.entries(overrides)) {
            const suffix = paths[key].replaceAll("/", "\\").split("\\").at(-1);
            builder.onLoad({ filter: new RegExp(`${suffix.replaceAll(".", "\\.")}$`) }, () => ({
              contents,
              loader: "ts"
            }));
          }
        }
      }
    ]
  });
  const code = `${bundle.outputFiles[0].text}\n//# sourceURL=push-error-test.mjs`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function pureContract(module) {
  for (const [name, error, expected] of cases) {
    assert.deepEqual(module.helper.sanitizePushError(error), expected, name);
    assert.ok(JSON.stringify(module.helper.sanitizePushError(error)).length < 100, name);
  }
}

function safeLogs(logs) {
  // inspect includes Error.message, stack and enumerable fields; JSON.stringify(Error) does not.
  assert.doesNotMatch(
    inspect(logs, { depth: null }),
    /https?:\/\/|SECRET_|private-device|10\.0\.4\.15|Authorization|privateKey/
  );
}

async function notificationContract(module, db, logs) {
  logs.length = 0;
  await db.prepare("DELETE FROM push_eventos").run();
  const error = Object.assign(new Error(secret), { statusCode: 500, endpoint, body: secret });
  globalThis[bridge] = async () => {
    throw error;
  };
  const result = await module.notifier.notificarNovoPedidoPago(
    db,
    { DB: db, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" },
    1
  );
  const row = await db
    .prepare("SELECT status,tentativas,ultimo_erro FROM push_eventos WHERE pedido_id=1")
    .first();
  assert.deepEqual(result, {
    ok: false,
    motivo: "FALHA_PUSH_SERVICE",
    ultimoErro: '{"category":"HTTP_TRANSIENT","code":"HTTP_500","status":500}'
  });
  assert.deepEqual(row, {
    status: "FALHA",
    tentativas: 1,
    ultimo_erro: '{"category":"HTTP_TRANSIENT","code":"HTTP_500","status":500}'
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], 1);
  assert.deepEqual(logs[0][2], { category: "HTTP_TRANSIENT", code: "HTTP_500", status: 500 });
  safeLogs(logs);
}

test("Push errors expose only controlled diagnostic labels", async t => {
  const module = await compile();
  for (const [name, error, expected] of cases) {
    await t.test(name, () => assert.deepEqual(module.helper.sanitizePushError(error), expected));
  }
  pureContract(module);
});

test("Push logs and persistence are sanitized without changing HTTP or coordination", async t => {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const session = await app.auth.createSession(db, 1);
  await db
    .prepare(
      "INSERT INTO push_inscricoes(id,usuario_id,endpoint,p256dh,auth) VALUES(1,1,?,'public-key','auth-secret')"
    )
    .bind(endpoint)
    .run();
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  t.after(() => delete globalThis[bridge]);
  const module = await compile();
  const env = { DB: db, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" };
  const request = (body = { endpoint }) =>
    new Request("https://local.test/api/admin/push/test", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: session.cookie.split(";")[0],
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  await t.test("notifier persists and logs only safe HTTP context", () =>
    notificationContract(module, db, logs)
  );
  for (const [name, error, expected] of cases) {
    await t.test(`notifier and test endpoint: ${name}`, async () => {
      logs.length = 0;
      await db.prepare("DELETE FROM push_eventos").run();
      globalThis[bridge] = async () => {
        throw error;
      };
      const result = await module.notifier.notificarNovoPedidoPago(db, env, 1);
      const row = await db
        .prepare("SELECT status,tentativas,ultimo_erro FROM push_eventos WHERE pedido_id=1")
        .first();
      assert.equal(row.status, "FALHA");
      assert.equal(row.tentativas, 1);
      assert.deepEqual(JSON.parse(row.ultimo_erro), expected);
      assert.equal(result.ultimoErro, row.ultimo_erro);
      const response = await module.endpoint.onRequestPost({ env, request: request() });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "Falha ao despachar notificação de teste" });
      assert.equal(logs.length, 2);
      assert.deepEqual(logs[0][2], expected);
      assert.deepEqual(logs[1][2], expected);
      safeLogs(logs);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").first()).n, 1);
    });
  }
  await t.test("all persistence error catches log safe context", async () => {
    const error = new Error(secret);
    const hook = prefix => {
      db.hook = statements => {
        if (statements.some(row => row.sql.trim().startsWith(prefix))) throw error;
      };
    };
    const check = () => {
      db.hook = null;
      assert.equal(logs.length, 1);
      assert.deepEqual(logs[0].at(-1), unknown);
      safeLogs(logs);
      logs.length = 0;
    };
    logs.length = 0;
    hook("SELECT id, valor_total_centavos FROM pedidos");
    await module.notifier.notificarNovoPedidoPagoSafe(db, env, 1);
    check();
    hook("SELECT pedido_id, tentativas");
    await module.notifier.reconciliarPushEventosFalhosSafe(db, env);
    check();
    hook("SELECT pedido_id, tentativas");
    const retry = await module.retry.onRequestPost({ env, request: request() });
    assert.equal(retry.status, 500);
    assert.deepEqual(await retry.json(), { error: "Erro interno ao reconciliar eventos de push" });
    check();
    await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
    hook("UPDATE push_eventos");
    // Let the CAS succeed, then fail the final update after network delivery.
    let updates = 0;
    db.hook = statements => {
      if (
        statements.some(row => row.sql.trim().startsWith("UPDATE push_eventos")) &&
        ++updates === 2
      )
        throw error;
    };
    globalThis[bridge] = async () => true;
    assert.deepEqual(await module.notifier.reconciliarPushEventosFalhos(db, env), {
      ok: true,
      processados: 1,
      sucessos: 0,
      falhas: 1
    });
    check();
    hook("INSERT INTO push_inscricoes");
    const subscribe = await module.subscribe.onRequestPost({
      env,
      request: request({ endpoint, keys: { p256dh: "public-key-long", auth: "auth-secret" } })
    });
    assert.equal(subscribe.status, 500);
    assert.deepEqual(await subscribe.json(), {
      error: "Erro interno ao registrar inscrição de notificação"
    });
    check();
    hook("DELETE FROM push_inscricoes");
    const unsubscribe = await module.unsubscribe.onRequestPost({ env, request: request() });
    assert.equal(unsubscribe.status, 500);
    assert.deepEqual(await unsubscribe.json(), {
      error: "Erro interno ao remover inscrição de notificação"
    });
    check();
  });

  const replace = (key, from, to) => {
    assert.equal(sources[key].split(from).length, 2, "unique mutation anchor required");
    return { [key]: sources[key].replace(from, to) };
  };
  const mutants = [
    ["raw exception log", replace("notifier", "sub.id, safeError)", "sub.id, err)"), false],
    [
      "raw message persistence",
      replace("notifier", "JSON.stringify(safeError)", "(err as Error).message"),
      false
    ],
    [
      "URL passthrough",
      replace("helper", 'code: "UNKNOWN_ERROR"', 'code: "UNKNOWN_ERROR", message'),
      "URL"
    ],
    [
      "lose HTTP 410",
      replace("helper", ", status };", ", status: status === 410 ? undefined : status };"),
      "HTTP 410"
    ],
    [
      "lose category",
      replace("helper", "return { category, code:", 'return { category: "UNKNOWN", code:'),
      "HTTP 500"
    ],
    ["raw endpoint log", replace("endpoint", "sanitizePushError(err)", "err"), false]
  ];
  for (const [name, changes, pure] of mutants) {
    await t.test(`negative control: ${name}`, async () => {
      const mutant = await compile(changes); // Missing anchors/compile failures cannot count as detection.
      await assert.rejects(
        async () => {
          if (pure) {
            const [, error, expected] = cases.find(([name]) => name === pure);
            assert.deepEqual(mutant.helper.sanitizePushError(error), expected);
          } else {
            await notificationContract(mutant, db, logs);
            logs.length = 0;
            await mutant.endpoint.onRequestPost({ env, request: request() });
            safeLogs(logs);
          }
        },
        error => error.code === "ERR_ASSERTION"
      );
    });
  }
});
