import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state, barrier } from "./helpers/b3.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const paidOrder = () => ({
  id: "ORD101",
  status: "processed",
  status_detail: "accredited",
  external_reference: "token",
  total_amount: "100.00",
  country_code: "BR",
  transactions: {
    payments: [
      {
        id: "PAY101",
        amount: "100.00",
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "pix", type: "bank_transfer" }
      }
    ]
  }
});
const refundOrder = refunds => ({ id: "ORD101", status: "processed", transactions: { refunds } });
const refundWire = id => ({ id, transaction_id: "PAY101", amount: "5.00", status: "processed" });

for (const [name, country, badAmount, expected] of [
  ["BR", "BR", false, "PAGO"],
  ["BRA", "BRA", false, "PAGO"],
  ["absent", undefined, false, "PAGO"],
  ["null", null, false, "PAGO"],
  ["US", "US", false, "PENDENTE"],
  ["BRA with different amount", "BRA", true, "PENDENTE"]
]) {
  test(`Orders country ${name}: ${expected}`, async t => {
    const db = await fixture(t);
    const order = paidOrder();
    order.country_code = country;
    if (badAmount) order.transactions.payments[0].amount = "99.00";
    t.mock.method(globalThis, "fetch", async () => Response.json(order));
    await app.sync.syncPaymentFromMp(db, 1, await app.orders.fetchMpOrder("fake", "ORD101"));
    const s = await state(db);
    assert.equal(s.pagamentos[0].status, expected);
    if (expected === "PENDENTE") {
      assert.equal(s.pedido.reserva_status, "ATIVA");
      assert.equal(
        s.pagamentos[0].mp_status_detail,
        badAmount ? "INTEGRIDADE_MP:VALOR_DIVERGENTE" : "INTEGRIDADE_MP:PAIS_DIVERGENTE"
      );
    }
  });
}

test("Pix test mode orders_pix preserves nominal order amount and expiration in general builder, while diagnostic uses simulator contract", async () => {
  const payer = { email: "real@example.invalid", first_name: "Real customer" };
  const normal = await app.orderTypes.createPixOrderBody(501, "reference", payer);
  const generalInTestMode = await app.orderTypes.createPixOrderBody(
    501,
    "reference",
    payer,
    "orders_pix"
  );
  // Normal preserves real data, custom amount and the duration-only expiration
  assert.deepEqual(normal.payer, payer);
  assert.equal(normal.total_amount, "5.01");
  assert.equal(normal.transactions.payments[0].amount, "5.01");
  assert.equal(normal.transactions.payments[0].expiration_time, "PT30M");
  assert.equal("date_of_expiration" in normal.transactions.payments[0], false);

  // General builder in orders_pix keeps nominal amount and expiration, only mapping payer
  assert.deepEqual(generalInTestMode.payer, {
    email: "test_user_br@testuser.com",
    first_name: "APRO"
  });
  assert.equal(generalInTestMode.total_amount, "5.01");
  assert.equal(generalInTestMode.transactions.payments[0].amount, "5.01");
  assert.equal(generalInTestMode.transactions.payments[0].expiration_time, "PT30M");
  assert.equal("date_of_expiration" in generalInTestMode.transactions.payments[0], false);

  // Diagnostic builder in normal mode: 1 cent, Diagnostico payer, standard expiration
  const diagNormal = await app.diagnosticId.createDiagnosticPixOrderBody("diag-ref");
  assert.deepEqual(diagNormal.payer, {
    email: "diagnostico@rpdoces.com.br",
    first_name: "Diagnostico"
  });
  assert.equal(diagNormal.total_amount, "0.01");
  assert.equal(diagNormal.transactions.payments[0].amount, "0.01");
  assert.equal(diagNormal.transactions.payments[0].expiration_time, "PT30M");
  assert.equal("date_of_expiration" in diagNormal.transactions.payments[0], false);

  // Diagnostic builder in orders_pix: official simulator contract (50.00, APRO and no expiration fields)
  const diagSimulated = await app.diagnosticId.createDiagnosticPixOrderBody(
    "diag-ref",
    "orders_pix"
  );
  assert.deepEqual(diagSimulated.payer, {
    email: "test_user_br@testuser.com",
    first_name: "APRO"
  });
  assert.equal(diagSimulated.total_amount, "50.00");
  assert.equal(diagSimulated.transactions.payments[0].amount, "50.00");
  assert.equal(diagSimulated.transactions.payments[0].expiration_time, undefined);
  assert.equal(diagSimulated.transactions.payments[0].date_of_expiration, undefined);

  for (const flag of [undefined, "", "sandbox", "ORDERS_PIX"])
    assert.deepEqual(app.orderTypes.ordersPixPayer(payer, flag), payer);
});

