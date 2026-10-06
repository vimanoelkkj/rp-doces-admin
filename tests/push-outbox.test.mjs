import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { app, fixture, isProjection } from "./helpers/b3.mjs";

const entries = `export * as notifier from './functions/lib/pushNotifier';
  export * as outbox from './functions/lib/pushOutbox';
  export { default as worker } from './workers/push';
  export * as sync from './functions/lib/paymentSync';
  export * as admin from './functions/api/admin/pedidos';`;

const bridge = Symbol.for("rp-doces.push-outbox-test");
async function compile(contents = entries, mutation) {
  const bundle = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "push-boundary",
        setup(api) {
          api.onLoad({ filter: /pushTransport\.ts$/ }, () => ({
            contents: `export function criarPayloadPedidoPago(id, value) { return { pedidoId: id, value }; }
          export const enviarPush = (...args) => globalThis[Symbol.for("rp-doces.push-outbox-test")](...args);`,
            loader: "ts"
          }));
          if (mutation)
            api.onLoad({ filter: mutation.file }, async ({ path }) => {
              const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
              assert.equal(source.split(mutation.from).length - 1, mutation.count ?? 1);
              return { contents: source.replaceAll(mutation.from, mutation.to), loader: "ts" };
            });
        }
      }
    ]
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

async function setup(t) {
  const db = await fixture(t);
  const calls = [];
  globalThis[bridge] = async sub => {
    calls.push(sub.endpoint);
    return true;
  };
  t.after(() => {
    delete globalThis[bridge];
    db.hook = null;
  });
  await db
    .prepare(
      "INSERT INTO push_inscricoes(usuario_id,endpoint,p256dh,auth) VALUES(1,'https://push.invalid/owner','key','auth')"
    )
    .run();
  return { db, calls, env: { DB: db, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" } };
}

async function exclusionContract(t, module) {
  const { db, env, calls } = await setup(t);
  // Force a persisted failure without transport, then retry with valid VAPID.
  await module.notifier.notificarNovoPedidoPago(db, { DB: db }, 1, { excludeUsuarioId: 1 });
  await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
  await module.notifier.reconciliarPushEventosFalhos(db, env);
  assert.deepEqual(calls, [], "the operator exclusion must survive recovery");
  assert.equal((await db.prepare("SELECT status FROM push_eventos").first()).status, "ENVIADO");
}

test("push outbox: operator exclusion survives recovery", async t => {
  await exclusionContract(t, await compile());
});

const production = await compile();
const messageBody = { pedidoId: 1, evento: "PEDIDO_PAGO" };
function delivery(body = messageBody) {
  const message = {
    body,
    acknowledgments: 0,
    retries: 0,
    ack() {
      this.acknowledgments++;
    },
    retry() {
      this.retries++;
    }
  };
  return { message, batch: { messages: [message] } };
}
const row = db =>
  db
    .prepare(
      "SELECT status,tentativas,claim_token,exclude_usuario_id FROM push_eventos WHERE pedido_id=1"
    )
    .first();
async function register(db, module = production, options) {
  await module.outbox.registrarEventoPedidoPago(db, 1, options);
}
async function consume(env, module = production, body) {
  const { message, batch } = delivery(body);
  await module.worker.queue(batch, env);
  return message;
}

async function missingOutboxContract(t, module, manual = false) {
  const { db, env, calls } = await setup(t);
  let pedidoId = 1;
  db.hook = statements => {
    if (statements[0].sql.includes("INSERT INTO push_eventos"))
      throw new Error("outbox unavailable after financial commit");
  };
  if (manual) {
    const session = await app.auth.createSession(db, 1);
    const response = await module.admin.onRequestPost({
      env,
      request: new Request("https://local.test/api/admin/pedidos", {
        method: "POST",
        headers: {
          Origin: "https://local.test",
          Cookie: session.cookie.split(";")[0],
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          itens: [{ produtoId: 1, quantidade: 1 }],
          clienteNome: "Private",
          clienteWhatsapp: "11999999999",
          metodoPagamento: "DINHEIRO",
          statusPagamento: "PAGO",
          operationKey: "missing-outbox-manual"
        })
      })
    });
    assert.equal(response.status, 201);
    pedidoId = (await response.json()).pedidoId;
  } else {
    const payment = await module.sync.fetchMpPayment("fake", "101");
    assert.deepEqual(await module.sync.syncPaymentFromMp(db, 1, payment, env), {
      ok: true,
      status: "PAGO",
      transicionou: true
    });
  }
  db.hook = null;
  assert.equal(
    (await db.prepare("SELECT status_pagamento FROM pedidos WHERE id=?").bind(pedidoId).first())
      .status_pagamento,
    "PAGO"
  );
  assert.equal(
    await db.prepare("SELECT * FROM push_eventos WHERE pedido_id=?").bind(pedidoId).first(),
    null
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT push_pedido_pago,push_exclude_usuario_id FROM pedido_pagamentos WHERE pedido_id=?"
      )
      .bind(pedidoId)
      .first(),
    {
      push_pedido_pago: 1,
      push_exclude_usuario_id: manual ? 1 : null
    }
  );
  // A deleted admin clears the FK-backed operator field, not this snapshot.
  if (manual)
    await db
      .prepare("UPDATE pedido_pagamentos SET registrado_por_usuario_id=NULL WHERE pedido_id=?")
      .bind(pedidoId)
      .run();
  await module.worker.scheduled({}, env);
  const recovered = await db
    .prepare("SELECT status,exclude_usuario_id FROM push_eventos WHERE pedido_id=?")
    .bind(pedidoId)
    .first();
  assert.deepEqual(recovered, { status: "ENVIADO", exclude_usuario_id: manual ? 1 : null });
  assert.deepEqual(calls, manual ? [] : ["https://push.invalid/owner"]);
  await module.worker.scheduled({}, env);
  assert.equal(calls.length, manual ? 0 : 1);
}

