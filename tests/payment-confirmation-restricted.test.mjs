import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state, barrier } from "./helpers/b3.mjs";
import { mpResponse, orderFixture } from "./helpers/mp-orders.mjs";

const options = { confirmationOnly: true };
const remote = extra => ({
  id: 101,
  status: "approved",
  transaction_amount: 100,
  payment_method_id: "pix",
  external_reference: "token",
  currency_id: "BRL",
  ...extra
});
async function checkout(db, key = "restricted-checkout", pay = "PAY101", reference = "token") {
  await db
    .prepare(
      `INSERT INTO pedido_operacoes
    (operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,mp_request,mp_payment_id)
    VALUES (?, 'CHECKOUT_SITE','SITE',1,'synthetic','CONCLUIDA',1,1,?,?)`
    )
    .bind(key, JSON.stringify({ external_reference: reference }), pay)
    .run();
}
async function verified(t, extra = {}) {
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
    return mpResponse(remote(extra));
  });
  return app.sync.fetchMpPayment("synthetic", "ORD101");
}
const confirm = (db, mp) => app.sync.syncPaymentFromMp(db, 1, mp, undefined, options);

for (const restricted of [true, false]) {
  test(`${restricted ? "restricted" : "normal"} confirmation: concurrent inconclusive refunded snapshot before CAS is never overwritten`, async t => {
    const db = await fixture(t);
    await checkout(db);
    const approved = await verified(t);
    const refunded = await verified(t, {
      status: "refunded",
      external_reference: "divergent-refund"
    });
    let raced = false;
    db.hook = async wire => {
      if (!raced && wire.some(s => /SET status = \?/.test(s.sql) && s.args[0] === "PAGO")) {
        raced = true;
        db.hook = null;
        await app.sync.syncPaymentFromMp(db, 1, refunded);
        const between = await state(db);
        assert.equal(between.pagamentos[0].status, "PENDENTE");
        assert.equal(between.pagamentos[0].mp_status, "refunded");
      }
    };
    const result = restricted
      ? await confirm(db, approved)
      : await app.sync.syncPaymentFromMp(db, 1, approved);
    assert.equal(raced, true);
    if (restricted) assert.equal(result.ok, false);
    assert.equal(result.transicionou, false);
    const after = await state(db);
    assert.equal(after.pagamentos[0].status, "PENDENTE");
    assert.equal(after.pagamentos[0].mp_status, "refunded");
    assert.equal(after.itens[0].estoque_estado, "RESERVADO");
    assert.equal(after.produtos[0].estoque, 10);
  });
}

for (const paid of [false, true]) {
  test(`restricted confirmation: refunded marker before physical batch with ${paid ? "PAGO replay" : "new PAGO"} blocks stock conversion`, async t => {
    const db = await fixture(t, { paid });
    await checkout(db);
    const mp = await verified(t);
    let raced = false;
    db.hook = async (wire, operation) => {
      if (
        !raced &&
        operation === "batch" &&
        wire.some(s => /UPDATE produtos/.test(s.sql) && /estoque = estoque -/.test(s.sql))
      ) {
        raced = true;
        db.hook = null;
        await db.prepare("UPDATE pedido_pagamentos SET mp_status='refunded'").run();
      }
    };
    const result = await confirm(db, mp);
    assert.equal(raced, true);
    assert.equal(result.ok, false);
    assert.equal(result.finalizacaoPendente, true);
    const after = await state(db);
    assert.equal(after.pagamentos[0].status, "PAGO");
    assert.equal(after.pagamentos[0].mp_status, "refunded");
    assert.equal(after.itens[0].estoque_estado, "RESERVADO");
    assert.equal(after.produtos[0].estoque, 10);
  });
}
async function observeRefusal(db, action) {
  const before = await state(db);
  const writes = [];
  db.hook = wire => {
    writes.push(...wire.filter(s => /^\s*(UPDATE|INSERT|DELETE)/i.test(s.sql)));
  };
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof Error);
  }
  db.hook = null;
  assert.deepEqual(
    await state(db),
    before,
    "refusal must preserve every financial and physical row"
  );
  assert.equal(writes.length, 0, "restricted refusal must not write diagnostics or projections");
}

