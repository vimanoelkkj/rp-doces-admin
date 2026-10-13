import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state, barrier } from "./helpers/b3.mjs";

// Independent fixture for the documented POST /v1/orders/{ORD}/refund response.
const refund = (extra = {}) => ({
  id: "REFfirst",
  transaction_id: "PAY101",
  reference_id: "provider-reference",
  amount: "100.00",
  status: "processed",
  ...extra
});
const direct = (refunds = [refund()]) => ({
  id: "ORD101",
  status: "processed",
  status_detail: "refunded",
  transactions: { refunds }
});

test("first direct HTTP 201 binds its sole REF; GET without that identity remains ambiguous", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(direct(), { status: 201 }));
  assert.deepEqual(
    await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "first-key", {
      amountCentavos: 10000,
      priorRefundIds: []
    }),
    {
      resultado: "SUCESSO",
      refund: { id: "REFfirst", payment_id: "PAY101", amount: "100.00", status: "approved" }
    }
  );
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD101", "PAY101", undefined, 10000, [])).resultado,
    "AMBIGUO"
  );
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD101", "PAY101", "REFfirst", 10000)).resultado,
    "SUCESSO"
  );
});

for (const [name, body, priorRefundIds] of [
  ["no REF", direct([])],
  ["no refund acknowledgement", { ...direct(), status_detail: undefined }],
  ["payment acknowledgement", { ...direct(), status_detail: "accredited" }],
  ["two equal REFs", direct([refund(), refund({ id: "REFother" })])],
  [
    "baseline must not select from history",
    direct([refund({ id: "REFold" }), refund()]),
    ["REFold"]
  ],
  [
    "second PAY must not be filtered away",
    direct([refund(), refund({ id: "REFother", transaction_id: "PAY202" })])
  ],
  ["duplicate REF", direct([refund(), refund()])],
  ["old sole REF", direct(), ["REFfirst"]],
  ["wrong ORD", { ...direct(), id: "ORD202" }],
  ["wrong PAY", direct([refund({ transaction_id: "PAY202" })])],
  ["wrong amount", direct([refund({ amount: "99.99" })])],
  ["invalid REF", direct([refund({ id: "not-a-ref" })])],
  ["blank status", direct([refund({ status: " " })])],
  ["missing amount", direct([refund({ amount: undefined })])],
  [
    "aggregate payments",
    {
      ...direct(),
      transactions: { ...direct().transactions, payments: [{ id: "PAY101" }, { id: "PAY202" }] }
    }
  ],
  ["null body", null]
]) {
  test(`direct 201 stays ambiguous: ${name}`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json(body, { status: 201 }));
    assert.deepEqual(
      await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "key", {
        amountCentavos: 10000,
        priorRefundIds
      }),
      { resultado: "AMBIGUO", motivo: "RESPOSTA_ILEGIVEL", httpStatus: 201 }
    );
  });
}

async function scenario(t, { secondPayment = false } = {}) {
  const db = await fixture(t, { paid: true, reserve: "CONVERTIDA" });
  if (secondPayment)
    await db
      .prepare(
        `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_order_id,mp_payment_id,idempotency_key,pago_em)
      VALUES(2,1,'PIX_MP','ADMIN',3000,'PAGO','ORD202','PAY202','second-payment',CURRENT_TIMESTAMP)`
      )
      .run();
  const session = await app.auth.createSession(db, 1);
  const post = () =>
    app.adminVoidEstorno.onRequestPost({
      env: { DB: db, MP_ACCESS_TOKEN: "fake" },
      params: { id: "1" },
      request: new Request("https://local.test/api/admin/pedidos/1/anulacao/estorno", {
        method: "POST",
        headers: {
          Origin: "https://local.test",
          "Content-Type": "application/json",
          Cookie: session.cookie.split(";")[0]
        },
        body: JSON.stringify({ operationKey: "orders-first-refund-key" })
      })
    });
  return { db, post };
}

function provider(t, respond) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const match = /^https:\/\/api\.mercadopago\.com\/v1\/orders\/(ORD101|ORD202)(\/refund)?$/.exec(
      String(url)
    );
    assert.ok(match, `unexpected external request: ${url}`);
    if (init?.method !== "POST") {
      assert.equal(match[2], undefined);
      return Response.json({ id: match[1], transactions: { refunds: [] } });
    }
    assert.equal(match[2], "/refund");
    calls.push({ order: match[1], key: init.headers["X-Idempotency-Key"], body: init.body });
    return respond(match[1], init, calls.length);
  });
  return calls;
}