test("missing outbox: paid Pix remains recoverable after initial insert failure", t =>
  missingOutboxContract(t, production));
test("missing outbox: paid manual order retains its operator exclusion", t =>
  missingOutboxContract(t, production, true));

test("missing outbox: interruption immediately after paid CAS retains intent", async t => {
  const { db, env } = await setup(t);
  const payment = await production.sync.fetchMpPayment("fake", "101");
  let paidWrite = false;
  db.hook = statements => {
    if (
      statements[0].sql.includes("UPDATE pedido_pagamentos") &&
      statements[0].sql.includes("SET status = ?")
    )
      paidWrite = true;
    if (paidWrite && isProjection(statements[0].sql)) throw new Error("interrupted after commit");
  };
  await assert.rejects(
    () => production.sync.syncPaymentFromMp(db, 1, payment, env),
    /interrupted after commit/
  );
  db.hook = null;
  assert.deepEqual(
    await db.prepare("SELECT status,push_pedido_pago FROM pedido_pagamentos WHERE id=1").first(),
    { status: "PAGO", push_pedido_pago: 1 }
  );
  assert.equal(await row(db), null);
  await production.worker.scheduled({}, env);
  assert.equal((await row(db)).status, "ENVIADO");
});

async function noSpuriousIntentContract(t, module) {
  const { db, env, calls } = await setup(t);
  // Historical/ordinary manual PAGO never implied the new-paid-order push.
  await db.prepare("UPDATE pedido_pagamentos SET status='PAGO'").run();
  await db.prepare("UPDATE pedidos SET status_pagamento='PAGO'").run();
  await module.worker.scheduled({}, env);
  assert.equal(await row(db), null);
  assert.deepEqual(calls, []);
}
test("missing outbox: aggregate/historical PAGO without explicit intent is excluded", t =>
  noSpuriousIntentContract(t, production));

for (const status of ["PENDENTE", "FALHOU", "CANCELADO", "EXPIRADO", "REEMBOLSADO"]) {
  test(`missing outbox: ${status} cannot produce a paid notification`, async t => {
    const { db, env, calls } = await setup(t);
    await db.prepare("UPDATE pedido_pagamentos SET status=?,push_pedido_pago=1").bind(status).run();
    await production.worker.scheduled({}, env);
    assert.equal(await row(db), null);
    assert.deepEqual(calls, []);
  });
}