for (const flow of ["checkout", "admin", "diagnostic", "regeneration"])
  for (const testMode of [undefined, "orders_pix"]) {
    test(`${flow} creation forwards server Pix test mode ${testMode ?? "default"}`, async t => {
      const db = await fixture(t, {
        ledger: flow === "regeneration",
        paid: false,
        reserve: "SEM_RESERVA"
      });
      const env = { DB: db, MP_ACCESS_TOKEN: "fake", MP_TEST_MODE: testMode };
      let sent;
      t.mock.method(globalThis, "fetch", async (url, init) => {
        if (String(url).endsWith("/cancel")) {
          return Response.json({ id: "ORD101", status: "canceled" });
        }
        if (init?.method !== "POST") {
          return Response.json({
            id: "ORD101",
            status: "canceled",
            status_detail: "cancelled",
            total_amount: "100.00",
            country_code: "BR",
            transactions: {
              payments: [
                { id: "PAY101", status: "canceled", status_detail: "cancelled", amount: "100.00" }
              ]
            }
          });
        }
        sent = JSON.parse(init.body);
        const order = paidOrder();
        order.id = "ORD102";
        if (order.transactions?.payments?.[0]) {
          order.transactions.payments[0].id = "PAY102";
        }
        order.external_reference = sent.external_reference;
        order.total_amount = order.transactions.payments[0].amount = sent.total_amount;
        order.status = order.transactions.payments[0].status = "action_required";
        order.status_detail = order.transactions.payments[0].status_detail = "waiting_transfer";
        return Response.json(order);
      });
      if (flow === "checkout") {
        await db.prepare("DELETE FROM pedidos").run();
        const result = await app.checkout.onRequestPost({
          env,
          request: new Request("https://local.test/api/checkout", {
            method: "POST",
            headers: { Origin: "https://local.test" },
            body: JSON.stringify({
              items: [{ id: 1, quantity: 1 }],
              cliente: { nome: "Real customer", whatsapp: "11999999999" },
              operationKey: "audit-checkout-key"
            })
          })
        });
        assert.equal(result.status, 200);
      } else if (flow === "admin") {
        const result = await app.pix.createAdminPixCharge(env, {
          pedidoId: 1,
          usuarioId: 1,
          operationKey: "audit-admin-pix"
        });
        assert.equal(result.ok, true);
      } else if (flow === "regeneration") {
        await db
          .prepare("UPDATE pedido_pagamentos SET origem='ADMIN', status='PENDENTE' WHERE id=1")
          .run();
        const result = await app.pix.createAdminPixCharge(env, {
          pedidoId: 1,
          usuarioId: 1,
          substituiId: 1,
          valorCentavos: 10000,
          operationKey: "audit-regen-pix"
        });
        assert.equal(result.ok, true);
      } else {
        const session = await app.auth.createSession(db, 1);
        const result = await app.diagnosticoPix.onRequestPost({
          env,
          request: new Request("https://local.test/api/admin/diagnosticos/pix", {
            method: "POST",
            headers: { Cookie: session.cookie.split(";")[0], Origin: "https://local.test" },
            body: JSON.stringify({ operationKey: "audit-diagnostic-pix" })
          })
        });
        assert.equal(result.status, 201);
      }

      // Contrato de nomes do body Pix Orders (só caminhos, sem valores): nenhum campo a mais.
      assert.deepEqual(Object.keys(sent).sort(), [
        "external_reference",
        "payer",
        "processing_mode",
        "total_amount",
        "transactions",
        "type"
      ]);
      const paymentKeys = Object.keys(sent.transactions.payments[0]).sort();

      if (flow === "diagnostic") {
        if (testMode === "orders_pix") {
          assert.deepEqual(sent.payer, {
            email: "test_user_br@testuser.com",
            first_name: "APRO"
          });
          assert.equal(sent.total_amount, "50.00");
          assert.equal(sent.transactions.payments[0].amount, "50.00");
          assert.deepEqual(paymentKeys, ["amount", "payment_method"]);
        } else {
          assert.deepEqual(sent.payer, {
            email: "diagnostico@rpdoces.com.br",
            first_name: "Diagnostico"
          });
          assert.equal(sent.total_amount, "0.01");
          assert.equal(sent.transactions.payments[0].amount, "0.01");
          assert.equal(sent.transactions.payments[0].expiration_time, "PT30M");
          assert.deepEqual(paymentKeys, ["amount", "expiration_time", "payment_method"]);
        }
      } else {
        // Fluxos de domínio de negócio: checkout, admin e regeneração
        const expectedAmount = flow === "checkout" ? "50.00" : "100.00";
        assert.equal(sent.total_amount, expectedAmount);
        assert.equal(sent.transactions.payments[0].amount, expectedAmount);
        assert.equal(sent.transactions.payments[0].expiration_time, "PT30M");
        assert.deepEqual(paymentKeys, ["amount", "expiration_time", "payment_method"]);

        if (testMode === "orders_pix") {
          assert.deepEqual(sent.payer, {
            email: "test_user_br@testuser.com",
            first_name: "APRO"
          });
        } else {
          assert.notEqual(sent.payer.first_name, "APRO");
          assert.doesNotMatch(sent.payer.email, /testuser\.com/);
          assert.equal(sent.payer.first_name, flow === "checkout" ? "Real customer" : "Teste");
          assert.equal(
            sent.payer.email,
            flow === "checkout"
              ? "11999999999@checkout.rpdoces.com.br"
              : "000@checkout.rpdoces.com.br"
          );
        }
      }
    });
  }

