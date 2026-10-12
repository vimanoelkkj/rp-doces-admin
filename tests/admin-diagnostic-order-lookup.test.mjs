import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app, fixture, state } from "./helpers/b3.mjs";

const ORD = "ORDsandbox23";
const PAY = "PAYremote24";
const origin = "https://staging.rpdoces.com.br";
const wireOrder = () => ({
  id: ORD,
  status: "processed",
  status_detail: "accredited",
  external_reference: "sensitive-public-order-token",
  total_amount: "50.00",
  paid_amount: "50.00",
  payer: { email: "private@example.invalid" },
  secret: "never-expose",
  transactions: {
    payments: [
      {
        id: PAY,
        status: "processed",
        status_detail: "accredited",
        amount: "50.00",
        paid_amount: "50.00",
        payment_method: { qr_code: "private-qr" }
      }
    ]
  }
});

async function setup(t, { method = "PIX_MP", role = "OWNER" } = {}) {
  let db;
  let before;
  const attempts = [];
  // Register before fixture disposal: Node executes after hooks in registration order.
  t.after(async () => {
    if (!db || !before) return;
    db.hook = null;
    for (const { wire, operation } of attempts) {
      assert.equal(operation, "first", "No attempted write, even if an exception is caught");
      for (const statement of wire) assert.match(statement.sql.trim(), /^SELECT\s/i);
    }
    assert.deepEqual(
      await state(db),
      before,
      "No payment, stock, reservation, allocation, refund or A1 effect"
    );
  });
  db = await fixture(t, { paid: false });
  await db
    .prepare("UPDATE pedido_pagamentos SET mp_order_id = ?, metodo = ? WHERE id = 1")
    .bind(ORD, method)
    .run();
  if (role === "ADMIN") {
    await db
      .prepare(
        "INSERT INTO usuarios_admin (id, nome, username, email, senha_hash, papel) VALUES (2, 'Admin', 'admin', 'admin@example.invalid', 'unused', 'ADMIN')"
      )
      .run();
  }
  const owner = await app.auth.createSession(db, role === "ADMIN" ? 2 : 1);
  const env = {
    DB: db,
    MP_ACCESS_TOKEN: "synthetic-token",
    APP_ENV: "staging",
    MP_TEST_MODE: "orders_pix"
  };
  const request = (id = ORD, host = origin, session = owner) =>
    new Request(`${host}/api/admin/diagnosticos/pix-status?mpPaymentId=${encodeURIComponent(id)}`, {
      headers: session ? { Cookie: session.cookie.split(";")[0] } : {}
    });
  before = await state(db);
  const statements = [];
  db.hook = (wire, operation) => {
    attempts.push({ wire, operation });
    assert.equal(operation, "first", "Only SELECT first() is permitted");
    for (const statement of wire) {
      assert.match(statement.sql.trim(), /^SELECT\s/i);
      statements.push(statement);
    }
  };
  const run = (req = request(), settings = env) =>
    app.diagnosticoPixStatus.onRequestGet({ request: req, env: settings });
  return { db, env, request, run, statements };
}

function provider(t, response = () => Response.json(wireOrder())) {
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `https://api.mercadopago.com/v1/orders/${ORD}`);
    assert.equal(options.method ?? "GET", "GET");
    return response();
  });
}

test("ORD-only: linked staging order returns a sanitized, uncached remote snapshot", async t => {
  const { run, statements } = await setup(t);
  const remote = provider(t);
  const response = await run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    order: {
      id: ORD,
      status: "processed",
      status_detail: "accredited",
      external_reference: {
        sha256: createHash("sha256").update("sensitive-public-order-token").digest("hex")
      },
      total_amount: "50.00",
      paid_amount: "50.00"
    },
    payment: {
      id: PAY,
      status: "processed",
      status_detail: "accredited",
      amount: "50.00",
      paid_amount: "50.00"
    }
  });
  assert.equal(remote.mock.callCount(), 1);
  assert.deepEqual(statements.at(-1).args, [ORD]);
});

for (const [label, change, host] of [
  ["undefined environment", { APP_ENV: undefined }],
  ["production", { APP_ENV: "production" }],
  ["wrong test mode", { MP_TEST_MODE: "other" }],
  ["missing test mode", { MP_TEST_MODE: undefined }],
  ["HTTP", {}, "http://staging.rpdoces.com.br"],
  ["production hostname", {}, "https://rpdoces.com.br"],
  ["Pages hostname", {}, "https://rp-doces-staging.pages.dev"],
  ["suffix hostname", {}, "https://staging.rpdoces.com.br.example.invalid"],
  ["nondefault port", {}, "https://staging.rpdoces.com.br:444"]
]) {
  test(`ORD-only denies ${label} before provider or local order lookup`, async t => {
    const { env, request, run, statements } = await setup(t);
    const remote = provider(t);
    const response = await run(request(ORD, host), { ...env, ...change });
    assert.equal(response.status, 403);
    assert.equal(remote.mock.callCount(), 0);
    assert.equal(statements.length, 1); // Session SELECT only.
  });
}