for (const status of ["pending", "cancelled", "expired", "refunded"]) {
  test(`restricted confirmation: ${status} snapshot performs no write or finalization`, async t => {
    const db = await fixture(t);
    await checkout(db);
    const mp = await verified(t, { status });
    await observeRefusal(db, () => confirm(db, mp));
  });
}

for (const paid of [false, true]) {
  test(`restricted confirmation: divergent amount is inert with local ${paid ? "PAGO" : "PENDENTE"}`, async t => {
    const db = await fixture(t, { paid });
    await checkout(db);
    const mp = await verified(t, { transaction_amount: 0.01 });
    await observeRefusal(db, () => confirm(db, mp));
  });
}

for (const [label, mutate, snapshot] of [
  [
    "PAY mismatch",
    db => db.prepare("UPDATE pedido_operacoes SET mp_payment_id='PAYdifferent'").run(),
    {}
  ],
  [
    "order mismatch",
    db => db.prepare("UPDATE pedido_pagamentos SET mp_order_id='ORDdifferent'").run(),
    {}
  ],
  ["missing checkout", db => db.prepare("DELETE FROM pedido_operacoes").run(), {}],
  ["ambiguous checkout", db => checkout(db, "other-checkout"), {}],
  ["admin scope", db => db.prepare("UPDATE pedido_operacoes SET escopo='ADMIN'").run(), {}],
  ["refused checkout", db => db.prepare("UPDATE pedido_operacoes SET fase='RECUSADA'").run(), {}],
  ["admin origin", db => db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN'").run(), {}],
  [
    "operation reference mismatch",
    db => db.prepare("UPDATE pedido_operacoes SET mp_request='{}'").run(),
    {}
  ],
  ["remote reference mismatch", async () => {}, { external_reference: "different" }],
  ["remote method mismatch", async () => {}, { payment_method_id: "credit_card" }],
  ["remote country mismatch", async () => {}, { currency_id: "USD" }]
]) {
  test(`restricted confirmation: ${label} refuses without mutation`, async t => {
    const db = await fixture(t);
    await checkout(db);
    await mutate(db);
    const mp = await verified(t, snapshot);
    await observeRefusal(db, () => confirm(db, mp));
  });
}

test("shared approval: persisted checkout PAY mismatch blocks confirmation", async t => {
  const db = await fixture(t);
  await checkout(db, "restricted-checkout", "PAYdifferent");
  await app.sync.syncPaymentFromMp(db, 1, await verified(t));
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PENDENTE");
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
  assert.equal(after.produtos[0].estoque, 10);
});

test("shared approval: divergent PAGO replay never finalizes stock", async t => {
  const db = await fixture(t, { paid: true });
  await checkout(db);
  await app.sync.syncPaymentFromMp(db, 1, await verified(t, { transaction_amount: 0.01 }));
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
  assert.equal(after.produtos[0].estoque, 10);
  assert.equal(after.produtos[0].estoque_reservado, 2);
});

test("restricted confirmation: previously cancelled payment is inert", async t => {
  const db = await fixture(t);
  await checkout(db);
  await db.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=1").run();
  const mp = await verified(t);
  await observeRefusal(db, () => confirm(db, mp));
});

test("restricted confirmation: operation reference changed before CAS blocks financial and physical effects", async t => {
  const db = await fixture(t);
  await checkout(db);
  const mp = await verified(t);
  let raced = false;
  db.hook = async wire => {
    if (!raced && wire.some(s => /SET status = \?/.test(s.sql) && s.args[0] === "PAGO")) {
      raced = true;
      db.hook = null;
      await db
        .prepare(
          "UPDATE pedido_operacoes SET mp_request=? WHERE operation_key='restricted-checkout'"
        )
        .bind(JSON.stringify({ external_reference: "changed-after-validation" }))
        .run();
    }
  };
  await confirm(db, mp);
  assert.equal(raced, true, "must reach the guarded financial write");
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PENDENTE");
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
  assert.equal(after.produtos[0].estoque_reservado, 2);
  assert.equal(after.produtos[0].estoque, 10);
});

for (const restricted of [true, false]) {
  test(`${restricted ? "restricted" : "normal"} approved caller losing CAS to partial cancellation never retries terminal reserve release`, async t => {
    t.mock.method(console, "error", () => {});
    const db = await fixture(t);
    await checkout(db);
    const approved = await verified(t);
    const cancelled = await verified(t, { status: "cancelled" });
    let raced = false;
    db.hook = async wire => {
      if (!raced && wire.some(s => /SET status = \?/.test(s.sql) && s.args[0] === "PAGO")) {
        raced = true;
        db.hook = statements => {
          if (statements.some(s => /estoque_reservado = estoque_reservado - \?/.test(s.sql))) {
            db.hook = null;
            throw new Error("synthetic release failure");
          }
        };
        await assert.rejects(
          app.sync.syncPaymentFromMp(db, 1, cancelled),
          /ERRO_TRANSACIONAL_LIBERACAO/
        );
        assert.equal((await state(db)).itens[0].estoque_estado, "RESERVADO");
      }
    };
    const result = restricted
      ? await confirm(db, approved)
      : await app.sync.syncPaymentFromMp(db, 1, approved);
    assert.equal(raced, true);
    assert.equal(result.transicionou, false);
    const after = await state(db);
    assert.equal(after.pagamentos[0].status, "CANCELADO");
    assert.equal(after.itens[0].estoque_estado, "RESERVADO");
    assert.equal(after.produtos[0].estoque_reservado, 2);
    assert.equal(after.produtos[0].estoque, 10);
  });
}

test("restricted confirmation: changed reference between ledger and operation reads is refused", async t => {
  const db = await fixture(t);
  await checkout(db);
  const mp = await verified(t);
  let raced = false;
  db.hook = async wire => {
    if (
      !raced &&
      wire.some(
        s =>
          /SELECT/.test(s.sql) && /FROM pedido_operacoes/.test(s.sql) && /json_extract/.test(s.sql)
      )
    ) {
      raced = true;
      db.hook = null;
      await db
        .prepare("UPDATE pedido_operacoes SET mp_request=?")
        .bind(JSON.stringify({ external_reference: "after-ledger-read" }))
        .run();
    }
  };
  const result = await confirm(db, mp);
  assert.equal(raced, true);
  assert.equal(result.ok, false);
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PENDENTE");
  assert.equal(after.pagamentos[0].mp_status, null);
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
});

for (const paid of [false, true]) {
  for (const [label, mutate] of [
    [
      "reference",
      db =>
        db
          .prepare("UPDATE pedido_operacoes SET mp_request=?")
          .bind(JSON.stringify({ external_reference: "changed" }))
          .run()
    ],
    ["token", db => db.prepare("UPDATE pedidos SET token_publico='changed'").run()],
    ["amount", db => db.prepare("UPDATE pedido_pagamentos SET valor_centavos=9999").run()],
    ["PAY", db => db.prepare("UPDATE pedido_pagamentos SET mp_payment_id='PAYchanged'").run()]
  ]) {
    test(`restricted confirmation: ${label} raced before physical batch with ${paid ? "PAGO replay" : "new PAGO"} prevents stock deduction`, async t => {
      const db = await fixture(t, { paid });
      await checkout(db);
      const mp = await verified(t);
      let raced = false;
      db.hook = async (wire, operation) => {
        if (
          !raced &&
          operation === "batch" &&
          wire.some(s => /UPDATE produtos/.test(s.sql) && /estoque = estoque -/.test(s.sql))
        ) {
          raced = true;
          db.hook = null;
          assert.equal((await state(db)).pagamentos[0].status, "PAGO");
          await mutate(db);
        }
      };
      const result = await confirm(db, mp);
      assert.equal(raced, true);
      assert.equal(result.finalizacaoPendente, true);
      const after = await state(db);
      assert.equal(after.pagamentos[0].status, "PAGO");
      assert.equal(after.itens[0].estoque_estado, "RESERVADO");
      assert.equal(after.produtos[0].estoque, 10);
      assert.equal(after.produtos[0].estoque_reservado, 2);
    });
  }
}

test("restricted confirmation: failed physical transaction preserves PAGO and replay completes once", async t => {
  t.mock.method(console, "error", () => {});
  const db = await fixture(t);
  await checkout(db);
  const mp = await verified(t);
  let failed = false;
  db.hook = (wire, operation) => {
    if (
      !failed &&
      operation === "batch" &&
      wire.some(s => /UPDATE produtos/.test(s.sql) && /estoque = estoque -/.test(s.sql))
    ) {
      failed = true;
      db.hook = null;
      // Fail the last real D1 statement, after stock statements have run;
      // the batch must roll every physical update back atomically.
      return [
        ...wire,
        {
          sql: "INSERT INTO produtos(id,nome,categoria,preco_centavos) VALUES(1,'synthetic','BOLO',1)",
          args: []
        }
      ];
    }
  };
  const result = await confirm(db, mp);
  assert.equal(failed, true);
  assert.equal(result.status, "PAGO");
  assert.equal(result.finalizacaoPendente, true);
  let after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.itens[0].estoque_estado, "RESERVADO");
  assert.equal(after.produtos[0].estoque, 10);
  assert.equal((await confirm(db, mp)).finalizacaoPendente, false);
  await confirm(db, mp);
  after = await state(db);
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.itens[0].estoque_estado, "BAIXADO");
});