async function refundScenario(t) {
  const db = await fixture(t, { paid: true });
  await db.batch([
    db.prepare(
      "UPDATE pedido_itens SET quantidade=1,valor_total_centavos=500,valor_unitario_centavos=500 WHERE id=1"
    ),
    db.prepare(
      "INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,estoque_estado) VALUES(2,1,1,'Second',1,500,500,'BAIXADO')"
    ),
    db.prepare("UPDATE pedido_pagamento_alocacoes SET valor_centavos=500 WHERE id=1"),
    db.prepare(
      "INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,1,2,500)"
    ),
    ...[1, 2].map(id =>
      db
        .prepare(
          `INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro) VALUES(?,1,?,'AGUARDANDO_REEMBOLSO',500,500,500,'NENHUMA','{}')`
        )
        .bind(id, id)
    )
  ]);
  const params = id => ({
    pedidoId: 1,
    pagamentoId: 1,
    pagamentoAlocacaoId: id,
    cancellationId: id,
    usuarioId: 1,
    operationKey: `audit-refund-${id}`,
    fingerprint: `1:refund-${id}`,
    valorCentavos: 500,
    accessToken: "fake"
  });
  return { db, params };
}

test("two distinct equal refunds materialize REFA and REFB on their own intents", async t => {
  const { db, params } = await refundScenario(t);
  const refunds = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST")
      refunds.push({
        id: refunds.length ? "REFB" : "REFA",
        transaction_id: "PAY101",
        amount: "5.00",
        status: "processed"
      });
    return Response.json({ id: "ORD101", status: "processed", transactions: { refunds } });
  });
  const a = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
  const b = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(2));
  assert.equal(a.intencao.status, "CONFIRMADO");
  assert.equal(a.intencao.mpRefundId, "REFA");
  assert.equal(b.intencao.status, "CONFIRMADO");
  assert.equal(b.intencao.mpRefundId, "REFB");
  assert.deepEqual(
    (await db.prepare("SELECT mp_refund_id FROM pedido_reembolsos ORDER BY id").all()).results,
    [{ mp_refund_id: "REFA" }, { mp_refund_id: "REFB" }]
  );
  for (const id of [1, 2]) {
    const replay = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(id));
    assert.equal(replay.intencao.mpRefundId, id === 1 ? "REFA" : "REFB");
  }
  assert.equal(refunds.length, 2);
});