for (const [label, id, expected] of [
  ["invalid", "ORD../23", 400],
  ["unlinked", "ORDunknown", 404]
]) {
  test(`ORD-only: ${label} identifier is rejected without provider access`, async t => {
    const { request, run } = await setup(t);
    const remote = provider(t);
    assert.equal((await run(request(id))).status, expected);
    assert.equal(remote.mock.callCount(), 0);
  });
}

for (const role of ["anonymous", "ADMIN"]) {
  test(`ORD-only rejects ${role}`, async t => {
    const { request, run } = await setup(t, { role: role === "ADMIN" ? "ADMIN" : "OWNER" });
    const remote = provider(t);
    assert.equal(
      (await run(request(ORD, origin, role === "anonymous" ? null : undefined))).status,
      role === "anonymous" ? 401 : 403
    );
    assert.equal(remote.mock.callCount(), 0);
  });
}

for (const [label, response] of [
  ["404", () => Response.json({ secret: "never-expose" }, { status: 404 })],
  ["403", () => Response.json({ secret: "never-expose" }, { status: 403 })],
  [
    "network failure",
    () => {
      throw new Error("credential-must-not-leak");
    }
  ],
  [
    "timeout",
    () => {
      throw new DOMException("credential-must-not-leak", "AbortError");
    }
  ],
  ["wrong order", () => Response.json({ ...wireOrder(), id: "ORDwrong" })],
  ["missing transaction", () => Response.json({ ...wireOrder(), transactions: { payments: [] } })],
  [
    "unexpected detail",
    () => Response.json({ ...wireOrder(), status_detail: { secret: "never-expose" } })
  ],
  ["invalid amount", () => Response.json({ ...wireOrder(), total_amount: "secret-value" })]
]) {
  test(`ORD-only sanitizes ${label} without retry or writes`, async t => {
    const { run } = await setup(t);
    const logs = t.mock.method(console, "error", () => {});
    const remote = provider(t, response);
    const result = await run();
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { code: "DIAGNOSTIC_ORDER_LOOKUP_FAILED" });
    assert.equal(remote.mock.callCount(), 1);
    assert.deepEqual(
      logs.mock.calls.map(call => call.arguments),
      [["DIAGNOSTIC_ORDER_LOOKUP_FAILED"]]
    );
    assert.equal(result.headers.get("Cache-Control"), "no-store");
  });
}

for (const matching of [true, false]) {
  test(`ORD:PAY preserves ${matching ? "legacy result" : "DIAGNOSTIC_PAYMENT_ID_MISMATCH"}`, async t => {
    const { run, request, env } = await setup(t);
    const logs = t.mock.method(console, "error", () => {});
    provider(t);
    const response = await run(request(`${ORD}:${matching ? PAY : "PAYwrong"}`), {
      ...env,
      APP_ENV: undefined
    });
    assert.equal(response.status, matching ? 200 : 502);
    if (matching) assert.deepEqual(await response.json(), { ok: true, status: "PAGO" });
    else {
      assert.equal((await response.json()).code, "MERCADO_PAGO_INDISPONIVEL");
      assert.equal(logs.mock.calls[0].arguments[1].message, "DIAGNOSTIC_PAYMENT_ID_MISMATCH");
    }
  });
}

test("ORD-only refuses an identity on a non-Pix local payment", async t => {
  const { run } = await setup(t, { method: "DINHEIRO" });
  const remote = provider(t);
  assert.equal((await run()).status, 404);
  assert.equal(remote.mock.callCount(), 0);
});

test("ORD-only refuses missing credential without a provider request", async t => {
  const { run, request, env } = await setup(t);
  const remote = provider(t);
  assert.equal((await run(request(), { ...env, MP_ACCESS_TOKEN: undefined })).status, 503);
  assert.equal(remote.mock.callCount(), 0);
});

test("ORD-only does not infer an absent root paid amount from the transaction", async t => {
  const { run } = await setup(t);
  provider(t, () => {
    const order = wireOrder();
    delete order.paid_amount;
    order.external_reference = null;
    return Response.json(order);
  });
  const response = await run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.order.paid_amount, null);
  assert.equal(body.order.external_reference, null);
  assert.equal(body.payment.paid_amount, "50.00");
});

test("ORD-only local lookup failure never reaches Mercado Pago or leaks an exception", async t => {
  const { db, run } = await setup(t);
  const original = db.hook;
  db.hook = (wire, operation) => {
    original(wire, operation);
    if (wire.some(s => s.sql.includes("pp.mp_order_id"))) throw new Error("private-database-error");
  };
  const remote = provider(t);
  const logs = t.mock.method(console, "error", () => {});
  const response = await run();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { code: "DIAGNOSTIC_ORDER_LOOKUP_FAILED" });
  assert.equal(remote.mock.callCount(), 0);
  assert.deepEqual(
    logs.mock.calls.map(call => call.arguments),
    [["DIAGNOSTIC_ORDER_LOOKUP_FAILED"]]
  );
});
