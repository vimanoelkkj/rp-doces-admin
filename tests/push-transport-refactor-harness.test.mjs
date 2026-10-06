import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateVapidKeys } from "@mmmike/web-push/vapid";
import { build } from "esbuild";
import ts from "typescript";
import { fixture } from "./helpers/b3.mjs";

const path = "functions/lib/pushNotifier.ts";
const source = await readFile(path, "utf8");
const transportSource = await readFile("functions/lib/pushTransport.ts", "utf8");
const vapid = await generateVapidKeys();
const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keys = {
  p256dh: publicKey.export({ type: "spki", format: "der" }).subarray(-65).toString("base64url"),
  auth: crypto.randomBytes(16).toString("base64url")
};
const sub = { endpoint: "https://push.example.invalid/1", ...keys };
const payload = {
  title: "Novo pedido 🍰",
  body: "Pedido RP-1 · R$ 1234,56",
  tag: "pedido-1",
  url: "/admin/pedidos?pedido=1",
  pedidoId: 1
};
const bridge = Symbol.for("rp-doces.push-transport-harness");

function syntax(contents) {
  return ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}

// Exercise the actual transport expression, outside the notifier's intentional catch.
// No adapter implementation is copied into the test.
async function compile(contents = source, mocked = false) {
  const transportContents = typeof contents === "string" ? transportSource : contents.transport;
  contents = typeof contents === "string" ? contents : contents.notifier;
  const ast = syntax(contents);
  const delivered = find(
    ast,
    node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "delivered"
  );
  assert.ok(delivered?.initializer, "transport result must remain observable");
  const bundle = await build({
    stdin: {
      contents: `${contents}\nexport async function probe(sub, payload, publicKey, privateKey, subject) {
        return ${delivered.initializer.getText(ast)};
      }`,
      resolveDir: `${process.cwd()}/functions/lib`,
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "transport-source",
        setup(builder) {
          builder.onLoad({ filter: /pushTransport\.ts$/ }, () => ({
            contents: transportContents,
            loader: "ts"
          }));
        }
      },
      ...(mocked
        ? [
            {
              name: "push-boundary",
              setup(builder) {
                builder.onResolve({ filter: /^@mmmike\/web-push\/send$/ }, () => ({
                  path: "send",
                  namespace: "push-boundary"
                }));
                builder.onLoad({ filter: /.*/, namespace: "push-boundary" }, () => ({
                  contents: `export const sendPushNotification = (...args) =>
                globalThis[Symbol.for("rp-doces.push-transport-harness")](...args);`
                }));
              }
            }
          ]
        : [])
    ]
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

async function transportContract(t, module) {
  const requests = [];
  const timeouts = [];
  let outcome = 201;
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", ms => {
    timeouts.push(ms);
    return timeout(ms);
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (outcome instanceof Error) throw outcome;
    return new Response(null, { status: outcome });
  });
  const send = (subscription = sub, config = vapid, subject = "mailto:admin@example.invalid") =>
    module.probe(subscription, payload, config.publicKey, config.privateKey, subject);
  for (const status of [200, 201, 204, 299, 404, 410]) {
    outcome = status;
    assert.equal(await send(), status < 300, `HTTP ${status}`);
  }
  for (const status of [429, 500]) {
    outcome = status;
    await assert.rejects(send(), error => error.statusCode === status);
  }
  outcome = new Error("network unavailable");
  await assert.rejects(send(), error => error === outcome);
  const beforeInvalid = requests.length;
  await assert.rejects(send({ ...sub, p256dh: "invalid" }));
  await assert.rejects(send(sub, { ...vapid, privateKey: "invalid" }));
  await assert.rejects(send(sub, { ...vapid, publicKey: "invalid" }));
  await assert.rejects(send(sub, vapid, "invalid-subject"));
  assert.equal(requests.length, beforeInvalid, "invalid inputs fail before network");
  assert.deepEqual(timeouts, Array(requests.length).fill(30000));
  for (const { url, options } of requests) {
    assert.equal(url, sub.endpoint);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.TTL, "86400");
    assert.equal(options.headers["Content-Encoding"], "aes128gcm");
    assert.equal(options.headers["Content-Type"], "application/octet-stream");
    assert.match(options.headers.Authorization, /^vapid t=.+, k=/);
    assert.equal(options.headers.Topic, undefined);
    assert.equal(options.headers.Urgency, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.body instanceof Uint8Array);
  }
}

