import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";
import { orderFixture } from "./helpers/mp-orders.mjs";

const origin = "https://staging.rpdoces.com.br";
async function setup(t, { paid = false, reserve = "ATIVA" } = {}) {
  const db = await fixture(t, { paid, reserve });
  await db
    .prepare(
      `INSERT INTO pedido_operacoes
    (operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,mp_request,mp_payment_id)
    VALUES ('recovery-checkout','CHECKOUT_SITE','SITE',1,'synthetic','CONCLUIDA',1,1,?, 'PAY101')`
    )
    .bind(JSON.stringify({ external_reference: "token" }))
    .run();
  const session = await app.auth.createSession(db, 1);
  const env = {
    DB: db,
    APP_ENV: "staging",
    MP_TEST_MODE: "orders_pix",
    MP_ACCESS_TOKEN: "synthetic"
  };
  const request = (options = {}) =>
    new Request(`${options.origin ?? origin}/api/admin/pedidos/1/pix/recuperar`, {
      method: options.method ?? "POST",
      headers: {
        Cookie: session.cookie.split(";")[0],
        Origin: origin,
        "Content-Type": "application/json",
        ...options.headers
      },
      ...(options.method === "GET"
        ? {}
        : { body: options.body ?? JSON.stringify({ pagamentoId: 1 }) })
    });
  const call = (options = {}) =>
    app.adminPixRecovery.onRequest({
      env: { ...env, ...options.env },
      request: request(options),
      params: { id: options.id ?? "1" }
    });
  return { db, env, request, call };
}

async function noEffects(db, action) {
  const before = await state(db);
  const writes = [];
  db.hook = wire => {
    writes.push(...wire.filter(s => /^\s*(UPDATE|INSERT|DELETE)/i.test(s.sql)));
  };
  const response = await action();
  db.hook = null;
  assert.deepEqual(await state(db), before);
  assert.equal(writes.length, 0);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response;
}

for (const [label, options, status, change] of [
  ["production", { env: { APP_ENV: "production" } }, 403],
  ["missing environment", { env: { APP_ENV: undefined } }, 403],
  ["missing test mode", { env: { MP_TEST_MODE: undefined } }, 403],
  ["production host", { origin: "https://rpdoces.com.br" }, 403],
  ["http host", { origin: "http://staging.rpdoces.com.br" }, 403],
  ["cross origin", { headers: { Origin: "https://evil.invalid" } }, 403],
  ["no origin or referer", { headers: { Origin: "" } }, 403],
  ["GET", { method: "GET" }, 405],
  ["anonymous", { headers: { Cookie: "" } }, 401],
  ["ADMIN", {}, 403, db => db.prepare("UPDATE usuarios_admin SET papel='ADMIN' WHERE id=1").run()],
  [
    "inactive owner",
    {},
    401,
    db => db.prepare("UPDATE usuarios_admin SET ativo=0 WHERE id=1").run()
  ],
  ["invalid order id", { id: "1x" }, 400],
  ["unsafe order id", { id: "9007199254740992" }, 400],
  ["malformed JSON", { body: "{" }, 400],
  ["extra field", { body: '{"pagamentoId":1,"orderId":"ORD23"}' }, 400],
  ["string payment id", { body: '{"pagamentoId":"1"}' }, 400],
  ["oversized input", { body: " ".repeat(300) }, 400],
  ["unknown payment", { body: '{"pagamentoId":999}' }, 404],
  ["payment in another order", { id: "2" }, 404],
  ["missing credential", { env: { MP_ACCESS_TOKEN: undefined } }, 503],
  [
    "non Pix ledger",
    {},
    409,
    db => db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run()
  ],
  [
    "legacy Payments id",
    {},
    409,
    db =>
      db
        .prepare("UPDATE pedido_pagamentos SET mp_order_id=NULL,mp_payment_id='12345' WHERE id=1")
        .run()
  ]
]) {
  test(`admin Pix recovery: ${label} refuses before MP or writes`, async t => {
    const { db, call } = await setup(t);
    if (change) {
      await db
        .prepare(
          `INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
        VALUES(2,'Outro Owner','owner2','owner2@example.invalid','unused','OWNER')`
        )
        .run();
      await change(db);
    }
    let remoteCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      remoteCalls++;
      throw new Error("remote must not be called");
    });
    const response = await noEffects(db, () => call(options));
    assert.equal(response.status, status);
    assert.equal(remoteCalls, 0);
  });
}

