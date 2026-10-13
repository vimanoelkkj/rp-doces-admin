import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { app, fixture, state, barrier } from "./helpers/b3.mjs";

const input = payload => ({
  pedidoId: 1,
  pagamentoId: 1,
  usuarioId: 1,
  operationKey: "orders-same-key-race",
  fingerprint: app.operacoes.fingerprint({ pedidoId: 1, pagamentoId: 1, payload }),
  valorCentavos: 10000,
  accessToken: "fake"
});

for (const winnerIndex of [0, 1]) {
  test(`Orders same key: incompatible fingerprints conflict, winner ${winnerIndex + 1}`, async t => {
    const db = await fixture(t, { paid: true, reserve: "CONVERTIDA" });
    const before = await state(db);
    const inputs = [input("first"), input("second")];
    const gate = barrier(2);
    let releaseLoser;
    const winnerCommitted = new Promise(resolve => {
      releaseLoser = resolve;
    });
    const batch = db.batch.bind(db);
    let creations = 0;
    db.batch = async statements => {
      const creation = statements.find(s => s.sql.includes("INSERT INTO pedido_operacoes"));
      if (!creation) return batch(statements);
      creations++;
      await gate();
      if (creation.args[3] !== inputs[winnerIndex].fingerprint) {
        await winnerCommitted;
        return batch(statements);
      }
      try {
        return await batch(statements);
      } finally {
        releaseLoser();
      }
    };
    let releasePost;
    const remoteReply = new Promise(resolve => {
      releasePost = resolve;
    });
    const posts = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      assert.equal(
        String(url),
        `https://api.mercadopago.com/v1/orders/ORD101${init.method === "POST" ? "/refund" : ""}`
      );
      if (init.method !== "POST")
        return Response.json({ id: "ORD101", transactions: { payments: [{ id: "PAY101" }] } });
      posts.push({ body: init.body, key: init.headers["X-Idempotency-Key"] });
      await remoteReply;
      return Response.json({}, { status: 503 });
    });
    const results = inputs.map(params => app.mpRefundIntent.reconcilePixMpRefundIntent(db, params));
    const loser = await results[1 - winnerIndex];
    releasePost();
    const winner = await results[winnerIndex];
    assert.deepEqual(loser, { ok: false, erro: "OPERACAO_CONFLITO_PAYLOAD" });
    assert.equal(winner.ok, true);
    assert.equal(winner.intencao.status, "INCONCLUSIVO");
    assert.equal(
      creations,
      2,
      "both requests passed the initial identity lookup before racing on INSERT"
    );
    await assertWinner(db, before, inputs[winnerIndex], posts);
  });
}

test("Orders same key: compatible concurrent identity preserves the winner and dispatches once", async t => {
  const db = await fixture(t, { paid: true, reserve: "CONVERTIDA" });
  const before = await state(db);
  const params = input("same");
  const creationGate = barrier(2);
  const dispatchGate = barrier(2);
  let creations = 0;
  db.hook = async (statements, operation) => {
    if (
      operation === "batch" &&
      statements.some(s => s.sql.includes("INSERT INTO pedido_operacoes"))
    ) {
      creations++;
      await creationGate();
    }
    if (operation === "run" && statements.some(s => s.sql.includes("SET status='PROCESSANDO'")))
      await dispatchGate();
    return statements;
  };
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    assert.equal(
      String(url),
      `https://api.mercadopago.com/v1/orders/ORD101${init.method === "POST" ? "/refund" : ""}`
    );
    if (init.method !== "POST")
      return Response.json({ id: "ORD101", transactions: { payments: [{ id: "PAY101" }] } });
    posts.push({ body: init.body, key: init.headers["X-Idempotency-Key"] });
    return Response.json({}, { status: 503 });
  });
  const results = await Promise.all(
    [1, 2].map(() => app.mpRefundIntent.reconcilePixMpRefundIntent(db, params))
  );
  db.hook = null;
  assert.equal(creations, 2);
  assert.ok(results.every(result => result.ok));
  assert.equal(results[0].intencao.id, results[1].intencao.id);
  await assertWinner(db, before, params, posts);
});

async function assertWinner(db, before, params, posts) {
  const after = await state(db);
  for (const field of ["pedido", "pagamentos", "refunds", "alocacoes", "produtos", "itens"])
    assert.deepEqual(after[field], before[field], field);
  assert.equal(after.operacoes.length, 1);
  const operation = after.operacoes[0];
  assert.equal(operation.operation_key, params.operationKey);
  assert.equal(operation.fingerprint, params.fingerprint);
  const intent = await db.prepare("SELECT * FROM pedido_reembolso_pix_mp_intencoes").first();
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes").first()).n,
    1
  );
  assert.equal(intent.operacao_id, operation.id);
  assert.equal(intent.valor_centavos, 10000);
  assert.equal(intent.tentativas, 1, "loser did not process the winner's remote intent again");
  assert.equal(intent.status, "INCONCLUSIVO");
  assert.equal(intent.mp_refund_id, null);
  const key = createHash("sha256")
    .update(`rp-doces:pix-mp-refund:v1:${params.operationKey}`)
    .digest("hex");
  const body = '{"transactions":[{"id":"PAY101","amount":"100.00"}]}';
  assert.equal(operation.mp_request, body);
  assert.equal(intent.mp_request, body);
  assert.equal(operation.mp_idempotency_key, key);
  assert.equal(intent.mp_idempotency_key, key);
  assert.deepEqual(posts, [{ body, key }]);
}