async function reset(db, outcomes, { status = "PENDENTE", attempts = 0, error = null } = {}) {
  db.hook = null;
  await db.prepare("DELETE FROM push_inscricoes").run();
  await db.prepare("DELETE FROM push_eventos").run();
  await db.prepare("UPDATE pedidos SET valor_total_centavos = 123456 WHERE id = 1").run();
  await db
    .prepare(
      "INSERT INTO push_eventos(pedido_id,evento,status,tentativas,ultimo_erro,claim_expires_at,atualizado_em) VALUES(1,'PEDIDO_PAGO',?,?,?,'2000-01-01 00:00:00','2000-01-01 00:00:00')"
    )
    .bind(status, attempts, error)
    .run();
  for (let i = 0; i < outcomes.length; i++) {
    await db
      .prepare("INSERT INTO push_inscricoes(id,usuario_id,endpoint,p256dh,auth) VALUES(?,1,?,?,?)")
      .bind(i + 1, `https://push.example.invalid/${i + 1}`, keys.p256dh, keys.auth)
      .run();
  }
}

async function coordinate(module, db, outcomes, options = {}) {
  await reset(db, outcomes, options);
  const trace = [];
  let active = 0;
  let maximum = 0;
  const calls = [];
  globalThis[bridge] = async (...args) => {
    const [subscription] = args;
    const id = Number(subscription.endpoint.split("/").at(-1));
    calls.push(args);
    trace.push(`send:${id}`);
    maximum = Math.max(maximum, ++active);
    // Yield deterministically; Promise.all would start another send before completion.
    await new Promise(resolve => setImmediate(resolve));
    active--;
    trace.push(`done:${id}`);
    const result = outcomes[id - 1];
    if (result instanceof Error || typeof result === "string") throw result;
    return result;
  };
  const sql = [];
  db.hook = statements => {
    for (const statement of statements) {
      const normalized = statement.sql.replace(/\s+/g, " ").trim();
      sql.push({ sql: normalized, args: statement.args });
      let stage;
      if (normalized.startsWith("DELETE FROM push_inscricoes"))
        stage = `delete:${statement.args[0]}`;
      if (normalized.includes("SET status = ?, tentativas")) stage = "update";
      if (stage) {
        trace.push(stage);
        if (options.fail === stage) throw new Error(`persist:${stage}`);
      }
    }
  };
  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    ...(options.env ?? {})
  };
  let result;
  let failure;
  try {
    result = await module[options.safe ? "notificarNovoPedidoPagoSafe" : "notificarNovoPedidoPago"](
      db,
      env,
      1,
      options.notify
    );
  } catch (error) {
    failure = error;
  }
  db.hook = null;
  const event = await db
    .prepare("SELECT status,tentativas,ultimo_erro FROM push_eventos WHERE pedido_id=1")
    .first();
  const { results: remaining } = await db
    .prepare("SELECT id FROM push_inscricoes ORDER BY id")
    .all();
  return {
    result,
    failure,
    event,
    remaining: remaining.map(row => row.id),
    trace,
    maximum,
    calls,
    sql,
    env
  };
}

async function payloadContract(module, db) {
  const run = await coordinate(module, db, [true]);
  assert.ifError(run.failure);
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.calls[0], [
    { endpoint: sub.endpoint, keys },
    payload,
    { ...vapid, subject: "mailto:contato@rpdoces.com.br" }
  ]);
  // Exact keys and values forbid additional PII, including existing fixture name/phone/token.
  assert.deepEqual(Object.keys(run.calls[0][1]).sort(), [
    "body",
    "pedidoId",
    "tag",
    "title",
    "url"
  ]);
  for (const [cents, formatted] of [
    [0, "0,00"],
    [1, "0,01"],
    [105, "1,05"],
    [100000, "1000,00"]
  ]) {
    await db.prepare("UPDATE pedidos SET valor_total_centavos=? WHERE id=1").bind(cents).run();
    await db.prepare("DELETE FROM push_eventos").run();
    await module.notificarNovoPedidoPago(db, run.env, 1);
    assert.deepEqual(run.calls.at(-1)[1], { ...payload, body: `Pedido RP-1 · R$ ${formatted}` });
  }
  const custom = await coordinate(module, db, [true], {
    env: { VAPID_SUBJECT: "mailto:custom@example.invalid" }
  });
  assert.equal(custom.calls[0][2].subject, "mailto:custom@example.invalid");
}