for (const [label, provider, status] of [
  [
    "GET failure",
    async () => {
      throw new Error("private provider error");
    },
    502
  ],
  ["pending", async () => Response.json(orderFixture({ id: 101, status: "pending" })), 409],
  [
    "wrong PAY",
    async () => {
      const order = orderFixture({ id: 101, status: "approved" });
      order.transactions.payments[0].id = "PAYother";
      return Response.json(order);
    },
    409
  ],
  [
    "divergent amount",
    async () =>
      Response.json(orderFixture({ id: 101, status: "approved", transaction_amount: 0.01 })),
    409
  ],
  [
    "wrong returned ORD",
    async () => Response.json(orderFixture({ id: 999, status: "approved" })),
    502
  ],
  [
    "ambiguous PAY",
    async () => {
      const order = orderFixture({ id: 101, status: "approved" });
      order.transactions.payments.push({ ...order.transactions.payments[0], id: "PAYother" });
      return Response.json(order);
    },
    502
  ]
]) {
  test(`admin Pix recovery: ${label} is inert and sanitized`, async t => {
    const { db, call } = await setup(t);
    t.mock.method(console, "error", () => {});
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
      assert.equal(init.method ?? "GET", "GET");
      return provider();
    });
    const response = await noEffects(db, call);
    assert.equal(response.status, status);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private|token|qr|mercadopago|ORD101|PAY101/);
  });
}

test("admin Pix recovery: expired reserve confirms once without promotion, new ledger, push or operation mutation", async t => {
  const { db, call } = await setup(t);
  await db
    .prepare(
      "UPDATE pedidos SET reserva_expira_em='2000-01-01',pix_expira_em='2000-01-01' WHERE id=1"
    )
    .run();
  await db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run();
  const before = await state(db);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
    assert.equal(init.method ?? "GET", "GET");
    return Response.json(orderFixture({ id: 101, status: "approved" }));
  });
  const first = await call();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    ok: true,
    confirmacaoPersistida: true,
    transicionou: true,
    finalizacaoPendente: false
  });
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  const replay = await call();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {
    ok: true,
    confirmacaoPersistida: true,
    transicionou: false,
    finalizacaoPendente: false
  });
  const after = await state(db);
  assert.equal(calls, 2);
  assert.equal(after.pedido.status_pedido, before.pedido.status_pedido);
  assert.equal(after.pagamentos.length, 1);
  assert.equal(after.pagamentos[0].push_pedido_pago, 0);
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.produtos[0].estoque_reservado, 0);
  assert.deepEqual(after.operacoes, before.operacoes);
  assert.deepEqual(after.refunds, before.refunds);
  assert.deepEqual(after.alocacoes, before.alocacoes);
});

test("admin Pix recovery: physical failure returns persisted confirmation with pending completion; retry repairs", async t => {
  const { db, call } = await setup(t, { reserve: "LIBERADA" });
  t.mock.method(console, "error", () => {});
  await db.prepare("UPDATE produtos SET estoque=1 WHERE id=1").run();
  const pending = await call();
  assert.equal(pending.status, 202);
  assert.deepEqual(await pending.json(), {
    ok: true,
    confirmacaoPersistida: true,
    transicionou: true,
    finalizacaoPendente: true
  });
  let after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.itens[0].estoque_estado, "LIBERADO");
  assert.equal(after.produtos[0].estoque, 1);
  await db.prepare("UPDATE produtos SET estoque=10 WHERE id=1").run();
  const repaired = await call();
  assert.equal(repaired.status, 200);
  after = await state(db);
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.itens[0].estoque_estado, "BAIXADO");
});

test("admin Pix recovery: a payment reparented during GET cannot confirm another order", async t => {
  const { db, call } = await setup(t);
  await db
    .prepare(
      `INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key)
    VALUES(2,'token2','Outra pessoa','000',10000,'pedido-2')`
    )
    .run();
  t.mock.method(globalThis, "fetch", async () => {
    await db.batch([
      db.prepare("UPDATE pedido_pagamentos SET pedido_id=2 WHERE id=1"),
      db
        .prepare("UPDATE pedido_operacoes SET pedido_id=2,mp_request=? WHERE pagamento_id=1")
        .bind(JSON.stringify({ external_reference: "token2" }))
    ]);
    return Response.json(
      orderFixture({ id: 101, status: "approved", external_reference: "token2" })
    );
  });
  const response = await call();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).confirmacaoPersistida, false);
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PENDENTE");
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
  assert.equal(after.produtos[0].estoque, 10);
  assert.equal(after.produtos[0].estoque_reservado, 2);
});
