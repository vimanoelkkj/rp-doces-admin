import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { app, barrier, fixture } from "./helpers/b3.mjs";

// Real notifier, retry handler, transport adapter and disposable D1. Only the
// external send boundary is controlled. Interruption scenarios inject a fault
// after the durable claim; they do not emulate termination of workerd itself.
const bridge = Symbol.for("rp-doces.push-pending-characterization");
async function compile(mutation) {
  let replacements = 0;
  const bundle = await build({
    stdin: {
      contents:
        "export * from './functions/lib/pushNotifier'; export { onRequestPost } from './functions/api/admin/push/retry';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "push-boundary",
        setup(api) {
          api.onResolve({ filter: /^@mmmike\/web-push\/send$/ }, () => ({
            path: "send",
            namespace: "push-boundary"
          }));
          api.onLoad({ filter: /.*/, namespace: "push-boundary" }, () => ({
            contents:
              'export const sendPushNotification = (...args) => globalThis[Symbol.for("rp-doces.push-pending-characterization")](...args);'
          }));
          if (mutation)
            api.onLoad({ filter: /pushNotifier\.ts$/ }, async ({ path }) => {
              const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
              replacements = source.split(mutation.from).length - 1;
              assert.equal(replacements, mutation.count ?? 1, mutation.name);
              return { contents: source.replaceAll(mutation.from, mutation.to), loader: "ts" };
            });
        }
      }
    ]
  });
  if (mutation) assert.ok(replacements, "Mutation must reach production code");
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}
const production = await compile();
const none = { ok: true, processados: 0, sucessos: 0, falhas: 0 };
const success = { ok: true, processados: 1, sucessos: 1, falhas: 0 };
const failed = { ok: true, processados: 1, sucessos: 0, falhas: 1 };
const event = (status, tentativas, ultimo_erro = "old failure") => ({
  status,
  tentativas,
  ultimo_erro
});
const fault = new Error("injected persistence failure");
const contracts = {};

