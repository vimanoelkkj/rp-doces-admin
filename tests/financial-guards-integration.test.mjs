import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";
import { orderFixture } from "./helpers/mp-orders.mjs";

// Cross-flow regression contracts: real handlers and the complete local D1 schema.
// Hooks fix the exact ordering at the write boundary; no timing-based races.
const PAYMENT_KEY = "financial-cross-payment-01";
const REFUND_KEY = "financial-cross-refund-01";
const ITEM_KEY = "financial-cross-item-01";
const CAPTURE_CODE = "CAPTURA_MP_NAO_CONCILIADA";

async function setup(t, { pix = false } = {}) {
  const db = await fixture(t, { ledger: pix });
  if (!pix) {
    await db
      .prepare("UPDATE pedidos SET origem_pedido='MANUAL',mp_payment_id=NULL WHERE id=1")
      .run();
  }
  const session = await app.auth.createSession(db, 1);
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected remote HTTP request");
  });
  return { db, session, network };
}

function context({ db, session }, resource, body, method = "POST", extraParams = {}) {
  return {
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: "1", ...extraParams },
    request: new Request(`https://local.test/api/admin/pedidos/1${resource}`, {
      method,
      headers: {
        Cookie: session.cookie.split(";")[0],
        Origin: "https://local.test",
        "Content-Type": "application/json"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  };
}

const pay = (ctx, operationKey = PAYMENT_KEY) =>
  app.adminPayment.onRequestPost(
    context(ctx, "/pagamentos", { metodo: "DINHEIRO", valorCentavos: 10000, operationKey })
  );
const cancelOrder = ctx =>
  app.adminOrder.onRequestPatch(context(ctx, "", { statusPedido: "CANCELADO" }, "PATCH"));
const voidOrder = (ctx, devolverEstoque = true) =>
  app.adminVoid.onRequestPost(
    context(ctx, "/anulacao", { devolverEstoque, motivo: "Cross-flow regression" })
  );
const previewItem = ctx =>
  app.adminItemCancellationPreview.onRequestGet(
    context(ctx, "/itens/1/cancelamento-preview", undefined, "GET", { itemId: "1" })
  );
const cancelItem = (ctx, body) =>
  app.adminItemCancellation.onRequestPost(
    context(ctx, "/itens/1/cancelamentos", body, "POST", { itemId: "1" })
  );

async function itemPayload(ctx) {
  const response = await previewItem(ctx);
  assert.equal(response.status, 200);
  const preview = await response.json();
  return {
    operationKey: ITEM_KEY,
    estoqueAcao: preview.estoque.acaoPadrao,
    previewFingerprint: preview.previewFingerprint
  };
}

async function snapshot(db) {
  const rows = table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const [base, cancellations, voids, refundAllocations, refundIntents] = await Promise.all([
    state(db),
    rows("pedido_item_cancelamentos"),
    rows("pedido_anulacoes"),
    rows("pedido_reembolso_alocacoes"),
    rows("pedido_reembolso_pix_mp_intencoes")
  ]);
  return {
    ...base,
    cancellations: cancellations.results,
    voids: voids.results,
    refundAllocations: refundAllocations.results,
    refundIntents: refundIntents.results
  };
}

function assertStock(s, estoque, reservado) {
  assert.equal(s.produtos[0].estoque, estoque);
  assert.equal(s.produtos[0].estoque_reservado, reservado);
}

async function capture(db, local = "CANCELADO", remote = "approved") {
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,
       mp_status,idempotency_key)
       VALUES(1,'PIX_MP','ADMIN',10000,?,?,'financial-cross-capture')`
    )
    .bind(local, remote)
    .run();
}

async function assertVoidReplay(ctx, committed) {
  const before = await snapshot(ctx.db);
  const replay = await voidOrder(ctx, false);
  assert.equal(replay.status, 200);
  const body = await replay.json();
  assert.equal(body.replay, true);
  assert.deepEqual(body.anulacao, committed.anulacao);
  assert.deepEqual(await snapshot(ctx.db), before);
}

for (const local of ["CANCELADO", "FALHOU"]) {
  for (const remote of ["approved", "refunded"]) {
    test(`terminal Pix ${local}/${remote}: all three cancellation paths refuse without effects`, async t => {
      const ctx = await setup(t);
      await capture(ctx.db, local, remote);
      const before = await snapshot(ctx.db);
      assert.equal(before.pagamentos[0].status, local);
      assert.equal(before.pagamentos[0].mp_status, remote);
      assertStock(before, 10, 2);

      const payload = await itemPayload(ctx);
      const item = await cancelItem(ctx, payload);
      assert.equal(item.status, 409);
      assert.equal((await item.json()).code, CAPTURE_CODE);
      assert.deepEqual(await snapshot(ctx.db), before);

      const operational = await cancelOrder(ctx);
      assert.equal(operational.status, 409);
      assert.equal((await operational.json()).code, "PEDIDO_COM_PIX_PENDENTE");
      assert.deepEqual(await snapshot(ctx.db), before);

      const annulment = await voidOrder(ctx);
      assert.equal(annulment.status, 409);
      assert.equal((await annulment.json()).code, CAPTURE_CODE);
      assert.deepEqual(await snapshot(ctx.db), before);
      assert.equal(ctx.network.mock.calls.length, 0);
    });
  }
}

test("payment wins before operational cancellation: A1 replay and manual paid void preserve the ledger", async t => {
  const ctx = await setup(t);
  const initial = await snapshot(ctx.db);
  let winner;
  let committed;
  ctx.db.hook = async (statements, operation) => {
    if (operation === "run" && statements[0].sql.includes("SET status_pedido = ?")) {
      ctx.db.hook = null;
      const response = await pay(ctx);
      assert.equal(response.status, 201);
      winner = await response.json();
      committed = await snapshot(ctx.db);
    }
  };
  const refused = await cancelOrder(ctx);
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /estorno antes de cancelar/i);
  assert.ok(committed, "payment commits exactly before the cancellation UPDATE");
  assert.equal(initial.pagamentos.length, 0);
  assert.equal(committed.pagamentos.length, 1);
  assert.equal(committed.operacoes.length, 1);
  assert.equal(committed.alocacoes.length, 1);
  assert.equal(committed.pedido.reserva_status, "CONVERTIDA");
  assertStock(committed, 8, 0);
  assert.deepEqual(await snapshot(ctx.db), committed, "only the winning payment has effects");

  const replay = await pay(ctx);
  assert.equal(replay.status, 201);
  const replayBody = await replay.json();
  assert.equal(replayBody.replay, true);
  assert.equal(replayBody.pagamentoId, winner.pagamentoId);
  assert.deepEqual(await snapshot(ctx.db), committed);

  // Manual paid voids intentionally preserve money and snapshot its original net.
  const annulment = await voidOrder(ctx);
  assert.equal(annulment.status, 200);
  const body = await annulment.json();
  const after = await snapshot(ctx.db);
  assert.equal(body.anulacao.liquido_original_centavos, 10000);
  for (const field of ["pagamentos", "refunds", "alocacoes", "operacoes"]) {
    assert.deepEqual(after[field], committed[field]);
  }
  assert.equal(after.voids.length, 1);
  assertStock(after, 10, 0);
  await assertVoidReplay(ctx, body);
  assert.equal(ctx.network.mock.calls.length, 0);
});

test("operational cancellation wins before payment: refused A1 retries stay inert and unpaid void replays", async t => {
  const ctx = await setup(t);
  let committed;
  ctx.db.hook = async (statements, operation) => {
    if (operation === "batch" && statements[0].sql.includes("INSERT INTO pedido_pagamentos")) {
      ctx.db.hook = null;
      assert.equal((await cancelOrder(ctx)).status, 200);
      committed = await snapshot(ctx.db);
    }
  };
  const refused = await pay(ctx);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, "COMANDA_ENCERRADA");
  assert.ok(committed, "cancellation commits exactly before the payment batch");
  assert.equal(committed.pedido.status_pedido, "CANCELADO");
  assert.equal(committed.pedido.reserva_status, "LIBERADA");
  assertStock(committed, 10, 0);
  for (const field of ["pagamentos", "refunds", "alocacoes", "operacoes"]) {
    assert.deepEqual(committed[field], []);
  }
  assert.deepEqual(await snapshot(ctx.db), committed, "CAS refusal leaves no orphan facts");

  const retry = await pay(ctx);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).code, "COMANDA_ENCERRADA");
  assert.deepEqual(await snapshot(ctx.db), committed);

  const annulment = await voidOrder(ctx);
  assert.equal(annulment.status, 200);
  const body = await annulment.json();
  const after = await snapshot(ctx.db);
  assert.equal(body.anulacao.liquido_original_centavos, 0);
  for (const field of ["pagamentos", "refunds", "alocacoes", "operacoes"]) {
    assert.deepEqual(after[field], []);
  }
  assertStock(after, 10, 0);
  await assertVoidReplay(ctx, body);
  assert.equal(ctx.network.mock.calls.length, 0);
});

for (const [name, marker] of [
  ["payment", "INSERT INTO pedido_pagamentos"],
  ["item cancellation", "INSERT INTO pedido_item_cancelamentos"],
  ["annulment", "INSERT INTO pedido_anulacoes"]
]) {
  test(`unexpected D1 failure in ${name} coincident with capture stays HTTP 500 with no attempted effects`, async t => {
    const ctx = await setup(t);
    const payload = await itemPayload(ctx);
    const initial = await snapshot(ctx.db);
    const failure = new Error("FINANCIAL_CROSS_D1_IO_FAILURE");
    const log = t.mock.method(console, "error", () => {});
    let concurrent;
    ctx.db.hook = async (statements, operation) => {
      if (operation === "batch" && statements.some(s => s.sql.includes(marker))) {
        ctx.db.hook = null;
        await capture(ctx.db);
        concurrent = await snapshot(ctx.db);
        throw failure;
      }
    };
    const attempt =
      name === "payment"
        ? () => pay(ctx)
        : name === "item cancellation"
          ? () => cancelItem(ctx, payload)
          : () => voidOrder(ctx);
    const response = await attempt();
    assert.equal(response.status, 500);
    assert.ok((await response.json()).error);
    assert.ok(
      concurrent,
      "capture is inserted after application checks, immediately before the batch"
    );
    assert.equal(initial.pagamentos.length, 0);
    assert.equal(concurrent.pagamentos.length, 1);
    assert.deepEqual(
      { ...concurrent, pagamentos: initial.pagamentos },
      initial,
      "the independent capture is the only concurrent change"
    );
    assert.deepEqual(
      await snapshot(ctx.db),
      concurrent,
      "no claim, allocation, refund, snapshot or stock effect survives the failed attempt"
    );
    assert.ok(
      log.mock.calls.some(call => call.arguments.includes(failure)),
      "the original infrastructure exception remains observable"
    );
    assertStock(concurrent, 10, 2);

    const retry = await attempt();
    assert.equal(retry.status, 409);
    assert.equal(
      (await retry.json()).code,
      name === "item cancellation" ? "PREVIEW_OBSOLETO" : CAPTURE_CODE
    );
    assert.deepEqual(await snapshot(ctx.db), concurrent);
    if (name === "item cancellation") {
      const refreshed = await cancelItem(ctx, await itemPayload(ctx));
      assert.equal(refreshed.status, 409);
      assert.equal((await refreshed.json()).code, CAPTURE_CODE);
      assert.deepEqual(await snapshot(ctx.db), concurrent);
    }
    assert.equal(ctx.network.mock.calls.length, 0);
  });
}

test("manual item refund completes cancellation once; operational cancellation and void preserve A1 and stock", async t => {
  const ctx = await setup(t);
  const payment = await pay(ctx);
  assert.equal(payment.status, 201);
  const paymentBody = await payment.json();
  const paid = await snapshot(ctx.db);
  assertStock(paid, 8, 0);

  const payload = { ...(await itemPayload(ctx)), estoqueAcao: "REPOR" };
  const created = await cancelItem(ctx, payload);
  assert.equal(created.status, 200);
  const cancellation = (await created.json()).cancelamento;
  assert.equal(cancellation.status, "AGUARDANDO_REEMBOLSO");
  assertStock(await snapshot(ctx.db), 8, 0);
  const leg = cancellation.pernasPendentes[0];
  assert.equal(leg.valorCentavos, 10000);
  const refund = () =>
    app.adminItemCancellationRefund.onRequestPost(
      context(
        ctx,
        `/cancelamentos/${cancellation.id}/reembolsos`,
        {
          operationKey: REFUND_KEY,
          pagamentoId: leg.pagamentoId,
          pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
          valorCentavos: leg.valorCentavos,
          confirmacao: true
        },
        "POST",
        { cancelamentoId: String(cancellation.id) }
      )
    );
  const response = await refund();
  assert.equal(response.status, 201);
  const refundBody = await response.json();
  assert.equal(refundBody.cancelamento.status, "CONCLUIDO");
  const refunded = await snapshot(ctx.db);
  assert.equal(refunded.pagamentos.length, 1);
  assert.equal(refunded.pagamentos[0].status, "PAGO");
  assert.deepEqual(refunded.pagamentos, paid.pagamentos);
  assert.deepEqual(refunded.alocacoes, paid.alocacoes);
  assert.equal(refunded.refunds.length, 1);
  assert.equal(refunded.refunds[0].status, "REEMBOLSADO");
  assert.equal(refunded.refunds[0].valor_centavos, 10000);
  assert.equal(refunded.refundAllocations.length, 1);
  assert.equal(refunded.refundAllocations[0].valor_centavos, 10000);
  assert.equal(refunded.itens[0].status_item, "CANCELADO");
  assert.equal(refunded.itens[0].estoque_estado, "REPOSTO");
  assertStock(refunded, 10, 0);

  assert.equal((await cancelOrder(ctx)).status, 200);
  const cancelled = await snapshot(ctx.db);
  assert.deepEqual(cancelled.pagamentos, refunded.pagamentos);
  assert.deepEqual(cancelled.refunds, refunded.refunds);
  assertStock(cancelled, 10, 0);

  const paymentReplay = await pay(ctx);
  assert.equal(paymentReplay.status, 201);
  const replayedPayment = await paymentReplay.json();
  assert.equal(replayedPayment.replay, true);
  assert.equal(replayedPayment.pagamentoId, paymentBody.pagamentoId);
  assert.deepEqual(await snapshot(ctx.db), cancelled);
  // Refund replay retries physical finalization. Its projection refreshes only the
  // order's technical timestamp; pin an older value to prove this without sleeps.
  await ctx.db.prepare("UPDATE pedidos SET atualizado_em='2000-01-01 00:00:00' WHERE id=1").run();
  const beforeRefundReplay = await snapshot(ctx.db);
  assert.deepEqual(beforeRefundReplay, {
    ...cancelled,
    pedido: { ...cancelled.pedido, atualizado_em: "2000-01-01 00:00:00" }
  });
  const refundReplay = await refund();
  assert.equal(refundReplay.status, 200);
  const replayedRefund = await refundReplay.json();
  assert.equal(replayedRefund.replay, true);
  assert.equal(replayedRefund.reembolsoId, refundBody.reembolsoId);
  const afterRefundReplay = await snapshot(ctx.db);
  assert.match(afterRefundReplay.pedido.atualizado_em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(afterRefundReplay.pedido.atualizado_em > beforeRefundReplay.pedido.atualizado_em);
  assert.deepEqual(afterRefundReplay, {
    ...beforeRefundReplay,
    pedido: { ...beforeRefundReplay.pedido, atualizado_em: afterRefundReplay.pedido.atualizado_em }
  });
  const itemReplay = await cancelItem(ctx, payload);
  assert.equal(itemReplay.status, 200);
  assert.equal((await itemReplay.json()).replay, true);
  assert.deepEqual(await snapshot(ctx.db), afterRefundReplay);

  const annulment = await voidOrder(ctx);
  assert.equal(annulment.status, 200);
  const body = await annulment.json();
  assert.equal(body.anulacao.bruto_original_centavos, 10000);
  assert.equal(body.anulacao.reembolsado_original_centavos, 10000);
  assert.equal(body.anulacao.liquido_original_centavos, 0);
  const after = await snapshot(ctx.db);
  for (const field of [
    "pagamentos",
    "refunds",
    "alocacoes",
    "operacoes",
    "refundAllocations",
    "cancellations"
  ]) {
    assert.deepEqual(after[field], cancelled[field]);
  }
  assertStock(after, 10, 0);
  await assertVoidReplay(ctx, body);
  assert.equal(ctx.network.mock.calls.length, 0);
});

test("verified Pix refund unlocks item cancellation and replay while historical exposure still refuses void", async t => {
  const ctx = await setup(t, { pix: true });
  let wire = orderFixture({ id: 101, status: "approved", transaction_amount: 99 });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
    assert.equal(options?.method ?? "GET", "GET", "recovery must never create another charge");
    calls.push(String(url));
    return Response.json(wire);
  });
  const sync = async () =>
    app.sync.syncPaymentFromMp(ctx.db, 1, await app.sync.fetchMpPayment("fake", "ORD101"));
  await sync();
  const captured = await snapshot(ctx.db);
  assert.equal(captured.pagamentos[0].status, "PENDENTE");
  assert.equal(captured.pagamentos[0].mp_status, "approved");
  assertStock(captured, 10, 2);
  const refused = await cancelItem(ctx, await itemPayload(ctx));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, CAPTURE_CODE);
  assert.deepEqual(await snapshot(ctx.db), captured);

  wire = orderFixture({
    id: 101,
    status: "refunded",
    transaction_amount: 100,
    external_reference: "token",
    payment_method_id: "pix"
  });
  await sync();
  const reconciled = await snapshot(ctx.db);
  assert.equal(reconciled.pagamentos[0].status, "REEMBOLSADO");
  assert.equal(reconciled.pagamentos[0].mp_status, "refunded");
  assertStock(reconciled, 10, 0);

  const payload = await itemPayload(ctx);
  const cancellation = await cancelItem(ctx, payload);
  assert.equal(cancellation.status, 200);
  const body = await cancellation.json();
  assert.equal(body.cancelamento.status, "CONCLUIDO");
  const completed = await snapshot(ctx.db);
  assert.equal(completed.cancellations.length, 1);
  assert.equal(completed.itens[0].status_item, "CANCELADO");
  assert.deepEqual(completed.pagamentos, reconciled.pagamentos);
  assert.deepEqual(completed.refunds, reconciled.refunds);
  assert.deepEqual(completed.alocacoes, reconciled.alocacoes);
  assertStock(completed, 10, 0);

  const replay = await cancelItem(ctx, payload);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
  assert.deepEqual(await snapshot(ctx.db), completed);
  const changed = await cancelItem(ctx, { ...payload, motivo: "Changed A1 payload" });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "OPERACAO_CONFLITO_PAYLOAD");
  assert.deepEqual(await snapshot(ctx.db), completed);

  const annulment = await voidOrder(ctx);
  assert.equal(annulment.status, 409);
  assert.equal((await annulment.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  assert.deepEqual(await snapshot(ctx.db), completed);
  assert.deepEqual(completed.voids, []);
  assert.equal(calls.length, 2);
});