test("known pending REFA recovery cannot capture a later equal REFB", async t => {
  const { db, params } = await refundScenario(t);
  const refunds = [];
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST")
      refunds.push({
        ...refundWire(++posts === 1 ? "REFA" : "REFB"),
        status: posts === 1 ? "pending" : "processed"
      });
    return Response.json(refundOrder(refunds));
  });
  const a = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
  assert.equal(a.intencao.status, "PROCESSANDO");
  const b = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(2));
  assert.equal(b.intencao.mpRefundId, "REFB");
  refunds[0].status = "processed";
  const recovered = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
  assert.equal(recovered.intencao.mpRefundId, "REFA");
  assert.equal(recovered.intencao.status, "CONFIRMADO");
  assert.equal(posts, 2);
  assert.deepEqual(
    (await db.prepare("SELECT mp_refund_id FROM pedido_reembolsos ORDER BY id").all()).results,
    [{ mp_refund_id: "REFB" }, { mp_refund_id: "REFA" }]
  );
});

test("incomplete baseline cannot authorize refund dispatch", async t => {
  const { db, params } = await refundScenario(t);
  let posts = 0;
  let snapshot;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json(snapshot);
  });
  for (const invalid of [
    { id: "ORD101" },
    { id: "ORD101", transactions: [] },
    { id: "ORD101", transactions: 1 },
    { id: "ORD101", transactions: {} },
    { id: "ORD101", transactions: { refunds: null } }
  ]) {
    snapshot = invalid;
    const result = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
    assert.equal(result.intencao.status, "INCONCLUSIVO");
    assert.equal(posts, 0);
  }
});

for (const enoughEvidence of [true, false])
  test(`lost response then same-key 409 reconciles only with evidence=${enoughEvidence}`, async t => {
    const { db, params } = await refundScenario(t);
    const refunds = [],
      keys = [];
    const timer = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
      timer(callback, delay === 20000 ? 1 : delay, ...args)
    );
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      if (init?.method !== "POST") return Response.json(refundOrder(refunds));
      keys.push(init.headers["X-Idempotency-Key"]);
      if (keys.length === 1) {
        if (enoughEvidence) refunds.push(refundWire("REFA"));
        return new Promise((_, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("timeout", "AbortError")),
            { once: true }
          )
        );
      }
      return Response.json({ message: "idempotency_key_already_used" }, { status: 409 });
    });
    const first = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
    assert.equal(first.intencao.status, "INCONCLUSIVO");
    assert.match(first.intencao.ultimoErro, /TIMEOUT/);
    const second = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
    assert.equal(second.intencao.status, enoughEvidence ? "CONFIRMADO" : "INCONCLUSIVO");
    assert.equal(second.intencao.mpRefundId, enoughEvidence ? "REFA" : null);
    assert.equal(keys.length, 2);
    assert.equal(new Set(keys).size, 1);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM pedido_reembolso_pix_mp_intencoes").first()).n,
      1
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM pedido_reembolsos").first()).n,
      enoughEvidence ? 1 : 0
    );
    assert.equal(second.intencao.podeVerificar, !enoughEvidence);
  });

test("two new equal remote REFs remain ambiguous and emit a bounded operational alert", async t => {
  const { db, params } = await refundScenario(t);
  const refunds = [];
  const logs = t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST" && refunds.length === 0)
      refunds.push(refundWire("REFA"), refundWire("REFB"));
    return Response.json(refundOrder(refunds));
  });
  for (let i = 0; i < 2; i++) {
    const result = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1));
    assert.equal(result.intencao.status, "INCONCLUSIVO");
    assert.equal(result.intencao.mpRefundId, null);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM pedido_reembolsos").first()).n, 0);
  assert.equal(
    logs.mock.calls.filter(c => c.arguments[1]?.code === "MP_REFUND_IDENTITY_INCONCLUSIVE").length,
    1
  );
});