test("restricted confirmation: released reserve and insufficient stock stays pending until replay", async t => {
  t.mock.method(console, "error", () => {});
  const db = await fixture(t, { reserve: "LIBERADA" });
  await checkout(db);
  await db.prepare("UPDATE produtos SET estoque=1").run();
  const mp = await verified(t);
  const result = await confirm(db, mp);
  assert.equal(result.status, "PAGO");
  assert.equal(result.finalizacaoPendente, true);
  let after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.itens[0].estoque_estado, "LIBERADO");
  assert.equal(after.produtos[0].estoque, 1);
  await db.prepare("UPDATE produtos SET estoque=10").run();
  assert.equal((await confirm(db, mp)).finalizacaoPendente, false);
  await confirm(db, mp);
  after = await state(db);
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.produtos[0].estoque_reservado, 0);
});

test("restricted confirmation: elapsed reserve timestamp still permits approval conversion", async t => {
  const db = await fixture(t);
  await checkout(db);
  await db
    .prepare(
      "UPDATE pedidos SET reserva_expira_em='2020-01-01T00:00:00Z', pix_expira_em='2020-01-01T00:00:00Z'"
    )
    .run();
  const result = await confirm(db, await verified(t));
  assert.equal(result.finalizacaoPendente, false);
  const after = await state(db);
  assert.equal(after.itens[0].estoque_estado, "BAIXADO");
  assert.equal(after.produtos[0].estoque, 8);
});

