import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app, fixture, state } from "./helpers/b3.mjs";

async function cancellationFixture(t, { legacy = false, mixed = false } = {}) {
  const db = await fixture(t, { paid: true });
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',
      status_pagamento='PAGO' WHERE id=1`),
    db
      .prepare(
        `UPDATE pedido_pagamentos SET origem='ADMIN',mp_payment_id=?,mp_order_id=?,
      pago_em=CURRENT_TIMESTAMP WHERE id=1`
      )
      .bind(legacy ? "9001" : "PAY9001", legacy ? null : "ORD9001")
  ]);
  if (mixed) {
    await db.batch([
      db.prepare("UPDATE pedido_pagamentos SET valor_centavos=5000 WHERE id=1"),
      db.prepare("UPDATE pedido_pagamento_alocacoes SET valor_centavos=5000 WHERE pagamento_id=1"),
      db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
        mp_payment_id,mp_order_id,idempotency_key,pago_em)
        VALUES(2,1,'PIX_MP','ADMIN',5000,'PAGO','PAY9002','ORD9002','pr1-mixed',CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
        VALUES(2,2,1,5000)`)
    ]);
  }
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const created = await app.itemCancellation.createItemCancellation(db, {
    pedidoId: 1,
    itemId: 1,
    usuarioId: 1,
    operationKey: "pr1-create-cancellation",
    motivo: "",
    estoqueAcao: "LIBERAR_RESERVA",
    previewFingerprint: preview.previewFingerprint
  });
  assert.equal(created.ok, true);
  const leg = created.cancelamento.pernasPendentes[0];
  return {
    db,
    cancellationId: created.cancelamento.id,
    input: {
      pedidoId: 1,
      cancellationId: created.cancelamento.id,
      usuarioId: 1,
      operationKey: "pr1-refund-operation",
      pagamentoId: leg.pagamentoId,
      pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
      valorCentavos: leg.valorCentavos,
      confirmacao: true,
      mpAccessToken: "TEST_TOKEN"
    }
  };
}

function order(refunds = []) {
  return {
    id: "ORD9001",
    status: "processed",
    transactions: {
      payments: [{ id: "PAY9001", amount: "100.00", status: "processed" }],
      refunds
    }
  };
}

const unrelatedRefund = {
  id: "REFexternal",
  transaction_id: "PAY9001",
  amount: "100.00",
  status: "processed"
};

async function assertUnchangedFinancialState(db, before, cancellationId) {
  const after = await state(db);
  assert.deepEqual(after.produtos, before.produtos, "refund inconclusivo não libera estoque");
  assert.deepEqual(after.itens, before.itens, "refund inconclusivo não cancela item");
  assert.deepEqual(after.pagamentos, before.pagamentos, "refund inconclusivo não altera pagamento");
  assert.deepEqual(after.alocacoes, before.alocacoes);
  assert.deepEqual(
    after.refunds,
    before.refunds,
    "refund externo não ganha registro no ledger local"
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM pedido_item_cancelamentos WHERE id=?")
        .bind(cancellationId)
        .first()
    ).status,
    "AGUARDANDO_REEMBOLSO"
  );
  assert.equal(
    (await db.prepare("SELECT mp_refund_id FROM pedido_reembolso_pix_mp_intencoes").first())
      .mp_refund_id,
    null
  );
}

for (const responseStatus of [409, 201]) {
  test(`PR1 Orders ${responseStatus}: REF externo novo com mesmo PAY/valor não identifica intenção`, async t => {
    const { db, input, cancellationId } = await cancellationFixture(t);
    const before = await state(db);
    const calls = [];
    let dispatched = false;
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url: String(url), method });
      assert.ok(String(url).startsWith("https://api.mercadopago.com/v1/orders/ORD9001"));
      if (method === "POST") {
        dispatched = true;
        return responseStatus === 409
          ? Response.json({ message: "conflict" }, { status: 409 })
          : Response.json(order([unrelatedRefund]), { status: 201 });
      }
      return Response.json(order(dispatched ? [unrelatedRefund] : []));
    });
    const result = await app.itemCancellation.confirmCancellationRefund(db, input);
    assert.equal(result.ok, true);
    assert.equal(result.refundStatus, "INCONCLUSIVO");
    assert.equal(calls.filter(call => call.method === "POST").length, 1);
    await assertUnchangedFinancialState(db, before, cancellationId);
  });
}