test("concurrent intents on one PAY cannot dispatch without a unique association window", async t => {
  const { db, params } = await refundScenario(t);
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
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method !== "POST") return Response.json(refundOrder([]));
    posts++;
    throw new Error("lost response");
  });
  const results = await Promise.all(
    [1, 2].map(id => app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(id)))
  );
  db.hook = null;
  assert.equal(posts, 1);
  assert.deepEqual(results.map(r => r.intencao.status).sort(), ["INCONCLUSIVO", "PENDENTE"]);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT SUM(valor_centavos) AS n FROM pedido_reembolso_pix_mp_intencoes WHERE status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO')"
        )
        .first()
    ).n,
    1000
  );
});

test("ten legacy payments cannot starve an eligible expired Orders payment", async t => {
  const db = await fixture(t);
  await db
    .prepare("UPDATE pedidos SET reserva_expira_em=datetime('now','-1 minute') WHERE id=1")
    .run();
  const legacyIds = [];
  for (let id = 2; id <= 11; id++) {
    legacyIds.push(id);
    await db.batch([
      db
        .prepare(
          "INSERT INTO pedidos(id,cliente_nome,cliente_whatsapp,token_publico,idempotency_key,valor_total_centavos,status_pagamento,status_pedido,reserva_status,reserva_expira_em) SELECT ?,cliente_nome,cliente_whatsapp,?,?,valor_total_centavos,'PENDENTE',status_pedido,'ATIVA',datetime('now','-1 day') FROM pedidos WHERE id=1"
        )
        .bind(id, `legacy-${id}`, `legacy-order-${id}`),
      db
        .prepare(
          "INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key) VALUES(?,?,'PIX_MP','SITE',10000,'PENDENTE',?,?)"
        )
        .bind(id, id, String(id), `legacy-payment-${id}`)
    ]);
  }
  const before = (
    await db.prepare("SELECT id,status FROM pedido_pagamentos WHERE id>1 ORDER BY id").all()
  ).results;
  const logs = t.mock.method(console, "warn", () => {});
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call network");
  });
  await app.sync.liberarReservasVencidasLocalmente({ DB: db });
  await app.sync.liberarReservasVencidasLocalmente({ DB: db });
  assert.equal(
    (await db.prepare("SELECT status FROM pedido_pagamentos WHERE id=1").first()).status,
    "EXPIRADO"
  );
  assert.deepEqual(
    (await db.prepare("SELECT id,status FROM pedido_pagamentos WHERE id>1 ORDER BY id").all())
      .results,
    before
  );
  assert.ok(
    (await db.prepare("SELECT reserva_status FROM pedidos WHERE id>1").all()).results.every(
      p => p.reserva_status === "ATIVA"
    )
  );
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(
    logs.mock.calls.filter(c => c.arguments[1]?.code === "MP_LEGACY_CUTOVER_BLOCKED").length,
    10
  );
});

test("ambiguous Orders creation without remote IDs is eligible for local expiration sweep", async t => {
  const db = await fixture(t);
  await db.batch([
    db.prepare(
      "UPDATE pedidos SET reserva_status='ATIVA', reserva_expira_em=datetime('now','-5 minutes') WHERE id=1"
    ),
    db.prepare(
      "UPDATE pedido_pagamentos SET mp_order_id=NULL, mp_payment_id=NULL, status='PENDENTE', mp_status=NULL, mp_status_detail=NULL WHERE id=1"
    )
  ]);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call Mercado Pago");
  });
  const beforeProducts = await db
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id=1")
    .first();

  await app.sync.liberarReservasVencidasLocalmente({ DB: db });

  const payment = await db
    .prepare("SELECT status, mp_order_id, mp_payment_id FROM pedido_pagamentos WHERE id=1")
    .first();
  const order = await db
    .prepare("SELECT reserva_status, reserva_liberada_em FROM pedidos WHERE id=1")
    .first();
  const afterProducts = await db
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id=1")
    .first();

  assert.equal(payment.status, "EXPIRADO");
  assert.equal(payment.mp_order_id, null);
  assert.equal(payment.mp_payment_id, null);
  assert.equal(order.reserva_status, "LIBERADA");
  assert.ok(order.reserva_liberada_em);
  assert.equal(afterProducts.estoque, beforeProducts.estoque);
  assert.equal(afterProducts.estoque_reservado, beforeProducts.estoque_reservado - 2);
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS c FROM pedido_pagamentos").first()).c, 1);
});