test("missing outbox: invalid MP approval never records an intent", async t => {
  const { db, env } = await setup(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      id: 101,
      status: "approved",
      transaction_amount: 0.01,
      external_reference: "token",
      currency_id: "BRL",
      payment_method_id: "pix"
    })
  );
  const payment = await production.sync.fetchMpPayment("fake", "101");
  assert.deepEqual(await production.sync.syncPaymentFromMp(db, 1, payment, env), {
    ok: true,
    status: "PENDENTE",
    transicionou: false
  });
  assert.equal(
    (await db.prepare("SELECT push_pedido_pago FROM pedido_pagamentos").first()).push_pedido_pago,
    0
  );
  await production.worker.scheduled({}, env);
  assert.equal(await row(db), null);
});

test("missing outbox: concurrent reconstruction inserts only one event", async t => {
  const { db } = await setup(t);
  await db.prepare("UPDATE pedido_pagamentos SET status='PAGO',push_pedido_pago=1").run();
  const results = await Promise.all([
    production.outbox.reconstruirPushEventosAusentes(db),
    production.outbox.reconstruirPushEventosAusentes(db)
  ]);
  assert.deepEqual(results.sort(), [0, 1]);
  assert.equal((await row(db)).tentativas, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM push_eventos").first()).n, 1);
});

async function boundedRecoveryContract(t, module) {
  const { db, env, calls } = await setup(t);
  for (let id = 2; id <= 7; id++) {
    await db
      .prepare(
        "INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key) VALUES(?,?,'Private','000',100,?)"
      )
      .bind(id, `token-${id}`, `order-${id}`)
      .run();
    await db
      .prepare(
        "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,push_pedido_pago,push_exclude_usuario_id) VALUES(?,'DINHEIRO','ADMIN',100,'PAGO',1,1)"
      )
      .bind(id)
      .run();
  }
  await module.worker.scheduled({}, env);
  assert.deepEqual(
    (
      await db
        .prepare("SELECT pedido_id,status,exclude_usuario_id FROM push_eventos ORDER BY pedido_id")
        .all()
    ).results,
    [2, 3, 4, 5, 6].map(pedido_id => ({ pedido_id, status: "ENVIADO", exclude_usuario_id: 1 }))
  );
  await module.worker.scheduled({}, env);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM push_eventos").first()).n, 6);
  assert.deepEqual(calls, []);
}
test("missing outbox: bounded ordered batches eventually recover remaining intents", t =>
  boundedRecoveryContract(t, production));

test("migration 0037: legacy paid rows have no implicit intent", async t => {
  const { db } = await setup(t);
  await db.prepare("DROP INDEX idx_pagamentos_push_intent").run();
  await db.prepare("ALTER TABLE pedido_pagamentos DROP COLUMN push_pedido_pago").run();
  await db.prepare("ALTER TABLE pedido_pagamentos DROP COLUMN push_exclude_usuario_id").run();
  await db.prepare("UPDATE pedido_pagamentos SET status='PAGO'").run();
  const before = await db.prepare("SELECT * FROM pedido_pagamentos").first();
  await db.prepare(await readFile("migrations/0037_push_paid_intent.sql", "utf8")).run();
  assert.deepEqual(await db.prepare("SELECT * FROM pedido_pagamentos").first(), {
    ...before,
    push_pedido_pago: 0,
    push_exclude_usuario_id: null
  });
  assert.equal(await production.outbox.reconstruirPushEventosAusentes(db), 0);
});

for (const queueFails of [false, true]) {
  test(`paid payment: durable outbox, no transport, queue failure=${queueFails}`, async t => {
    const { db, env, calls } = await setup(t);
    const messages = [];
    env.PUSH_QUEUE = {
      async send(body) {
        assert.deepEqual(await row(db), {
          status: "PENDENTE",
          tentativas: 0,
          claim_token: null,
          exclude_usuario_id: null
        });
        messages.push(body);
        if (queueFails) throw new Error("queue unavailable secret");
      }
    };
    // Any attempted transport is an assertion failure, not a timing check.
    globalThis[bridge] = () => {
      calls.push("unexpected transport");
      assert.fail("financial confirmation must not invoke transport");
    };
    const payment = await production.sync.fetchMpPayment("fake", "101");
    assert.deepEqual(await production.sync.syncPaymentFromMp(db, 1, payment, env), {
      ok: true,
      status: "PAGO",
      transicionou: true
    });
    assert.deepEqual(messages, [messageBody]);
    assert.deepEqual(calls, []);
    assert.equal(
      (await db.prepare("SELECT status FROM pedido_pagamentos WHERE id=1").first()).status,
      "PAGO"
    );
    await production.sync.syncPaymentFromMp(db, 1, payment, env);
    assert.equal(messages.length, 1, "financial replay does not republish");
  });

  test(`paid manual order: durable exclusion, no transport, queue failure=${queueFails}`, async t => {
    const { db, env } = await setup(t);
    await db
      .prepare(
        "INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel) VALUES(2,'Other','other','other@example.invalid','unused','ADMIN')"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO push_inscricoes(usuario_id,endpoint,p256dh,auth) VALUES(2,'https://push.invalid/other','key','auth')"
      )
      .run();
    const session = await app.auth.createSession(db, 1);
    const messages = [];
    env.PUSH_QUEUE = {
      async send(body) {
        const event = await db
          .prepare(
            "SELECT status,tentativas,exclude_usuario_id FROM push_eventos WHERE pedido_id=?"
          )
          .bind(body.pedidoId)
          .first();
        assert.deepEqual(event, { status: "PENDENTE", tentativas: 0, exclude_usuario_id: 1 });
        messages.push(body);
        if (queueFails) throw new Error("queue unavailable");
      }
    };
    let sends = 0;
    globalThis[bridge] = async () => {
      sends++;
      return true;
    };
    const response = await production.admin.onRequestPost({
      env,
      request: new Request("https://local.test/api/admin/pedidos", {
        method: "POST",
        headers: {
          Origin: "https://local.test",
          Cookie: session.cookie.split(";")[0],
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          itens: [{ produtoId: 1, quantidade: 1 }],
          clienteNome: "Private customer",
          clienteWhatsapp: "11999999999",
          metodoPagamento: "DINHEIRO",
          statusPagamento: "PAGO",
          operationKey: "outbox-manual-creation"
        })
      })
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.statusPagamento, "PAGO");
    assert.equal(result.estoqueBaixado, true);
    assert.deepEqual(messages, [{ pedidoId: result.pedidoId, evento: "PEDIDO_PAGO" }]);
    assert.equal(sends, 0);
    // The same durable policy is used by the actual consumer later.
    await consume(env, production, { pedidoId: result.pedidoId, evento: "PEDIDO_PAGO" });
    assert.equal(sends, 1);
  });
}

async function dedupContract(t, module) {
  const { db, env, calls } = await setup(t);
  await register(db, module);
  const first = await consume(env, module);
  const second = await consume(env, module);
  assert.equal(first.acknowledgments, 1);
  assert.equal(second.acknowledgments, 1);
  assert.deepEqual(calls, ["https://push.invalid/owner"]);
  assert.deepEqual(await row(db), {
    status: "ENVIADO",
    tentativas: 1,
    claim_token: null,
    exclude_usuario_id: null
  });
}
test("consumer: normal delivery and duplicate message are idempotent", t =>
  dedupContract(t, production));

async function concurrencyContract(t, module) {
  const { db, env, calls } = await setup(t);
  await register(db, module);
  let release;
  let started;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const entered = new Promise(resolve => {
    started = resolve;
  });
  globalThis[bridge] = async () => {
    calls.push("send");
    started();
    await gate;
    return true;
  };
  const first = consume(env, module);
  await entered;
  // No second send is allowed while the owner is still inside transport.
  // Throw rather than block if a mutant steals the claim, avoiding deadlocks.
  globalThis[bridge] = async () => {
    calls.push("second");
    return true;
  };
  try {
    await consume(env, module);
    assert.deepEqual(calls, ["send"]);
  } finally {
    release();
    await first;
  }
  assert.equal((await row(db)).tentativas, 1);
}
test("consumer: concurrent duplicate respects active CAS claim", t =>
  concurrencyContract(t, production));

for (const state of ["active", "expired", "backoff", "exhausted", "sent"]) {
  test(`consumer eligibility: ${state}`, async t => {
    const { db, env, calls } = await setup(t);
    await register(db);
    const status = ["backoff", "exhausted"].includes(state)
      ? "FALHA"
      : state === "sent"
        ? "ENVIADO"
        : "PENDENTE";
    await db
      .prepare(
        "UPDATE push_eventos SET status=?,tentativas=?,claim_token=?,claim_expires_at=?,atualizado_em=CURRENT_TIMESTAMP"
      )
      .bind(
        status,
        state === "exhausted" ? 3 : 0,
        state === "active" ? "owner" : null,
        state === "active" ? "2099-01-01 00:00:00" : "2000-01-01 00:00:00"
      )
      .run();
    const before = await row(db);
    await consume(env);
    assert.equal(calls.length, state === "expired" ? 1 : 0);
    if (state !== "expired") assert.deepEqual(await row(db), before);
    else assert.equal((await row(db)).status, "ENVIADO");
  });
}

test("scheduled: recovers event whose queue publication failed", async t => {
  const { db, env, calls } = await setup(t);
  env.PUSH_QUEUE = {
    send() {
      throw new Error("unavailable");
    }
  };
  await production.outbox.enfileirarNovoPedidoPagoSafe(db, env, 1);
  assert.equal((await row(db)).status, "PENDENTE");
  await production.worker.scheduled({}, env);
  assert.deepEqual(calls, ["https://push.invalid/owner"]);
  assert.equal((await row(db)).status, "ENVIADO");
});

test("scheduled: eligible failure is retried, then backoff and ceiling apply", async t => {
  const { db, env, calls } = await setup(t);
  await register(db);
  globalThis[bridge] = async () => {
    calls.push("failed");
    throw new Error("transport");
  };
  await consume(env);
  await production.worker.scheduled({}, env);
  assert.equal(calls.length, 1);
  for (let attempt = 2; attempt <= 3; attempt++) {
    await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
    await production.worker.scheduled({}, env);
    assert.equal((await row(db)).tentativas, attempt);
  }
  await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
  await production.worker.scheduled({}, env);
  assert.equal(calls.length, 3);
});

for (const mode of ["consumer", "scheduled"]) {
  test(`${mode}: durable recipient policy survives replay with different options`, async t => {
    const { db, env, calls } = await setup(t);
    await register(db, production, { excludeUsuarioId: 1 });
    await register(db, production, { excludeUsuarioId: 2 });
    if (mode === "consumer") await consume(env);
    else await production.worker.scheduled({}, env);
    assert.deepEqual(calls, []);
    assert.equal((await row(db)).exclude_usuario_id, 1);
    assert.equal((await row(db)).status, "ENVIADO");
  });
}

async function fencingContract(t, module) {
  const { db, env } = await setup(t);
  await register(db, module);
  globalThis[bridge] = async () => {
    await db
      .prepare(
        "UPDATE push_eventos SET claim_token='replacement',claim_expires_at='2099-01-01 00:00:00'"
      )
      .run();
    return true;
  };
  await consume(env, module);
  assert.deepEqual(await row(db), {
    status: "PENDENTE",
    tentativas: 0,
    claim_token: "replacement",
    exclude_usuario_id: null
  });
}
test("consumer: old token cannot complete recovered ownership", t =>
  fencingContract(t, production));

test("consumer: business failure is acked, with D1 governing retry", async t => {
  const { db, env } = await setup(t);
  await register(db);
  delete env.VAPID_PRIVATE_KEY;
  const message = await consume(env);
  assert.equal(message.acknowledgments, 1);
  assert.equal(message.retries, 0);
  assert.equal((await row(db)).status, "FALHA");
});

for (const persisted of [false, true]) {
  test(`consumer: infrastructure fault, coherent failure persisted=${persisted}`, async t => {
    const { db, env } = await setup(t);
    await register(db);
    db.hook = statements => {
      const sql = statements[0].sql;
      if (sql.includes("FROM pedidos WHERE id")) throw new Error("database unavailable");
      if (!persisted && sql.includes("SET status = ?, tentativas"))
        throw new Error("writes unavailable");
    };
    const message = await consume(env);
    db.hook = null;
    assert.equal(message.acknowledgments, persisted ? 1 : 0);
    assert.equal(message.retries, persisted ? 0 : 1);
    assert.equal((await row(db)).status, persisted ? "FALHA" : "PENDENTE");
    if (!persisted) {
      await db.prepare("UPDATE push_eventos SET claim_expires_at='2000-01-01 00:00:00'").run();
      await production.worker.scheduled({}, env);
      assert.equal((await row(db)).status, "ENVIADO");
    }
  });
}

test("consumer: malformed message does not create an outbox event", async t => {
  const { db, env, calls } = await setup(t);
  for (const body of [
    null,
    {},
    { ...messageBody, pedidoId: -1 },
    { ...messageBody, pedidoId: "1" },
    { ...messageBody, evento: "OTHER" }
  ])
    assert.equal((await consume(env, production, body)).acknowledgments, 1);
  assert.equal(await row(db), null);
  assert.deepEqual(calls, []);
});

test("legacy unprocessed event: direct-send exclusion is durably adopted", async t => {
  const { db, env, calls } = await setup(t);
  await register(db);
  await production.notifier.notificarNovoPedidoPago(db, { DB: db }, 1, { excludeUsuarioId: 1 });
  await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
  await production.worker.scheduled({}, env);
  assert.equal((await row(db)).exclude_usuario_id, 1);
  assert.deepEqual(calls, []);
});

test("outbox: missing queue retains a recoverable event and NULL exclusion", async t => {
  const { db, env } = await setup(t);
  await production.outbox.enfileirarNovoPedidoPagoSafe(db, env, 1);
  assert.deepEqual(await row(db), {
    status: "PENDENTE",
    tentativas: 0,
    claim_token: null,
    exclude_usuario_id: null
  });
});

test("consumer: database outage before claim requests Queue retry", async t => {
  const { db, env, calls } = await setup(t);
  await register(db);
  const before = await row(db);
  db.hook = () => {
    throw new Error("database unavailable");
  };
  const message = await consume(env);
  db.hook = null;
  assert.equal(message.retries, 1);
  assert.equal(message.acknowledgments, 0);
  assert.deepEqual(await row(db), before);
  assert.deepEqual(calls, []);
});

test("migration 0036: legacy event and financial records remain intact", async t => {
  const { db } = await setup(t);
  await register(db);
  // Disposable D1 only: recreate the pre-0036 schema, then apply the real migration.
  await db.prepare("ALTER TABLE push_eventos DROP COLUMN exclude_usuario_id").run();
  const before = await db.prepare("SELECT * FROM push_eventos").first();
  const financialBefore = (await db.prepare("SELECT * FROM pedido_pagamentos ORDER BY id").all())
    .results;
  await db.prepare(await readFile("migrations/0036_push_event_exclusion.sql", "utf8")).run();
  assert.deepEqual(await db.prepare("SELECT * FROM push_eventos").first(), {
    ...before,
    exclude_usuario_id: null
  });
  assert.deepEqual(
    (await db.prepare("SELECT * FROM pedido_pagamentos ORDER BY id").all()).results,
    financialBefore
  );
});

test("outbox: D1 registration failure cannot publish or fail the caller", async t => {
  const { db, env } = await setup(t);
  let publications = 0;
  env.PUSH_QUEUE = {
    async send() {
      publications++;
    }
  };
  db.hook = statements => {
    if (statements[0].sql.includes("INSERT INTO push_eventos")) throw new Error("unavailable");
  };
  await production.outbox.enfileirarNovoPedidoPagoSafe(db, env, 1);
  db.hook = null;
  assert.equal(publications, 0);
  assert.equal(await row(db), null);
});

test("consumer: remote acceptance followed by success-write failure remains at-least-once", async t => {
  const { db, env, calls } = await setup(t);
  await register(db);
  db.hook = statements => {
    if (
      statements[0].sql.includes("SET status = ?, tentativas") &&
      statements[0].args[0] === "ENVIADO"
    )
      throw new Error("success write unavailable");
  };
  const message = await consume(env);
  db.hook = null;
  assert.equal(message.acknowledgments, 1, "persisted FALHA belongs to D1 retry");
  assert.equal((await row(db)).status, "FALHA");
  assert.equal(calls.length, 1, "remote acceptance cannot be inferred away");
  await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
  await production.worker.scheduled({}, env);
  assert.equal(calls.length, 2, "ambiguous acceptance can cause redelivery");
  assert.equal((await row(db)).status, "ENVIADO");
});

for (const mutation of [
  {
    name: "drop persisted exclusion",
    file: /pushNotifier\.ts$/,
    from: "evento?.exclude_usuario_id ?? undefined",
    to: "undefined",
    contract: exclusionContract
  },
  {
    name: "remove ownership fencing",
    file: /pushNotifier\.ts$/,
    from: "AND claim_token = ? AND datetime(claim_expires_at) > datetime('now')",
    to: "AND ? IS NOT NULL AND datetime(claim_expires_at) > datetime('now')",
    count: 2,
    contract: fencingContract
  },
  {
    name: "steal active claim",
    file: /pushNotifier\.ts$/,
    from: "AND datetime(claim_expires_at) <= datetime('now'))\n)`",
    to: "AND datetime(claim_expires_at) <= datetime('now'))\n OR (status = 'PENDENTE' AND claim_token IS NOT NULL)\n)`",
    contract: concurrencyContract
  },
  {
    name: "reset sent event on replay",
    file: /pushOutbox\.ts$/,
    from: "ON CONFLICT(pedido_id, evento) DO NOTHING",
    count: 2,
    to: "ON CONFLICT(pedido_id, evento) DO UPDATE SET status='PENDENTE',claim_expires_at=CURRENT_TIMESTAMP",
    contract: async (t, module) => {
      const { db, env, calls } = await setup(t);
      await register(db, module);
      await consume(env, module);
      await register(db, module);
      await consume(env, module);
      assert.equal(calls.length, 1);
    }
  }
]) {
  test(`negative control: ${mutation.name}`, async t => {
    const mutant = await compile(entries, mutation);
    await assert.rejects(() => mutation.contract(t, mutant), { name: "AssertionError" });
  });
}

for (const mutation of [
  {
    name: "remove atomic Pix intent",
    file: /ledgerSync\.ts$/,
    from: '"push_pedido_pago = 1,"',
    to: '"push_pedido_pago = 0,"',
    contract: (t, module) => missingOutboxContract(t, module)
  },
  {
    name: "remove manual recovery snapshot",
    file: /manualCreation\.ts$/,
    from: "?, CASE WHEN ? THEN ? ELSE NULL END",
    to: "?, CASE WHEN ? THEN NULL ELSE ? END",
    contract: (t, module) => missingOutboxContract(t, module, true)
  },
  {
    name: "infer intent from every PAGO",
    file: /pushOutbox\.ts$/,
    from: "pp.push_pedido_pago = 1 AND pp.status = 'PAGO'",
    to: "pp.status = 'PAGO'",
    contract: noSpuriousIntentContract
  },
  {
    name: "remove recovery batch limit",
    file: /pushOutbox\.ts$/,
    from: "ORDER BY pp.id ASC LIMIT 5",
    to: "ORDER BY pp.id ASC LIMIT 6",
    contract: boundedRecoveryContract
  }
]) {
  test(`negative control: ${mutation.name}`, async t => {
    await assert.rejects(
      () => compile(entries, mutation).then(module => mutation.contract(t, module)),
      { name: "AssertionError" }
    );
  });
}