async function orderContract(module, db) {
  const run = await coordinate(module, db, [false, true, false]);
  assert.ifError(run.failure);
  assert.deepEqual(run.trace, [
    "send:1",
    "done:1",
    "send:2",
    "done:2",
    "send:3",
    "done:3",
    "delete:1",
    "delete:3",
    "update"
  ]);
  assert.equal(run.maximum, 1);
  assert.deepEqual(run.remaining, [2]);
  assert.deepEqual(run.result, { ok: true, enviado: true, sucessos: 1, stale: 2 });
  assert.deepEqual(run.event, { status: "ENVIADO", tentativas: 1, ultimo_erro: null });
}

async function partialContract(module, db) {
  const run = await coordinate(
    module,
    db,
    [new Error("429"), true, new Error("500"), new Error("network"), false],
    { attempts: 1, error: "previous" }
  );
  assert.ifError(run.failure);
  assert.deepEqual(run.result, { ok: true, enviado: true, sucessos: 1, stale: 1 });
  assert.deepEqual(run.event, { status: "ENVIADO", tentativas: 2, ultimo_erro: "previous" });
  assert.deepEqual(run.remaining, [1, 2, 3, 4]);
}

function replaceOnce(contents, from, to) {
  assert.equal(contents.split(from).length, 2, "mutation anchor must be unique");
  return contents.replace(from, to);
}

function mutateTransport(transform) {
  const ast = syntax(transportSource);
  const adapter = ast.statements.find(
    node => ts.isFunctionDeclaration(node) && node.name?.text === "enviarPush"
  );
  const node = find(adapter.body, ts.isReturnStatement).expression;
  return {
    notifier: source,
    transport:
      transportSource.slice(0, node.getStart(ast)) +
      transform(`await (${node.getText(ast)})`) +
      transportSource.slice(node.end)
  };
}

test("Web Push transport characterization", async t => {
  await transportContract(t, await compile());
});