test("ten legacy payments do not starve an ambiguous Orders creation without remote IDs", async t => {
  const db = await fixture(t);
  await db.batch([
    db.prepare(
      "UPDATE pedidos SET reserva_status='ATIVA', reserva_expira_em=datetime('now','-5 minutes') WHERE id=1"
    ),
    db.prepare(
      "UPDATE pedido_pagamentos SET mp_order_id=NULL, mp_payment_id=NULL, status='PENDENTE', mp_status=NULL, mp_status_detail=NULL WHERE id=1"
    )
  ]);
  for (let id = 2; id <= 11; id++) {
    await db.batch([
      db
        .prepare(
          "INSERT INTO pedidos(id,cliente_nome,cliente_whatsapp,token_publico,idempotency_key,valor_total_centavos,status_pagamento,status_pedido,reserva_status,reserva_expira_em) SELECT ?,cliente_nome,cliente_whatsapp,?,?,valor_total_centavos,'PENDENTE',status_pedido,'ATIVA',datetime('now','-1 day') FROM pedidos WHERE id=1"
        )
        .bind(id, `legacy-${id}`, `legacy-order-${id}`),
      db
        .prepare(
          "INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key) VALUES(?,?,'PIX_MP','SITE',10000,'PENDENTE',?,?)"
        )
        .bind(id, id, String(id), `legacy-payment-${id}`)
    ]);
  }
  const beforeLegacy = (
    await db.prepare("SELECT id, status FROM pedido_pagamentos WHERE id>1 ORDER BY id").all()
  ).results;
  const logs = t.mock.method(console, "warn", () => {});
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call network");
  });

  await app.sync.liberarReservasVencidasLocalmente({ DB: db });

  const payment1 = await db.prepare("SELECT status FROM pedido_pagamentos WHERE id=1").first();
  const order1 = await db.prepare("SELECT reserva_status FROM pedidos WHERE id=1").first();
  assert.equal(payment1.status, "EXPIRADO");
  assert.equal(order1.reserva_status, "LIBERADA");

  const afterLegacy = (
    await db.prepare("SELECT id, status FROM pedido_pagamentos WHERE id>1 ORDER BY id").all()
  ).results;
  assert.deepEqual(afterLegacy, beforeLegacy);
  const legacyOrders = (await db.prepare("SELECT reserva_status FROM pedidos WHERE id>1").all())
    .results;
  assert.ok(legacyOrders.every(p => p.reserva_status === "ATIVA"));
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(
    logs.mock.calls.filter(c => c.arguments[1]?.code === "MP_LEGACY_CUTOVER_BLOCKED").length,
    10
  );
});