test("PR1 Payments histórico sem ORD conserva endpoint, amount numérico e chave histórica no retry", async t => {
  const { db, input } = await cancellationFixture(t, { legacy: true });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), "https://api.mercadopago.com/v1/payments/9001/refunds");
    assert.equal(init.method, "POST");
    return calls.length === 1
      ? Response.json({ message: "unavailable" }, { status: 503 })
      : Response.json(
          { id: 7001, payment_id: 9001, amount: 100, status: "approved" },
          { status: 201 }
        );
  });
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.refundStatus, "CONFIRMADO");
  assert.equal(calls.length, 2);
  const expectedKey = createHash("sha256")
    .update(`rp-doces:pix-mp-refund:v1:${input.operationKey}`)
    .digest("hex");
  for (const { init } of calls) {
    assert.deepEqual(JSON.parse(init.body), { amount: 100 });
    assert.equal(init.headers["X-Idempotency-Key"], expectedKey);
    assert.equal(init.headers["X-Render-In-Process-Refunds"], "true");
  }
  const intent = await db
    .prepare(
      "SELECT mp_request,mp_idempotency_key,mp_refund_id FROM pedido_reembolso_pix_mp_intencoes"
    )
    .first();
  assert.deepEqual(JSON.parse(intent.mp_request), { amount: 100 });
  assert.equal(intent.mp_idempotency_key, expectedKey);
  assert.equal(intent.mp_refund_id, "7001");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM pedido_reembolsos").first()).n, 1);
});

test("PR1 Payments histórico: REF conhecido recupera por GET específico sem novo POST", async t => {
  const { db, input, cancellationId } = await cancellationFixture(t, { legacy: true });
  const methods = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = init.method ?? "GET";
    methods.push(method);
    assert.equal(
      String(url),
      `https://api.mercadopago.com/v1/payments/9001/refunds${method === "GET" ? "/7002" : ""}`
    );
    return Response.json(
      {
        id: 7002,
        payment_id: 9001,
        amount: 100,
        status: method === "POST" ? "in_process" : "approved"
      },
      { status: method === "POST" ? 201 : 200 }
    );
  });
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "PROCESSANDO");
  await db
    .prepare("UPDATE pedido_reembolso_pix_mp_intencoes SET atualizado_em='2000-01-01 00:00:00'")
    .run();
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", { cancellationId });
  await app.itemCancellation.reconcileCancellationFinalization(db, cancellationId);
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM pedido_reembolsos").first()).n, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM pedido_item_cancelamentos WHERE id=?")
        .bind(cancellationId)
        .first()
    ).status,
    "CONCLUIDO"
  );
});