test("Persisted push coordination characterization", async t => {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  t.after(() => {
    delete globalThis[bridge];
  });
  // Expected failures are asserted below; avoid logging encrypted bundle stack traces.
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  const module = await compile(source, true);
  await t.test("exact payload, no PII, monetary formatting and VAPID subject", () =>
    payloadContract(module, db)
  );
  await t.test("sequential network, deferred stale cleanup, final update", () =>
    orderContract(module, db)
  );
  await t.test("any success ends event; transient subscriptions and previous error survive", () =>
    partialContract(module, db)
  );
  await t.test("only expired subscriptions still count as ENVIADO", async () => {
    const run = await coordinate(module, db, [false, false], { attempts: 2, error: "previous" });
    assert.deepEqual(run.result, { ok: true, enviado: true, sucessos: 0, stale: 2 });
    assert.deepEqual(run.event, { status: "ENVIADO", tentativas: 3, ultimo_erro: "previous" });
    assert.deepEqual(run.remaining, []);
  });
  await t.test("zero recipients increments attempts without clearing old error", async () => {
    const run = await coordinate(module, db, [], { attempts: 1, error: "previous" });
    assert.deepEqual(run.result, { ok: true, enviado: false, destinatarios: 0 });
    assert.deepEqual(run.event, { status: "ENVIADO", tentativas: 2, ultimo_erro: "previous" });
    assert.deepEqual(run.trace, ["update"]);
  });
  await t.test("total failure retains subscriptions and persists last error", async () => {
    for (const outcomes of [
      [new Error("429"), new Error("500"), new Error("network")],
      [false, "non-Error failure"]
    ]) {
      const run = await coordinate(module, db, outcomes, { attempts: 1 });
      const last = outcomes.at(-1);
      const error =
        last instanceof Error
          ? '{"category":"NETWORK","code":"NETWORK_ERROR"}'
          : '{"category":"UNKNOWN","code":"UNKNOWN_ERROR"}';
      assert.deepEqual(run.result, { ok: false, motivo: "FALHA_PUSH_SERVICE", ultimoErro: error });
      assert.deepEqual(run.event, { status: "FALHA", tentativas: 2, ultimo_erro: error });
      assert.deepEqual(
        run.remaining,
        outcomes.flatMap((outcome, i) => (outcome === false ? [] : [i + 1]))
      );
    }
  });
  await t.test("missing VAPID releases claim as retryable sanitized failure", async () => {
    const run = await coordinate(module, db, [true], { env: { VAPID_PRIVATE_KEY: undefined } });
    assert.deepEqual(run.result, { ok: false, motivo: "VAPID_NAO_CONFIGURADO" });
    assert.deepEqual(run.event, {
      status: "FALHA",
      tentativas: 1,
      ultimo_erro: JSON.stringify({ category: "CONFIGURATION", code: "VAPID_NAO_CONFIGURADO" })
    });
    assert.deepEqual(run.trace, ["update"]);
    assert.match(run.sql[1].sql, /ON CONFLICT\(pedido_id, evento\) DO NOTHING/);
    assert.match(run.sql[2].sql, /^SELECT status, tentativas/);
  });
  await t.test("operator exclusion remains in recipient query", async () => {
    const run = await coordinate(module, db, [true], { notify: { excludeUsuarioId: 1 } });
    assert.deepEqual(run.result, { ok: true, enviado: false, destinatarios: 0 });
    const query = run.sql.find(row => row.sql.includes("FROM push_inscricoes pi"));
    assert.match(
      query.sql,
      /JOIN usuarios_admin u ON u.id = pi.usuario_id WHERE u.ativo = 1 AND pi.usuario_id != \?/
    );
    assert.deepEqual(query.args, [1]);
  });
  await t.test("DELETE failure preserves earlier deletion and skips final update", async () => {
    const run = await coordinate(module, db, [false, false, true], { fail: "delete:2" });
    assert.equal(run.failure?.message, "persist:delete:2");
    assert.deepEqual(run.trace, [
      "send:1",
      "done:1",
      "send:2",
      "done:2",
      "send:3",
      "done:3",
      "delete:1",
      "delete:2",
      "update"
    ]);
    assert.deepEqual(run.remaining, [2, 3]);
    assert.deepEqual(run.event, {
      status: "FALHA",
      tentativas: 1,
      ultimo_erro: JSON.stringify({ category: "UNKNOWN", code: "UNKNOWN_ERROR" })
    });
  });
  await t.test("final UPDATE failure retains prior state after network and cleanup", async () => {
    for (const status of ["PENDENTE", "FALHA"]) {
      const run = await coordinate(module, db, [false, true], {
        fail: "update",
        status,
        attempts: 1,
        error: "previous"
      });
      assert.equal(run.failure?.message, "persist:update");
      assert.deepEqual(run.remaining, [2]);
      assert.deepEqual(run.event, { status: "PENDENTE", tentativas: 1, ultimo_erro: "previous" });
      assert.deepEqual(run.trace, [
        "send:1",
        "done:1",
        "send:2",
        "done:2",
        "delete:1",
        "update",
        "update"
      ]);
    }
  });
  await t.test("safe notifier suppresses persistence exception after successful send", async () => {
    const run = await coordinate(module, db, [true], { fail: "update", safe: true });
    assert.ifError(run.failure);
    assert.equal(run.result, undefined);
    assert.deepEqual(run.event, { status: "PENDENTE", tentativas: 0, ultimo_erro: null });
    assert.deepEqual(run.trace, ["send:1", "done:1", "update", "update"]);
  });
  await t.test("failed FALHA update also leaves attempts and error unchanged", async () => {
    const run = await coordinate(module, db, [new Error("network")], {
      fail: "update",
      error: "previous"
    });
    assert.equal(run.failure?.message, "persist:update");
    assert.deepEqual(run.remaining, [1]);
    assert.deepEqual(run.event, { status: "PENDENTE", tentativas: 0, ultimo_erro: "previous" });
    assert.deepEqual(run.trace, ["send:1", "done:1", "update", "update"]);
  });
  await t.test(
    "retry constants, ordered candidate SQL, CAS and dedup remain unchanged",
    async () => {
      assert.equal(module.RETRY_BACKOFF_SECONDS, 30);
      assert.equal(module.RETRY_MAX_ATTEMPTS, 3);
      assert.equal(module.RETRY_BATCH_SIZE, 5);
      const run = await coordinate(module, db, [], { status: "FALHA", attempts: 3 });
      assert.equal(run.result.motivo, "LIMITE_TENTATIVAS_EXCEDIDO");
      await db
        .prepare(
          "UPDATE push_eventos SET tentativas=1, atualizado_em='2000-01-01 00:00:00' WHERE pedido_id=1"
        )
        .run();
      const queries = [];
      db.hook = statements => {
        queries.push(
          ...statements.map(row => ({ sql: row.sql.replace(/\s+/g, " ").trim(), args: row.args }))
        );
      };
      assert.deepEqual(await module.reconciliarPushEventosFalhos(db, run.env), {
        ok: true,
        processados: 1,
        sucessos: 1,
        falhas: 0
      });
      db.hook = null;
      assert.deepEqual(queries[0].args, [3, 30, 5]);
      assert.match(queries[0].sql, /status = 'FALHA'.*tentativas < \?/);
      assert.match(queries[0].sql, /status = 'PENDENTE'.*claim_expires_at.*datetime\('now'\)/);
      assert.match(queries[1].sql, /SET status = 'PENDENTE', claim_token = \?/);
      assert.match(queries[1].sql, /WHERE pedido_id = \?.*tentativas = \?/);
      assert.equal(typeof queries[1].args[0], "string");
      assert.deepEqual(queries[1].args.slice(1), [120, 1, 1, 3, 30]);
      assert.ok(
        queries.some(q => q.sql === "SELECT id, valor_total_centavos FROM pedidos WHERE id = ?")
      );
      assert.deepEqual(await module.notificarNovoPedidoPago(db, run.env, 1), {
        ok: true,
        enviado: false,
        motivo: "JA_ENVIADO"
      });
      assert.deepEqual(
        await db
          .prepare("SELECT status,tentativas,ultimo_erro FROM push_eventos WHERE pedido_id=1")
          .first(),
        { status: "ENVIADO", tentativas: 2, ultimo_erro: null }
      );
      await db
        .prepare(
          "UPDATE push_eventos SET status='FALHA',tentativas=1,atualizado_em='2000-01-01 00:00:00' WHERE pedido_id=1"
        )
        .run();
      // A competing worker acquires the real D1 claim before this worker's CAS.
      db.hook = async statements => {
        if (statements[0].sql.includes("SET status = 'PENDENTE'")) {
          db.hook = null;
          await db
            .prepare(statements[0].sql)
            .bind(...statements[0].args)
            .run();
        }
      };
      assert.deepEqual(await module.reconciliarPushEventosFalhos(db, run.env), {
        ok: true,
        processados: 1,
        sucessos: 0,
        falhas: 0
      });
      db.hook = null;
      assert.deepEqual(
        await db.prepare("SELECT status,tentativas FROM push_eventos WHERE pedido_id=1").first(),
        { status: "PENDENTE", tentativas: 1 }
      );
    }
  );

  const ast = syntax(source);
  const dispatch = ast.statements.find(
    node => ts.isFunctionDeclaration(node) && node.name?.text === "despacharParaInscricoes"
  );
  const loop = dispatch.body.statements.find(ts.isForOfStatement);
  const cleanup = dispatch.body.statements.find(
    node => ts.isIfStatement(node) && node.expression.getText(ast) === "staleIds.length > 0"
  );
  const conclusion = dispatch.body.statements.at(-1);
  const reordered =
    source.slice(0, cleanup.getStart(ast)) +
    source.slice(cleanup.end, conclusion.getStart(ast)) +
    // Replace terminal returns so the prematurely persisted update can reach cleanup.
    conclusion.getText(ast).replace(/return \{[^;]+;/g, "") +
    "\n" +
    cleanup.getText(ast) +
    "\nreturn { ok: true, enviado: true, sucessos, stale: staleIds.length };" +
    source.slice(conclusion.end);
  const parallel =
    source.slice(0, loop.getStart(ast)) +
    "await Promise.all(inscricoes.map(async sub => " +
    loop.statement.getText(ast) +
    "));" +
    source.slice(loop.end);
  const negatives = [
    [
      "treat gone results (404/410) as delivered",
      mutateTransport(expression => `((${expression}) || true)`),
      orderContract
    ],
    [
      "swallow adapter exceptions",
      mutateTransport(
        expression =>
          `await (async () => { try { return ${expression}; } catch { return false; } })()`
      ),
      partialContract
    ],
    [
      "include PII",
      {
        notifier: source,
        transport: replaceOnce(
          transportSource,
          "    pedidoId\n",
          '    pedidoId, cliente_nome: "Teste", token_publico: "token"\n'
        )
      },
      payloadContract
    ],
    ["update before cleanup", reordered, orderContract],
    ["parallel sends", parallel, orderContract],
    [
      "require all sends to succeed",
      replaceOnce(
        source,
        "sucessos > 0 || (falhas === 0 && staleIds.length > 0)",
        "falhas === 0 && (sucessos > 0 || staleIds.length > 0)"
      ),
      partialContract
    ]
  ];
  for (const [name, mutated, contract] of negatives) {
    await t.test(`negative control: ${name}`, async () => {
      const mutant = await compile(mutated, true);
      await assert.rejects(contract(mutant, db), error => error.code === "ERR_ASSERTION");
    });
  }
  // Test result polarity and exception propagation against real HTTP, not only mocked outcomes.
  for (const [name, mutated] of negatives.slice(0, 2)) {
    await t.test(`real transport negative control: ${name}`, async child => {
      const mutant = await compile(mutated);
      await assert.rejects(
        transportContract(child, mutant),
        error => error.code === "ERR_ASSERTION"
      );
    });
  }
});