for (const [name, orderId, paymentId, expectedPayment, expectedReserva] of [
  ["NULL,NULL -> EXPIRADO/LIBERADA", null, null, "EXPIRADO", "LIBERADA"],
  ["ORD,PAY validos -> elegivel", "ORD12345", "PAY98765", "EXPIRADO", "LIBERADA"],
  ["NULL,PAY legado -> PENDENTE/ATIVA", null, "PAY98765", "PENDENTE", "ATIVA"],
  ["invalido,NULL -> PENDENTE/ATIVA", "INVALID_ORD", null, "PENDENTE", "ATIVA"],
  ["ORD,NULL -> PENDENTE/ATIVA", "ORD12345", null, "PENDENTE", "ATIVA"],
  ["invalido,PAY -> PENDENTE/ATIVA", "INVALID_ORD", "PAY98765", "PENDENTE", "ATIVA"]
]) {
  test(`sweep state eligibility matrix: ${name}`, async t => {
    const db = await fixture(t);
    await db.batch([
      db.prepare(
        "UPDATE pedidos SET reserva_status='ATIVA', reserva_expira_em=datetime('now','-5 minutes') WHERE id=1"
      ),
      db
        .prepare(
          "UPDATE pedido_pagamentos SET mp_order_id=?, mp_payment_id=?, status='PENDENTE', mp_status=NULL, mp_status_detail=NULL WHERE id=1"
        )
        .bind(orderId, paymentId)
    ]);
    t.mock.method(console, "warn", () => {});
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("must not call network");
    });

    await app.sync.liberarReservasVencidasLocalmente({ DB: db });

    const p = await db.prepare("SELECT status FROM pedido_pagamentos WHERE id=1").first();
    const o = await db.prepare("SELECT reserva_status FROM pedidos WHERE id=1").first();
    assert.equal(p.status, expectedPayment);
    assert.equal(o.reserva_status, expectedReserva);
    assert.equal(fetchMock.mock.calls.length, 0);
  });
}

for (const [name, file, anchor, replacement, check] of [
  [
    "BRA rejected",
    "functions/lib/mp/orders/types.ts",
    ' || country === "BRA"',
    "",
    m => assert.equal(m.isBrazilCountryCode("BRA"), true)
  ],
  [
    "foreign country accepted",
    "functions/lib/mp/orders/types.ts",
    'country === "BRA"',
    "true",
    m => assert.equal(m.isBrazilCountryCode("US"), false)
  ],
  [
    "default payer forced into test mode",
    "functions/lib/mp/orders/types.ts",
    'testMode === "orders_pix"',
    "true",
    m =>
      assert.deepEqual(m.ordersPixPayer({ email: "real@example.invalid" }), {
        email: "real@example.invalid"
      })
  ],
  [
    "old equal refund reused",
    "functions/lib/mpRefund.ts",
    "!priorRefundIds.includes(refund.id)",
    "true",
    async m => {
      const previous = globalThis.fetch;
      globalThis.fetch = async () =>
        Response.json(refundOrder([refundWire("REFA"), refundWire("REFB")]));
      try {
        assert.equal(
          (
            await m.postRefundMp("fake", "ORD101", "PAY101", "same-key", {
              amountCentavos: 500,
              priorRefundIds: ["REFA"]
            })
          ).refund?.id,
          "REFB"
        );
      } finally {
        globalThis.fetch = previous;
      }
    }
  ],
  [
    "sweep requires ORD for all lines and excludes ambiguous Orders",
    "functions/lib/paymentSync/sweeps.ts",
    "pp.mp_payment_id IS NULL",
    "false",
    async (m, t) => {
      const db = await fixture(t);
      await db.batch([
        db.prepare(
          "UPDATE pedidos SET reserva_status='ATIVA', reserva_expira_em=datetime('now','-5 minutes') WHERE id=1"
        ),
        db.prepare(
          "UPDATE pedido_pagamentos SET mp_order_id=NULL, mp_payment_id=NULL, status='PENDENTE' WHERE id=1"
        )
      ]);
      await m.liberarReservasVencidasLocalmente({ DB: db });
      const row = await db.prepare("SELECT status FROM pedido_pagamentos WHERE id=1").first();
      assert.equal(row.status, "EXPIRADO");
    }
  ]
])
  test(`audit negative control: ${name}`, async t => {
    const source = await readFile(file, "utf8");
    assert.equal(source.split(anchor).length - 1, 1);
    const compiled = await build({
      stdin: {
        contents: source.replace(anchor, replacement),
        resolveDir: resolve(dirname(file)),
        loader: "ts"
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "node"
    });
    const mutant = await import(
      `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
    );
    await assert.rejects(async () => check(mutant, t), { name: "AssertionError" });
  });