test("PR1 intenção Payments histórica persistida preserva bytes do corpo e chave longa", async t => {
  const { db: sourceDb, input } = await cancellationFixture(t, { legacy: true });
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 503 }));
  assert.equal(
    (await app.itemCancellation.confirmCancellationRefund(sourceDb, input)).refundStatus,
    "INCONCLUSIVO"
  );
  const historicalKey = `historical-payment-refund-${"a".repeat(150)}`;
  const historicalBody = '{ "amount" : 100.00 }';
  const operation = await sourceDb
    .prepare("SELECT * FROM pedido_operacoes WHERE operation_key=?")
    .bind(input.operationKey)
    .first();
  const intent = await sourceDb.prepare("SELECT * FROM pedido_reembolso_pix_mp_intencoes").first();
  const { db } = await cancellationFixture(t, { legacy: true });
  // Seed an existing historical record in a fresh database. Identity remains
  // immutable after insertion; no schema trigger is removed or bypassed.
  for (const [table, row] of [
    ["pedido_operacoes", operation],
    ["pedido_reembolso_pix_mp_intencoes", intent]
  ]) {
    row.mp_idempotency_key = historicalKey;
    row.mp_request = historicalBody;
    if (table === "pedido_operacoes") row.resultado = null;
    const columns = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`
      )
      .bind(...Object.values(row))
      .run();
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      { id: 7003, payment_id: 9001, amount: 100, status: "approved" },
      { status: 201 }
    );
  });
  assert.equal(
    (await app.itemCancellation.confirmCancellationRefund(db, input)).refundStatus,
    "CONFIRMADO"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mercadopago.com/v1/payments/9001/refunds");
  assert.equal(calls[0].init.body, historicalBody);
  assert.equal(calls[0].init.headers["X-Idempotency-Key"], historicalKey);
  assert.equal(
    (await db.prepare("SELECT mp_request FROM pedido_reembolso_pix_mp_intencoes").first())
      .mp_request,
    historicalBody
  );
});

for (const identity of [
  { name: "NUM com ORD", payment: "9001", order: "ORD9001" },
  { name: "PAY sem ORD", payment: "PAY9001", order: null },
  { name: "identidade duplicada", payment: "9001", order: null, duplicate: true }
]) {
  test(`PR1 identidade ${identity.name} bloqueia rede e efeitos locais`, async t => {
    const { db, input, cancellationId } = await cancellationFixture(t, { legacy: true });
    await db
      .prepare("UPDATE pedido_pagamentos SET mp_payment_id=?,mp_order_id=? WHERE id=1")
      .bind(identity.payment, identity.order)
      .run();
    if (identity.duplicate) {
      await db
        .prepare(
          `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
        mp_payment_id,mp_order_id,idempotency_key) VALUES(2,1,'PIX_MP','ADMIN',1000,'PAGO',?,?,'duplicate-identity')`
        )
        .bind(identity.payment, identity.order)
        .run();
    }
    const before = await state(db);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      throw new Error("rede proibida");
    });
    const result = await app.itemCancellation.confirmCancellationRefund(db, input);
    assert.equal(result.refundStatus, "INCONCLUSIVO");
    assert.equal(calls, 0);
    await assertUnchangedFinancialState(db, before, cancellationId);
  });
}

test("PR1 pagamento pendente não cria intenção nem chama MP", async t => {
  const { db, input } = await cancellationFixture(t, { legacy: true });
  await db.prepare("UPDATE pedido_pagamentos SET status='PENDENTE' WHERE id=1").run();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("rede proibida");
  });
  const result = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes").first()).n,
    0
  );
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM pedido_reembolsos").first()).n, 0);
});

test("PR1 pedido misto: Payments confirmado e Orders externo não concluem cancelamento", async t => {
  const { db, input, cancellationId } = await cancellationFixture(t, { legacy: true, mixed: true });
  const before = await state(db);
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url) === "https://api.mercadopago.com/v1/payments/9001/refunds")
      return Response.json(
        { id: 7004, payment_id: 9001, amount: 50, status: "approved" },
        { status: 201 }
      );
    assert.ok(String(url).startsWith("https://api.mercadopago.com/v1/orders/ORD9002"));
    return Response.json(
      {
        id: "ORD9002",
        status: "processed",
        transactions: {
          payments: [{ id: "PAY9002", amount: "50.00", status: "processed" }],
          refunds:
            init.method === "POST"
              ? [{ ...unrelatedRefund, transaction_id: "PAY9002", amount: "50.00" }]
              : []
        }
      },
      { status: init.method === "POST" ? 201 : 200 }
    );
  });
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "CONFIRMADO");
  const ordersLeg = first.cancelamento.pernasPendentes.find(leg => leg.pagamentoId === 2);
  const second = await app.itemCancellation.confirmCancellationRefund(db, {
    ...input,
    operationKey: "pr1-mixed-orders-refund",
    pagamentoId: 2,
    pagamentoAlocacaoId: ordersLeg.pagamentoAlocacaoId,
    valorCentavos: ordersLeg.valorCentavos
  });
  assert.equal(second.refundStatus, "INCONCLUSIVO");
  assert.equal(second.cancelamento.status, "AGUARDANDO_REEMBOLSO");
  const after = await state(db);
  assert.deepEqual(after.produtos, before.produtos);
  assert.deepEqual(after.itens, before.itens);
  assert.equal(after.refunds.length, 1);
  assert.equal(after.refunds[0].mp_refund_id, "7004");
  assert.equal(
    (
      await db
        .prepare("SELECT mp_refund_id FROM pedido_reembolso_pix_mp_intencoes WHERE pagamento_id=2")
        .first()
    ).mp_refund_id,
    null
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM pedido_item_cancelamentos WHERE id=?")
        .bind(cancellationId)
        .first()
    ).status,
    "AGUARDANDO_REEMBOLSO"
  );
});

test("PR1 Orders retry preserva request/chave; GET recupera somente REF persistido", async t => {
  const { db, input, cancellationId } = await cancellationFixture(t);
  const posts = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    if (init.method === "POST") {
      posts.push({ body: init.body, key: init.headers["X-Idempotency-Key"] });
      return Response.json({}, { status: 409 });
    }
    return Response.json(order([unrelatedRefund]));
  });
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  const persisted = await db
    .prepare("SELECT mp_request,mp_idempotency_key FROM pedido_reembolso_pix_mp_intencoes")
    .first();
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.refundStatus, "INCONCLUSIVO");
  assert.deepEqual(posts, [
    { body: persisted.mp_request, key: persisted.mp_idempotency_key },
    { body: persisted.mp_request, key: persisted.mp_idempotency_key }
  ]);
  await db.prepare("UPDATE pedido_reembolso_pix_mp_intencoes SET mp_refund_id='REFknown'").run();
  const before = await state(db);
  const gets = [];
  let includeKnown = false;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    assert.notEqual(init.method, "POST");
    gets.push(String(url));
    return Response.json(
      order(
        includeKnown ? [unrelatedRefund, { ...unrelatedRefund, id: "REFknown" }] : [unrelatedRefund]
      )
    );
  });
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", { cancellationId });
  assert.equal(
    (await db.prepare("SELECT status FROM pedido_reembolso_pix_mp_intencoes").first()).status,
    "INCONCLUSIVO"
  );
  assert.equal((await state(db)).refunds.length, 0);
  assert.deepEqual((await state(db)).produtos, before.produtos);
  includeKnown = true;
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", { cancellationId });
  await app.itemCancellation.reconcileCancellationFinalization(db, cancellationId);
  assert.deepEqual(gets, [
    "https://api.mercadopago.com/v1/orders/ORD9001",
    "https://api.mercadopago.com/v1/orders/ORD9001"
  ]);
  assert.equal(
    (await db.prepare("SELECT mp_refund_id FROM pedido_reembolsos").first()).mp_refund_id,
    "REFknown"
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM pedido_item_cancelamentos WHERE id=?")
        .bind(cancellationId)
        .first()
    ).status,
    "CONCLUIDO"
  );
});

test("PR1 histórico numérico com request Orders persistido bloqueia troca de corpo/API", async t => {
  const { db, input } = await cancellationFixture(t, { legacy: true });
  db.hook = statements =>
    statements.map(statement => {
      if (
        !statement.sql.includes("INSERT INTO pedido_operacoes(") ||
        !statement.sql.includes("CASE WHEN pp.mp_order_id IS NULL")
      )
        return statement;
      return {
        ...statement,
        sql: statement.sql.replace("CASE WHEN pp.mp_order_id IS NULL", "CASE WHEN 0")
      };
    });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("rede proibida");
  });
  const result = await app.itemCancellation.confirmCancellationRefund(db, input);
  db.hook = null;
  assert.equal(result.refundStatus, "INCONCLUSIVO");
  assert.equal(calls, 0);
  const intent = await db
    .prepare("SELECT ultimo_erro,mp_request FROM pedido_reembolso_pix_mp_intencoes")
    .first();
  assert.equal(intent.ultimo_erro, "REFUND_REQUEST_IDENTIDADE_DIVERGENTE");
  assert.deepEqual(JSON.parse(intent.mp_request), {
    transactions: [{ id: "9001", amount: "100.00" }]
  });
});