test("real estorno route: 201 confirms exactly once; concurrent same-key replay preserves money and stock", async t => {
  const { db, post } = await scenario(t);
  const before = await state(db);
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (
      operation === "run" &&
      statements.some(
        s => s.sql.includes("SET status='PROCESSANDO'") && s.sql.includes("NOT EXISTS")
      )
    )
      await gate();
    return statements;
  };
  const calls = provider(t, () => Response.json(direct(), { status: 201 }));
  const responses = await Promise.all([post(), post()]);
  db.hook = null;
  assert.ok(responses.every(r => [200, 202].includes(r.status)));
  assert.equal((await post()).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), {
    transactions: [{ id: "PAY101", amount: "100.00" }]
  });
  const after = await state(db);
  assert.equal(after.refunds.length, 1);
  assert.equal(after.refunds[0].mp_refund_id, "REFfirst");
  assert.equal(after.refunds[0].valor_centavos, 10000);
  assert.equal(after.refunds[0].status, "REEMBOLSADO");
  assert.deepEqual(after.pagamentos, before.pagamentos);
  assert.deepEqual(after.produtos, before.produtos);
  assert.deepEqual(after.alocacoes, before.alocacoes);
  const intents = (
    await db
      .prepare("SELECT status,mp_refund_id,tentativas FROM pedido_reembolso_pix_mp_intencoes")
      .all()
  ).results;
  assert.deepEqual(intents, [{ status: "CONFIRMADO", mp_refund_id: "REFfirst", tentativas: 1 }]);
});

test("timeout after remote effect: same body/key retry can bind direct 201 without a second refund", async t => {
  const { db, post } = await scenario(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let effects = 0;
  const keys = new Set();
  const calls = provider(t, (_order, init, n) => {
    if (!keys.has(init.headers["X-Idempotency-Key"])) {
      keys.add(init.headers["X-Idempotency-Key"]);
      effects++;
    }
    if (n > 1) return Response.json(direct(), { status: 201 });
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      t.mock.timers.tick(20000);
    });
  });
  assert.equal((await post()).status, 202);
  assert.equal((await state(db)).refunds.length, 0);
  assert.match(
    (await db.prepare("SELECT ultimo_erro FROM pedido_reembolso_pix_mp_intencoes").first())
      .ultimo_erro,
    /TIMEOUT/
  );
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(effects, 1);
  assert.equal((await state(db)).refunds.length, 1);
});

test("pending direct REF is persisted; recovery selects that exact identity from general GET history", async t => {
  const { db, post } = await scenario(t);
  let posts = 0;
  let gets = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.mercadopago\.com\/v1\/orders\/ORD101(?:\/refund)?$/);
    if (init?.method === "POST") {
      posts++;
      return Response.json(direct([refund({ status: "pending" })]), { status: 201 });
    }
    gets++;
    return Response.json(direct(gets === 1 ? [] : [refund({ id: "REFunrelated" }), refund()]));
  });
  assert.equal((await post()).status, 202);
  assert.equal((await state(db)).refunds.length, 0);
  assert.equal(
    (await db.prepare("SELECT mp_refund_id FROM pedido_reembolso_pix_mp_intencoes").first())
      .mp_refund_id,
    "REFfirst"
  );
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.equal((await state(db)).refunds[0].mp_refund_id, "REFfirst");
});

test("same operation key with different financial identity conflicts after direct confirmation", async t => {
  const { db } = await scenario(t);
  const calls = provider(t, () => Response.json(direct(), { status: 201 }));
  const params = {
    pedidoId: 1,
    pagamentoId: 1,
    usuarioId: 1,
    operationKey: "direct-refund-identity",
    fingerprint: "original",
    valorCentavos: 10000,
    accessToken: "fake"
  };
  assert.equal(
    (await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params)).intencao.status,
    "CONFIRMADO"
  );
  const before = await state(db);
  const incompatible = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
    ...params,
    fingerprint: "changed",
    valorCentavos: 5000
  });
  assert.equal(incompatible.ok, false);
  assert.deepEqual(await state(db), before);
  assert.equal(calls.length, 1);
});

test("multiple local payments: only direct identity confirms its leg; ambiguous 201 reserves the other", async t => {
  const { db, post } = await scenario(t, { secondPayment: true });
  const calls = provider(t, order =>
    Response.json(
      order === "ORD101"
        ? direct()
        : {
            id: "ORD202",
            transactions: {
              refunds: [
                refund({ id: "REFsecond", transaction_id: "PAY202", amount: "30.00" }),
                refund({ id: "REFunrelated", transaction_id: "PAY101", amount: "100.00" })
              ]
            }
          },
      { status: 201 }
    )
  );
  assert.equal((await post()).status, 202);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].key, calls[1].key);
  const after = await state(db);
  assert.deepEqual(
    after.refunds.map(r => [r.pagamento_id, r.mp_refund_id, r.valor_centavos]),
    [[1, "REFfirst", 10000]]
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT pagamento_id,status,mp_refund_id FROM pedido_reembolso_pix_mp_intencoes ORDER BY pagamento_id"
        )
        .all()
    ).results,
    [
      { pagamento_id: 1, status: "CONFIRMADO", mp_refund_id: "REFfirst" },
      { pagamento_id: 2, status: "INCONCLUSIVO", mp_refund_id: null }
    ]
  );
});