test("restricted confirmation: supplied notification environment never creates push intent", async t => {
  const db = await fixture(t);
  await checkout(db);
  let sends = 0;
  const env = {
    DB: db,
    PUSH_QUEUE: {
      send: async () => {
        sends++;
      }
    }
  };
  const result = await app.sync.syncPaymentFromMp(db, 1, await verified(t), env, options);
  assert.equal(result.status, "PAGO");
  assert.equal((await state(db)).pagamentos[0].push_pedido_pago, 0);
  assert.equal(sends, 0);
});

for (const [label, mutate] of [
  [
    "missing country",
    order => {
      delete order.country_code;
    }
  ],
  [
    "divergent transaction paid amount",
    order => {
      order.transactions.payments[0].paid_amount = "0.01";
    }
  ],
  [
    "divergent order paid amount",
    order => {
      order.paid_amount = "0.01";
    }
  ],
  [
    "partially refunded",
    order => {
      order.status_detail = "partially_refunded";
      order.transactions.payments[0].status_detail = "partially_refunded";
    }
  ]
]) {
  test(`restricted confirmation: ${label} refuses without writes`, async t => {
    const db = await fixture(t);
    await checkout(db);
    const order = orderFixture(remote({}));
    mutate(order);
    t.mock.method(globalThis, "fetch", async () => mpResponse(order));
    const mp = await app.sync.fetchMpPayment("synthetic", "ORD101");
    await observeRefusal(db, () => confirm(db, mp));
  });
}

test("restricted confirmation: concurrent valid approvals and replay deduct stock exactly once", async t => {
  const db = await fixture(t);
  await checkout(db);
  const mp = await verified(t);
  const meet = barrier(2);
  let contenders = 0;
  db.hook = async wire => {
    if (wire.some(s => /SET status = \?/.test(s.sql) && s.args[0] === "PAGO") && contenders++ < 2)
      await meet();
  };
  const results = await Promise.all([confirm(db, mp), confirm(db, mp)]);
  db.hook = null;
  assert.equal(results.filter(r => r.transicionou).length, 1);
  await confirm(db, mp);
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.itens[0].estoque_estado, "BAIXADO");
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.produtos[0].estoque_reservado, 0);
});