test("push pending: durable state and claim characterization", async t => {
  const db = await fixture(t);
  const env = { DB: db, VAPID_PUBLIC_KEY: "test-public", VAPID_PRIVATE_KEY: "test-private" };
  const session = await app.auth.createSession(db, 1);
  let calls;
  async function reset(
    status = "FALHA",
    attempts = 1,
    age = "2000-01-01 00:00:00",
    subscriptions = 1
  ) {
    db.hook = null;
    calls = [];
    await db.prepare("DELETE FROM push_eventos").run();
    await db.prepare("DELETE FROM push_inscricoes").run();
    if (status)
      await db
        .prepare(
          "INSERT INTO push_eventos(pedido_id,evento,status,tentativas,ultimo_erro,criado_em,atualizado_em) VALUES(1,'PEDIDO_PAGO',?,?,?,'2000-01-01 00:00:00',?)"
        )
        .bind(status, attempts, "old failure", age)
        .run();
    for (let id = 1; id <= subscriptions; id++)
      await db
        .prepare(
          "INSERT INTO push_inscricoes(id,usuario_id,endpoint,p256dh,auth) VALUES(?,1,?,'key','auth')"
        )
        .bind(id, `https://push.example.invalid/${id}`)
        .run();
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      return true;
    };
  }
  t.after(() => {
    db.hook = null;
    delete globalThis[bridge];
  });
  const state = () =>
    db
      .prepare(
        "SELECT status,tentativas,ultimo_erro FROM push_eventos WHERE pedido_id=1 AND evento='PEDIDO_PAGO'"
      )
      .first();
  const retry = module => module.reconciliarPushEventosFalhos(db, env);
  async function ignored(module, status, attempts, age) {
    await reset(status, attempts, age);
    assert.deepEqual(await retry(module), none);
    assert.deepEqual(await state(), event(status, attempts));
    assert.equal(calls.length, 0);
  }
  contracts.normal = async module => {
    await reset();
    assert.deepEqual(await retry(module), success);
    assert.deepEqual(await state(), event("ENVIADO", 2));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].tag, "pedido-1");
  };
  contracts.pending = module => ignored(module, "PENDENTE", 1, "2000-01-01 00:00:00");
  contracts.backoff = async module => {
    const now = await db.prepare("SELECT CURRENT_TIMESTAMP AS value").first("value");
    await ignored(module, "FALHA", 1, now);
  };
  contracts.limit = module => ignored(module, "FALHA", 3, "2000-01-01 00:00:00");
  contracts.claim = async module => {
    await reset();
    const rendezvous = barrier(2);
    db.hook = async statements => {
      if (statements.some(row => row.sql.includes("SET status = 'PENDENTE'"))) await rendezvous();
    };
    const results = await Promise.all([retry(module), retry(module)]);
    db.hook = null;
    assert.equal(
      results.reduce((sum, result) => sum + result.sucessos, 0),
      1
    );
    assert.equal(
      results.reduce((sum, result) => sum + result.processados, 0),
      2,
      "Both candidates counted, including lost claim"
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(await state(), event("ENVIADO", 2));
  };
  contracts.claimTimestamp = async module => {
    await reset();
    db.hook = statements => {
      if (
        statements.some(row => row.sql.startsWith("SELECT id, valor_total_centavos FROM pedidos"))
      )
        throw fault;
    };
    await assert.rejects(retry(module), error => error === fault);
    db.hook = null;
    assert.deepEqual(await state(), event("PENDENTE", 1));
    const times = await db
      .prepare("SELECT criado_em,atualizado_em FROM push_eventos WHERE pedido_id=1")
      .first();
    assert.equal(times.criado_em, "2000-01-01 00:00:00");
    assert.notEqual(times.atualizado_em, times.criado_em);
    assert.match(times.atualizado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.deepEqual(
      await retry(module),
      none,
      "A durable claim abandoned before dispatch is not recovered"
    );
    assert.equal(calls.length, 0);
  };
  for (const [name, contract] of Object.entries(contracts))
    await t.test(name, () => contract(production));
  await t.test("initial send registers PENDENTE and finishes ENVIADO", async () => {
    await reset(null, 0);
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      assert.deepEqual(await state(), event("PENDENTE", 0, null));
      return true;
    };
    assert.deepEqual(await production.notificarNovoPedidoPago(db, env, 1), {
      ok: true,
      enviado: true,
      sucessos: 1,
      stale: 0
    });
    assert.deepEqual(await state(), event("ENVIADO", 1, null));
  });
  await t.test("ENVIADO excluded from retry and direct notification", async () => {
    await ignored(production, "ENVIADO", 2, "2000-01-01 00:00:00");
    assert.deepEqual(await production.notificarNovoPedidoPago(db, env, 1), {
      ok: true,
      enviado: false,
      motivo: "JA_ENVIADO"
    });
    assert.equal(calls.length, 0);
  });
  for (const [name, transportError] of [
    ["transport failure", new Error("push service unavailable")],
    ["timeout", new DOMException("Timed out", "TimeoutError")]
  ])
    await t.test(`${name} becomes FALHA and increments attempt`, async () => {
      await reset();
      globalThis[bridge] = async () => {
        calls.push("failed send");
        throw transportError;
      };
      assert.deepEqual(await retry(production), failed);
      const row = await state();
      assert.equal(row.status, "FALHA");
      assert.equal(row.tentativas, 2);
      assert.ok(row.ultimo_erro && JSON.parse(row.ultimo_erro));
      assert.deepEqual(await retry(production), none, "Backoff applies immediately after failure");
    });
  await t.test("missing VAPID leaves acquired claim PENDENTE without attempt", async () => {
    await reset();
    assert.deepEqual(await production.reconciliarPushEventosFalhos(db, { DB: db }), failed);
    assert.deepEqual(await state(), event("PENDENTE", 1));
    assert.equal(calls.length, 0);
    assert.deepEqual(await retry(production), none);
  });
  await t.test("subscription read exception is caught but leaves PENDENTE", async () => {
    await reset();
    db.hook = statements => {
      if (statements.some(row => row.sql.includes("FROM push_inscricoes pi"))) throw fault;
    };
    assert.deepEqual(await retry(production), failed);
    db.hook = null;
    assert.deepEqual(await state(), event("PENDENTE", 1));
    assert.deepEqual(await retry(production), none);
    assert.equal(calls.length, 0);
  });
  await t.test("successful remote send followed by persistence failure is abandoned", async () => {
    await reset();
    db.hook = statements => {
      if (statements.some(row => row.sql.includes("SET status = 'ENVIADO'"))) throw fault;
    };
    assert.deepEqual(await retry(production), failed);
    db.hook = null;
    assert.deepEqual(await state(), event("PENDENTE", 1));
    assert.equal(calls.length, 1);
    assert.deepEqual(await retry(production), none);
    assert.equal(calls.length, 1);
    await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
    const response = await production.onRequestPost({
      env,
      request: new Request("https://local.test/api/admin/push/retry", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: session.cookie.split(";")[0] }
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      await response.json(),
      none,
      "Manual retry does not recover even aged PENDENTE"
    );
    assert.equal(calls.length, 1);
  });
  await t.test("lost completion retried through initial notifier duplicates delivery", async () => {
    await reset("PENDENTE", 0);
    db.hook = statements => {
      if (statements.some(row => row.sql.includes("SET status = 'ENVIADO'"))) throw fault;
    };
    await production.notificarNovoPedidoPagoSafe(db, env, 1);
    db.hook = null;
    assert.deepEqual(await state(), event("PENDENTE", 0));
    await production.notificarNovoPedidoPago(db, env, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(await state(), event("ENVIADO", 1));
  });
  await t.test("two initial notifications have no exclusive claim", async () => {
    await reset("PENDENTE", 0);
    const rendezvous = barrier(2);
    db.hook = async statements => {
      if (statements.some(row => row.sql.includes("FROM push_inscricoes pi"))) await rendezvous();
    };
    await Promise.all([
      production.notificarNovoPedidoPago(db, env, 1),
      production.notificarNovoPedidoPago(db, env, 1)
    ]);
    db.hook = null;
    assert.equal(calls.length, 2);
    assert.deepEqual(await state(), event("ENVIADO", 1));
  });
  await t.test("direct FALHA retry bypasses backoff", async () => {
    await reset("FALHA", 1, await db.prepare("SELECT CURRENT_TIMESTAMP AS value").first("value"));
    await production.notificarNovoPedidoPago(db, env, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(await state(), event("ENVIADO", 2));
  });
  await t.test("direct notifier respects FALHA attempt limit", async () => {
    await reset("FALHA", 3);
    assert.deepEqual(await production.notificarNovoPedidoPago(db, env, 1), {
      ok: false,
      motivo: "LIMITE_TENTATIVAS_EXCEDIDO"
    });
    assert.equal(calls.length, 0);
  });
  await t.test("no recipients still finishes ENVIADO and counts attempt", async () => {
    await reset("FALHA", 1, "2000-01-01 00:00:00", 0);
    assert.deepEqual(await retry(production), success);
    assert.deepEqual(await state(), event("ENVIADO", 2));
  });
  await t.test("mixed delivery marks whole event ENVIADO despite failed recipient", async () => {
    await reset("FALHA", 1, "2000-01-01 00:00:00", 2);
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      if (calls.length === 2) throw fault;
      return true;
    };
    assert.deepEqual(await retry(production), success);
    assert.deepEqual(await state(), event("ENVIADO", 2));
    assert.deepEqual(await retry(production), none);
  });
  await t.test("stale subscription cleanup failure leaves PENDENTE", async () => {
    await reset();
    globalThis[bridge] = async () => false;
    db.hook = statements => {
      if (statements.some(row => row.sql.startsWith("DELETE FROM push_inscricoes"))) throw fault;
    };
    assert.deepEqual(await retry(production), failed);
    db.hook = null;
    assert.deepEqual(await state(), event("PENDENTE", 1));
  });
  await t.test("active transport claim stays exclusive against retry", async () => {
    await reset();
    let started;
    let release;
    const sending = new Promise(resolve => {
      started = resolve;
    });
    const gate = new Promise(resolve => {
      release = resolve;
    });
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      started();
      await gate;
      return true;
    };
    const worker = retry(production);
    try {
      await sending;
      assert.deepEqual(await state(), event("PENDENTE", 1));
      assert.deepEqual(await retry(production), none);
      assert.equal(calls.length, 1);
    } finally {
      release();
    }
    assert.deepEqual(await worker, success);
    assert.deepEqual(await state(), event("ENVIADO", 2));
  });
  const controls = [
    {
      name: "claim guard removed",
      from: "AND status = 'FALHA'\n           AND tentativas < ?",
      to: "AND tentativas < ?",
      contract: "claim"
    },
    {
      name: "pending included without lease",
      from: "AND status = 'FALHA'\n         AND tentativas < ?",
      to: "AND status IN ('FALHA','PENDENTE')\n         AND tentativas < ?",
      contract: "pending"
    },
    {
      name: "attempt double increment",
      from: "tentativasAtuais + 1",
      to: "tentativasAtuais + 2",
      count: 2,
      contract: "normal"
    },
    {
      name: "backoff removed",
      from: "RETRY_BACKOFF_SECONDS = 30",
      to: "RETRY_BACKOFF_SECONDS = 0",
      contract: "backoff"
    },
    {
      name: "attempt limit increased",
      from: "RETRY_MAX_ATTEMPTS = 3",
      to: "RETRY_MAX_ATTEMPTS = 4",
      contract: "limit"
    },
    {
      name: "success stored as FALHA",
      from: "SET status = 'ENVIADO', tentativas",
      to: "SET status = 'FALHA', tentativas",
      count: 2,
      contract: "normal"
    },
    {
      name: "claim timestamp not refreshed",
      from: "SET status = 'PENDENTE',\n             atualizado_em = CURRENT_TIMESTAMP",
      to: "SET status = 'PENDENTE',\n             atualizado_em = atualizado_em",
      contract: "claimTimestamp"
    }
  ];
  for (const control of controls)
    await t.test(`negative control: ${control.name}`, async () => {
      const mutated = await compile(control);
      await assert.rejects(contracts[control.contract](mutated), { code: "ERR_ASSERTION" });
      db.hook = null;
    });
});
