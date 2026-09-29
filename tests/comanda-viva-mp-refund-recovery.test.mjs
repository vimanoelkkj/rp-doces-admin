import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";
import {
  bancoProducao,
  aplicarB5,
  aplicarEstoquePorItem,
  aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem,
  aplicarTrocaPorItem,
  aplicarRefundPixMpRecuperavel
} from "./helpers/b5.mjs";

async function cancellationScenario(t, { payment = 2000, item = 500 } = {}) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db
      .prepare(
        `UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',
      valor_total_centavos=?,status_pagamento='PAGO' WHERE id=1`
      )
      .bind(item),
    db
      .prepare(
        `UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=?,valor_total_centavos=? WHERE id=1`
      )
      .bind(item, item),
    db.prepare(`UPDATE produtos SET estoque_reservado=1 WHERE id=1`),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key,pago_em) VALUES(1,1,'PIX_MP','ADMIN',?,'PAGO','9001','pix-paid',CURRENT_TIMESTAMP)`
      )
      .bind(payment),
    db
      .prepare(
        `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(1,1,1,?)`
      )
      .bind(item)
  ]);
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const created = await app.itemCancellation.createItemCancellation(db, {
    pedidoId: 1,
    itemId: 1,
    usuarioId: 1,
    operationKey: "create-cancel-mp-01",
    motivo: "",
    estoqueAcao: "LIBERAR_RESERVA",
    previewFingerprint: preview.previewFingerprint
  });
  assert.equal(created.ok, true);
  return { db, cancellation: created.cancelamento, leg: created.cancelamento.pernasPendentes[0] };
}

function refundInput(cancellation, leg, operationKey = "refund-mp-operation-01") {
  return {
    pedidoId: 1,
    cancellationId: cancellation.id,
    usuarioId: 1,
    operationKey,
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function refundCapacity(db, paymentId = 1) {
  const row = await db
    .prepare(
      `SELECT pp.valor_centavos AS paid,
    COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos
      WHERE pagamento_id=pp.id AND status='REEMBOLSADO'),0) AS refunded,
    COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolso_pix_mp_intencoes
      WHERE pagamento_id=pp.id AND status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO')),0) AS reserved
    FROM pedido_pagamentos pp WHERE pp.id=?`
    )
    .bind(paymentId)
    .first();
  return { ...row, remaining: row.paid - row.refunded - row.reserved };
}

async function exchangeScenario(t, { destination = 1200, mixed = false } = {}) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  const statements = [
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',
      valor_total_centavos=1500,status_pagamento='PAGO' WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=1500,
      valor_total_centavos=1500 WHERE id=1`),
    db.prepare(`UPDATE produtos SET nome='A',preco_centavos=1500,estoque_reservado=1 WHERE id=1`),
    db
      .prepare(
        `INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
      VALUES(2,'B','BOLO',?,10,0,1,1)`
      )
      .bind(destination),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key,pago_em) VALUES(1,1,'PIX_MP','ADMIN',?,'PAGO','9002','pix-exchange',CURRENT_TIMESTAMP)`
      )
      .bind(mixed ? 1000 : 1500),
    db
      .prepare(
        `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(1,1,1,?)`
      )
      .bind(mixed ? 1000 : 1500)
  ];
  if (mixed)
    statements.push(
      db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(2,1,'DINHEIRO','ADMIN',500,'PAGO','cash-exchange',CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(2,2,1,500)`)
    );
  await db.batch(statements);
  const input = {
    pedidoId: 1,
    itemId: 1,
    produtoDestinoId: 2,
    quantidadeDestino: 1,
    precoEsperadoCentavos: destination,
    estoqueAcaoOrigem: "LIBERAR_RESERVA"
  };
  const preview = await app.itemExchange.getItemExchangePreview(db, input);
  const created = await app.itemExchange.createItemExchange(db, {
    ...input,
    usuarioId: 1,
    operationKey: `create-exchange-${destination}-${mixed}`,
    motivo: "",
    previewFingerprint: preview.previewFingerprint
  });
  assert.equal(created.ok, true);
  return { db, exchange: created.troca };
}

async function twoLegCapacityScenario(t) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',
      status_pagamento='PAGO',valor_total_centavos=10000 WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=6000,
      valor_total_centavos=6000 WHERE id=1`),
    db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado)
      VALUES(2,'Doce','DOCE',4000,10,1)`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em)
      VALUES(2,1,2,'Doce',1,4000,4000,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key,pago_em)
      VALUES(1,1,'PIX_MP','ADMIN',10000,'PAGO','9901','capacity-payment',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(1,1,1,6000)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(2,1,2,4000)`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,
      valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro)
      VALUES(1,1,1,'AGUARDANDO_REEMBOLSO',6000,6000,6000,'LIBERAR_RESERVA','{}')`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,
      valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro)
      VALUES(2,1,2,'AGUARDANDO_REEMBOLSO',4000,4000,4000,'LIBERAR_RESERVA','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,
      valor_centavos,status,mp_refund_id,idempotency_key,concluido_em)
      VALUES(1,1,'MERCADO_PAGO','PIX_MP',1000,'REEMBOLSADO','preexisting','preexisting',CURRENT_TIMESTAMP)`)
  ]);
  return db;
}

test("caso 1: pagamento PIX_MP 2000, item 500 envia somente amount 5 e confirma uma vez", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      { id: 7001, payment_id: 9001, amount: 5, status: "approved" },
      { status: 201 }
    );
  });
  const result = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg)
  );
  assert.equal(result.ok, true);
  assert.equal(result.refundStatus, "CONFIRMADO");
  assert.equal(result.cancelamento.status, "CONCLUIDO");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 5 });
  assert.equal(calls[0].init.headers["X-Render-In-Process-Refunds"], "true");
  const intent = await db
    .prepare(
      `SELECT status,valor_centavos,mp_request,mp_refund_id,tentativas FROM pedido_reembolso_pix_mp_intencoes`
    )
    .first();
  assert.deepEqual(intent, {
    status: "CONFIRMADO",
    valor_centavos: 500,
    mp_request: '{"amount":5}',
    mp_refund_id: "7001",
    tentativas: 1
  });
  assert.equal(
    (
      await db
        .prepare(
          `SELECT COUNT(*) n FROM pedido_reembolsos WHERE valor_centavos=500 AND origem='MERCADO_PAGO'`
        )
        .first()
    ).n,
    1
  );
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_alocacoes`).first()).n,
    1
  );
  await assert.rejects(
    () =>
      db
        .prepare(
          `UPDATE pedido_reembolso_pix_mp_intencoes
    SET valor_centavos=501 WHERE id=1`
        )
        .run(),
    /pix_mp_refund_identidade_imutavel/
  );
});

test("C1: mesma operation key concorrente adquire um unico claim antes do POST", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const firstArrived = deferred();
  const releaseFirst = deferred();
  const remoteByKey = new Map();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    posts++;
    const key = init.headers["X-Idempotency-Key"];
    if (!remoteByKey.has(key)) {
      remoteByKey.set(key, { id: 7301, payment_id: 9001, amount: 5, status: "approved" });
    }
    if (posts === 1) {
      firstArrived.resolve();
      await releaseFirst.promise;
    }
    return Response.json(remoteByKey.get(key), { status: 201 });
  });
  const input = refundInput(cancellation, leg, "c1-same-operation-key");
  const firstPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await firstArrived.promise;
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  releaseFirst.resolve();
  const first = await firstPromise;

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(posts, 1, "somente o vencedor do claim pode enviar POST");
  assert.equal(remoteByKey.size, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("C5: timeout ambiguo apos efeito remoto reutiliza key sem refund duplo", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const calls = [];
  const remoteByKey = new Map();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const key = init.headers["X-Idempotency-Key"];
    const body = init.body;
    calls.push({ key, body });
    if (!remoteByKey.has(key))
      remoteByKey.set(key, { id: 7002, payment_id: 9001, amount: 5, status: "approved" });
    if (calls.length === 1) throw new Error("connection lost after provider commit");
    return Response.json(remoteByKey.get(key), { status: 201 });
  });
  const input = refundInput(cancellation, leg, "refund-response-lost-01");
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.ok, true);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 500,
    remaining: 1500
  });
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.ok, true);
  assert.equal(second.refundStatus, "CONFIRMADO");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(remoteByKey.size, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
  const replay = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(calls.length, 2);
});

test("4xx apos envio ambiguo nao libera capacidade sem provar ausencia de efeito remoto", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const remoteByKey = new Map();
  const calls = [];
  let effects = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    const key = init.headers["X-Idempotency-Key"];
    calls.push({ key, body: init.body });
    if (!remoteByKey.has(key)) {
      remoteByKey.set(key, { id: 7390, payment_id: 9001, amount: 5, status: "approved" });
      effects++;
      throw new Error("response lost after provider commit");
    }
    return Response.json(
      { message: "idempotency conflict without refund representation" },
      { status: 409 }
    );
  });
  const input = refundInput(cancellation, leg, "ambiguous-then-4xx-same-key");

  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 500,
    remaining: 1500
  });

  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.refundStatus, "INCONCLUSIVO");
  assert.equal(effects, 1, "o MP simulado criou um unico refund para a chave estavel");
  assert.equal(remoteByKey.size, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status,tentativas,mp_refund_id
    FROM pedido_reembolso_pix_mp_intencoes`
      )
      .first(),
    {
      status: "INCONCLUSIVO",
      tentativas: 2,
      mp_refund_id: null
    }
  );
  assert.equal(
    (
      await db
        .prepare(
          `SELECT fase FROM pedido_operacoes
    WHERE operation_key=?`
        )
        .bind(input.operationKey)
        .first()
    ).fase,
    "ENVIO_INCONCLUSIVO"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 500,
    remaining: 1500
  });
});

test("C6: falha de persistencia apos MP usa GET e materializa uma vez", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const calls = [];
  let effects = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url: String(url), body: init.body });
    if (method === "POST") effects++;
    return Response.json(
      { id: 7003, payment_id: 9001, amount: 5, status: "approved" },
      { status: 200 }
    );
  });
  let failMaterialization = true;
  db.hook = async statements => {
    if (
      failMaterialization &&
      statements.some(s => s.sql.includes("INSERT OR IGNORE INTO pedido_reembolsos"))
    ) {
      failMaterialization = false;
      throw new Error("D1 transient before ledger");
    }
    return statements;
  };
  const input = refundInput(cancellation, leg, "refund-d1-lost-01");
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.ok, true);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 500,
    remaining: 1500
  });
  db.hook = null;
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.ok, true);
  assert.equal(second.refundStatus, "CONFIRMADO");
  assert.deepEqual(
    calls.map(c => c.method),
    ["POST", "GET"]
  );
  assert.equal(effects, 1);
  assert.match(calls[1].url, /\/refunds\/7003$/);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_alocacoes`).first()).n,
    1
  );
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("C2: keys distintas concorrentes compartilham claim e deixam aliases auditaveis", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const firstArrived = deferred();
  const releaseFirst = deferred();
  const remoteByKey = new Map();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    const refund = { id: 7004, payment_id: 9001, amount: 5, status: "approved" };
    if ((init.method ?? "GET") === "POST") {
      posts++;
      const key = init.headers["X-Idempotency-Key"];
      if (!remoteByKey.has(key)) remoteByKey.set(key, refund);
      if (posts === 1) {
        firstArrived.resolve();
        await releaseFirst.promise;
      }
      return Response.json(remoteByKey.get(key), { status: 201 });
    }
    return Response.json(refund);
  });
  const firstPromise = app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-tab-remote-01")
  );
  await firstArrived.promise;
  const second = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-tab-remote-02")
  );
  assert.equal(second.refundStatus, "PROCESSANDO");
  assert.deepEqual(
    await db
      .prepare(
        `SELECT operation_key,fase,reembolso_id FROM pedido_operacoes
    WHERE operation_key='refund-tab-remote-02'`
      )
      .first(),
    {
      operation_key: "refund-tab-remote-02",
      fase: "LOCAL_CRIADA",
      reembolso_id: null
    }
  );
  releaseFirst.resolve();
  const first = await firstPromise;
  const results = [first, second];
  assert.equal(
    results.every(r => r.ok),
    true
  );
  assert.equal(posts, 1);
  assert.equal(remoteByKey.size, 1);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    1
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.deepEqual(
    (
      await db
        .prepare(
          `SELECT operation_key,fase,reembolso_id FROM pedido_operacoes
    WHERE operation_key LIKE 'refund-tab-remote-%' ORDER BY operation_key`
        )
        .all()
    ).results,
    [
      { operation_key: "refund-tab-remote-01", fase: "CONCLUIDA", reembolso_id: 1 },
      { operation_key: "refund-tab-remote-02", fase: "CONCLUIDA", reembolso_id: 1 }
    ]
  );
  const aliasReplay = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-tab-remote-02")
  );
  assert.equal(aliasReplay.replay, true);
  assert.equal(posts, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("C3: parciais concorrentes cuja soma excede capacidade param antes do segundo POST", async t => {
  const db = await twoLegCapacityScenario(t);
  const firstArrived = deferred();
  const releaseFirst = deferred();
  const remoteByKey = new Map();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    posts++;
    const key = init.headers["X-Idempotency-Key"];
    if (!remoteByKey.has(key)) {
      remoteByKey.set(key, { id: 7303, payment_id: 9901, amount: 60, status: "approved" });
    }
    if (posts === 1) {
      firstArrived.resolve();
      await releaseFirst.promise;
    }
    return Response.json(remoteByKey.get(key), { status: 201 });
  });
  const params = (id, value, allocation) => ({
    pedidoId: 1,
    pagamentoId: 1,
    pagamentoAlocacaoId: allocation,
    cancellationId: id,
    usuarioId: 1,
    operationKey: `c3-capacity-leg-${id}`,
    fingerprint: `c3-fingerprint-${id}`,
    valorCentavos: value,
    accessToken: "TEST_TOKEN"
  });
  const firstPromise = app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(1, 6000, 1));
  await firstArrived.promise;
  const second = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params(2, 4000, 2));
  assert.deepEqual(second, { ok: false, erro: "SALDO_REEMBOLSAVEL_INSUFICIENTE" });
  assert.equal(posts, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 10000,
    refunded: 1000,
    reserved: 6000,
    remaining: 3000
  });
  releaseFirst.resolve();
  await firstPromise;
  assert.equal(remoteByKey.size, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 10000,
    refunded: 7000,
    reserved: 0,
    remaining: 3000
  });
});

test("C4: request pausada antes do dispatch perde o CAS e nao envia segundo POST", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const beforeClaim = deferred();
  const releaseClaim = deferred();
  let paused = false;
  let posts = 0;
  db.hook = async statements => {
    if (
      !paused &&
      statements.some(statement => statement.sql.includes("SET status='PROCESSANDO'"))
    ) {
      paused = true;
      beforeClaim.resolve();
      await releaseClaim.promise;
    }
    return statements;
  };
  t.mock.method(globalThis, "fetch", async () => {
    posts++;
    return Response.json({ id: 7304, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "c4-paused-before-dispatch");
  const firstPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await beforeClaim.promise;
  assert.equal(posts, 0);
  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  releaseClaim.resolve();
  const first = await firstPromise;
  db.hook = null;
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(posts, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("in_process permanece sem efeito financeiro e GET oportunista conclui depois", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    methods.push(init.method ?? "GET");
    if ((init.method ?? "GET") === "POST") {
      return Response.json(
        { id: 7005, payment_id: 9001, amount: 5, status: "in_process" },
        { status: 201 }
      );
    }
    return Response.json({ id: 7005, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "refund-in-process-01");
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "PROCESSANDO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  assert.deepEqual(methods, ["POST"], "PROCESSANDO recente não consulta o provedor novamente");
  await db
    .prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET atualizado_em='2000-01-01 00:00:00'`)
    .run();
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  await app.itemCancellation.reconcileCancellationFinalization(db, cancellation.id);
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (
      await db
        .prepare(`SELECT status FROM pedido_item_cancelamentos WHERE id=?`)
        .bind(cancellation.id)
        .first()
    ).status,
    "CONCLUIDO"
  );
});

test("GET de refund conhecido aplica recusa terminal somente pelo estado remoto", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    const method = init.method ?? "GET";
    methods.push(method);
    if (method === "POST") {
      return Response.json({ id: 7007, payment_id: 9001, amount: 5, status: "in_process" });
    }
    return Response.json({ id: 7007, payment_id: 9001, amount: 5, status: "rejected" });
  });
  const input = refundInput(cancellation, leg, "known-refund-rejected-by-get");
  const pending = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(pending.refundStatus, "PROCESSANDO");

  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(
    db,
    "TEST_TOKEN",
    { cancellationId: cancellation.id },
    { force: true }
  );
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status,mp_refund_id,mp_status
    FROM pedido_reembolso_pix_mp_intencoes`
      )
      .first(),
    {
      status: "RECUSADO",
      mp_refund_id: "7007",
      mp_status: "rejected"
    }
  );
  assert.equal(
    (
      await db
        .prepare(
          `SELECT fase FROM pedido_operacoes
    WHERE operation_key=?`
        )
        .bind(input.operationKey)
        .first()
    ).fase,
    "RECUSADA"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 0,
    remaining: 2000
  });
});

test("408, 429, 5xx e resposta ilegível são ambíguos; 400 inequívoco é recusa", async t => {
  const responses = [
    new Response("{}", { status: 408 }),
    new Response("{}", { status: 429 }),
    new Response("{}", { status: 503 }),
    new Response("not-json", { status: 201 }),
    new Response(JSON.stringify({ message: "invalid refund" }), { status: 400 })
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  for (const expected of ["AMBIGUO", "AMBIGUO", "AMBIGUO", "AMBIGUO", "RECUSA_DEFINITIVA"]) {
    const result = await app.mpRefund.postRefundMp(
      "token",
      "9",
      `key-${expected}-${responses.length}`,
      { amountCentavos: 200, renderInProcess: true }
    );
    assert.equal(result.resultado, expected);
  }
});

test("recusa inequívoca é terminal para a key e uma nova intenção pode tentar a mesma perna", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) return Response.json({ message: "refund rejected" }, { status: 400 });
    return Response.json({ id: 7006, payment_id: 9001, amount: 5, status: "approved" });
  });
  const refused = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-definitive-refusal")
  );
  assert.equal(refused.ok, true);
  assert.equal(refused.refundStatus, "RECUSADO");
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status,tentativas,mp_refund_id
    FROM pedido_reembolso_pix_mp_intencoes`
      )
      .first(),
    {
      status: "RECUSADO",
      tentativas: 1,
      mp_refund_id: null
    }
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 0,
    remaining: 2000
  });
  const recovered = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-after-refusal")
  );
  assert.equal(recovered.refundStatus, "CONFIRMADO");
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    2
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("falha D1 antes de persistir intenção impede qualquer chamada ao provedor", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("network must not run");
  });
  db.hook = async statements => {
    if (statements.some(s => s.sql.includes("INSERT INTO pedido_operacoes")))
      throw new Error("D1 unavailable");
    return statements;
  };
  await assert.rejects(() =>
    app.itemCancellation.confirmCancellationRefund(
      db,
      refundInput(cancellation, leg, "refund-before-intent-fails")
    )
  );
  assert.equal(calls, 0);
  db.hook = null;
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    0
  );
});

test("intenção remota ativa bloqueia registro manual PIX_MP concorrente", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("ambiguous transport");
  });
  const remote = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-active-manual-block")
  );
  assert.equal(remote.refundStatus, "INCONCLUSIVO");
  await db.prepare(`UPDATE pedidos SET status_comanda='ENCERRADA' WHERE id=1`).run();
  const manual = await app.ledger.registerManualRefund(db, {
    pedidoId: 1,
    pagamentoId: 1,
    valorCentavos: 500,
    usuarioId: 1,
    operationKey: "manual-conflict-refund",
    motivo: ""
  });
  assert.equal(manual.ok, false);
  assert.equal(manual.erro, "REFUND_PIX_MP_REMOTO_EM_ANDAMENTO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
});

test("helper preserva refund integral diagnóstico e valida resposta parcial", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(init);
    return Response.json({ id: 88, payment_id: 9, amount: 2, status: "approved" });
  });
  const full = await app.mpRefund.postRefundMp("token", "9", "diag-key");
  assert.equal(full.resultado, "SUCESSO");
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["X-Render-In-Process-Refunds"], undefined);
  const partial = await app.mpRefund.postRefundMp("token", "9", "partial-key", {
    amountCentavos: 200,
    renderInProcess: true
  });
  assert.equal(partial.resultado, "SUCESSO");
  assert.deepEqual(JSON.parse(calls[1].body), { amount: 2 });
  const mismatch = await app.mpRefund.postRefundMp("token", "10", "bad-key", {
    amountCentavos: 200
  });
  assert.equal(mismatch.resultado, "AMBIGUO");
});

test("caso 2: troca 1500 por 1200 envia refund PIX_MP de exatamente 300", async t => {
  const { db, exchange } = await exchangeScenario(t);
  const leg = exchange.refundsPendentes[0];
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ id: 7100, payment_id: 9002, amount: 3, status: "approved" });
  });
  const result = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "exchange-pix-refund-300",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  });
  assert.deepEqual(sent, { amount: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.troca.status, "CONCLUIDA");
  assert.equal(
    (await db.prepare(`SELECT valor_centavos FROM pedido_reembolsos`).first()).valor_centavos,
    300
  );
});

test("releitura pós-refund PIX_MP suprimida retorna OPERACAO_INCOMPLETA sem reenvio ao provedor", async t => {
  const { db, exchange } = await exchangeScenario(t);
  const leg = exchange.refundsPendentes[0];
  assert.equal(leg.metodo, "PIX_MP");
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({ id: 7100, payment_id: 9002, amount: 3, status: "approved" });
  });
  const input = {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "exchange-pix-refund-guard-01",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  };
  let leiturasTroca = 0;
  db.hook = async statements =>
    statements.map(statement => {
      if (statement.sql.includes("FROM pedido_item_trocas WHERE id=? LIMIT 1")) {
        leiturasTroca++;
        if (leiturasTroca === 2)
          return { sql: "SELECT * FROM pedido_item_trocas WHERE 0", args: [] };
      }
      return statement;
    });
  const first = await app.itemExchange.confirmExchangeRefund(db, input);
  db.hook = null;
  assert.equal(first.ok, false);
  assert.equal(first.erro, "OPERACAO_INCOMPLETA");
  assert.equal(posts, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  const troca = await db
    .prepare(`SELECT status FROM pedido_item_trocas WHERE id=?`)
    .bind(exchange.id)
    .first();
  assert.equal(troca.status, "CONCLUIDA");
  const retry = await app.itemExchange.confirmExchangeRefund(db, input);
  assert.equal(retry.ok, true);
  assert.equal(retry.replay, true);
  assert.equal(retry.troca.status, "CONCLUIDA");
  assert.equal(posts, 1, "o replay não reenvia o refund ao provedor");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("caso 3: LIFO devolve 500 em dinheiro e envia somente 200 ao Mercado Pago", async t => {
  const { db, exchange } = await exchangeScenario(t, { destination: 800, mixed: true });
  assert.deepEqual(
    exchange.refundsPendentes.map(x => [x.metodo, x.valorCentavos]),
    [
      ["DINHEIRO", 500],
      ["PIX_MP", 200]
    ]
  );
  const cash = exchange.refundsPendentes[0];
  const cashResult = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "exchange-cash-refund-500",
    pagamentoId: cash.pagamentoId,
    pagamentoAlocacaoId: cash.pagamentoAlocacaoId,
    valorCentavos: cash.valorCentavos,
    confirmacao: true
  });
  const pix = cashResult.troca.refundsPendentes[0];
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ id: 7101, payment_id: 9002, amount: 2, status: "approved" });
  });
  const pixResult = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "exchange-pix-refund-200",
    pagamentoId: pix.pagamentoId,
    pagamentoAlocacaoId: pix.pagamentoAlocacaoId,
    valorCentavos: pix.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  });
  assert.deepEqual(sent, { amount: 2 });
  assert.equal(pixResult.ok, true);
  assert.equal(pixResult.troca.status, "CONCLUIDA");
  assert.deepEqual(
    (await db.prepare(`SELECT metodo,valor_centavos FROM pedido_reembolsos ORDER BY id`).all())
      .results,
    [
      { metodo: "DINHEIRO", valor_centavos: 500 },
      { metodo: "PIX_MP", valor_centavos: 200 }
    ]
  );
});

test("migration 0020 preserva integralmente fatos e operações A1 anteriores", async t => {
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  await aplicarTrocaPorItem(db);
  await db
    .prepare(
      `INSERT INTO pedido_operacoes(id,operation_key,tipo,escopo,ator_usuario_id,
    fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,resultado,criado_em,atualizado_em)
    VALUES(90,'old-payment-operation','PAGAMENTO_ADMIN','ADMIN',1,1,'old-fingerprint','CONCLUIDA',1,1,
      '{"ok":true}','2025-03-01','2025-03-02')`
    )
    .run();
  const tables = [
    "pedidos",
    "pedido_itens",
    "pedido_pagamentos",
    "pedido_pagamento_alocacoes",
    "pedido_reembolsos",
    "pedido_item_cancelamentos",
    "pedido_item_trocas",
    "pedido_operacoes"
  ];
  const before = Object.fromEntries(
    await Promise.all(
      tables.map(async name => [
        name,
        (await db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()).results
      ])
    )
  );
  await aplicarRefundPixMpRecuperavel(db);
  for (const name of tables) {
    assert.deepEqual(
      (await db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()).results,
      before[name]
    );
  }
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    0
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pragma_foreign_key_check`).first()).n, 0);
});

test("PROCESSANDO antigo com refund ainda in_process permanece recuperável", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ id: 7007, payment_id: 9001, amount: 5, status: "in_process" });
  });
  const first = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-still-processing-01")
  );
  assert.equal(first.refundStatus, "PROCESSANDO");
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET atualizado_em='2000-01-01 00:00:00'`
    )
    .run();
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  assert.equal(calls, 2);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "PROCESSANDO"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 0);
});

test("duas reconciliações concorrentes materializam um único efeito", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let approved = false;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      id: 7008,
      payment_id: 9001,
      amount: 5,
      status: approved ? "approved" : "in_process"
    })
  );
  await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-concurrent-reconcile-01")
  );
  approved = true;
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET atualizado_em='2000-01-01 00:00:00'`
    )
    .run();
  await Promise.all([
    app.liveTabRecovery.reconcileLiveTabParent(db, "TEST_TOKEN", {
      cancellationId: cancellation.id
    }),
    app.liveTabRecovery.reconcileLiveTabParent(db, "TEST_TOKEN", {
      cancellationId: cancellation.id
    })
  ]);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_alocacoes`).first()).n,
    1
  );
});

test("reconcile e clique manual simultâneos preservam um refund lógico", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let ambiguous = true;
  t.mock.method(globalThis, "fetch", async () => {
    if (ambiguous) throw new Error("timeout");
    return Response.json({ id: 7012, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "refund-reconcile-click-01");
  const first = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  ambiguous = false;
  await Promise.all([
    app.liveTabRecovery.reconcileLiveTabParent(db, "TEST_TOKEN", {
      cancellationId: cancellation.id
    }),
    app.itemCancellation.confirmCancellationRefund(db, input)
  ]);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    1
  );
});

test("reload expõe a operationKey persistida e mantém a mesma intenção inconclusiva", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("timeout depois do envio");
  });
  const operationKey = "refund-reload-same-intent-01";
  const first = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, operationKey)
  );
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  const reloaded = await app.itemCancellation.getCancellationView(db, 1, 1);
  assert.equal(reloaded.pernasPendentes[0].refundRemoto.operationKey, operationKey);
  assert.equal(reloaded.pernasPendentes[0].refundRemoto.podeVerificar, true);
  assert.equal(reloaded.pernasPendentes[0].refundRemoto.status, "INCONCLUSIVO");
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n,
    1
  );
});

test("queda após persistir intenção PENDENTE e antes da rede é retomada no reload", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let remoteCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    remoteCalls++;
    return Response.json({ id: 7009, payment_id: 9001, amount: 5, status: "approved" });
  });
  let crashBeforeNetwork = true;
  db.hook = async statements => {
    if (
      crashBeforeNetwork &&
      statements.some(statement => statement.sql.includes("SET status='PROCESSANDO'"))
    ) {
      crashBeforeNetwork = false;
      throw new Error("processo caiu antes da chamada remota");
    }
    return statements;
  };
  await assert.rejects(() =>
    app.itemCancellation.confirmCancellationRefund(
      db,
      refundInput(cancellation, leg, "refund-pending-before-network-01")
    )
  );
  assert.equal(remoteCalls, 0);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "PENDENTE"
  );
  db.hook = null;
  await app.liveTabRecovery.reconcileLiveTabParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  assert.equal(remoteCalls, 1);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "CONFIRMADO"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("lease PROCESSANDO expirada sem refund remoto nao reenvia POST cegamente", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  db.hook = async statements => {
    if (statements.some(statement => statement.sql.includes("SET status='PROCESSANDO'"))) {
      throw new Error("crash before claim execution");
    }
    return statements;
  };
  await assert.rejects(() =>
    app.itemCancellation.confirmCancellationRefund(
      db,
      refundInput(cancellation, leg, "expired-dispatch-lease-01")
    )
  );
  db.hook = null;
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET status='PROCESSANDO',tentativas=1,ultima_tentativa_em='2000-01-01 00:00:00',
        atualizado_em='2000-01-01 00:00:00'`
    )
    .run();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    posts++;
    return Response.json({ id: 7310, payment_id: 9001, amount: 5, status: "approved" });
  });

  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  const ambiguous = await db
    .prepare(`SELECT status,ultimo_erro FROM pedido_reembolso_pix_mp_intencoes`)
    .first();
  assert.equal(posts, 0);
  assert.deepEqual(ambiguous, {
    status: "INCONCLUSIVO",
    ultimo_erro: "DISPATCH_LEASE_EXPIRADA_RECONCILIACAO_NECESSARIA"
  });

  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  assert.equal(posts, 1, "somente a reconciliacao explicita posterior reenvia a chave estavel");
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "CONFIRMADO"
  );
});

test("S4: force=true nao rompe lease nem redispara POST sem identidade remota", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const firstArrived = deferred();
  const releaseFirst = deferred();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    posts++;
    firstArrived.resolve();
    await releaseFirst.promise;
    return Response.json({ id: 7313, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "force-does-not-bypass-claim");
  const firstPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await firstArrived.promise;

  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(
    db,
    "TEST_TOKEN",
    { cancellationId: cancellation.id },
    { force: true }
  );
  assert.equal(posts, 1);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "PROCESSANDO"
  );

  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET ultima_tentativa_em='2000-01-01 00:00:00',atualizado_em='2000-01-01 00:00:00'`
    )
    .run();
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(
    db,
    "TEST_TOKEN",
    { cancellationId: cancellation.id },
    { force: true }
  );
  assert.equal(posts, 1, "force pode reconciliar selecao, mas nao criar um segundo dispatch");
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "INCONCLUSIVO"
  );

  releaseFirst.resolve();
  await firstPromise;
  assert.equal(posts, 1);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "CONFIRMADO"
  );
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("resposta ambigua antiga nao revoga claim de uma tentativa mais nova", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const firstArrived = deferred();
  const secondArrived = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    posts++;
    if (posts === 1) {
      firstArrived.resolve();
      await releaseFirst.promise;
      throw new Error("late timeout from attempt one");
    }
    secondArrived.resolve();
    await releaseSecond.promise;
    return Response.json({ id: 7311, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "fenced-dispatch-attempt-01");
  const firstPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await firstArrived.promise;
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET status='INCONCLUSIVO',ultimo_erro='LEASE_EXPIRADA',atualizado_em=CURRENT_TIMESTAMP`
    )
    .run();
  const secondPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await secondArrived.promise;
  releaseFirst.resolve();
  await firstPromise;
  const statusAfterFirst = (
    await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()
  ).status;
  releaseSecond.resolve();
  await secondPromise;
  assert.equal(
    statusAfterFirst,
    "PROCESSANDO",
    "a falha da tentativa 1 nao pode sobrescrever a claim da tentativa 2"
  );
  assert.equal(posts, 2);
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "CONFIRMADO"
  );
});

test("B1: HTTP 400 tardio nao recusa refund remoto conhecido por tentativa mais nova", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const firstArrived = deferred();
  const releaseFirst = deferred();
  const calls = [];
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url: String(url), key: init.headers?.["X-Idempotency-Key"] });
    if (method === "POST") {
      posts++;
      if (posts === 1) {
        firstArrived.resolve();
        await releaseFirst.promise;
        return Response.json({ message: "late refusal from attempt one" }, { status: 400 });
      }
      return Response.json({ id: 7312, payment_id: 9001, amount: 5, status: "in_process" });
    }
    return Response.json({ id: 7312, payment_id: 9001, amount: 5, status: "approved" });
  });
  const input = refundInput(cancellation, leg, "b1-late-post-refusal");
  const firstPromise = app.itemCancellation.confirmCancellationRefund(db, input);
  await firstArrived.promise;
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes
    SET ultima_tentativa_em='2000-01-01 00:00:00',atualizado_em='2000-01-01 00:00:00'`
    )
    .run();
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(db, "TEST_TOKEN", {
    cancellationId: cancellation.id
  });
  assert.equal(posts, 1, "lease expirada exige reconciliacao antes de qualquer novo POST");

  const second = await app.itemCancellation.confirmCancellationRefund(db, input);
  assert.equal(second.refundStatus, "PROCESSANDO");
  assert.equal(posts, 2);
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status,tentativas,mp_refund_id
    FROM pedido_reembolso_pix_mp_intencoes`
      )
      .first(),
    {
      status: "PROCESSANDO",
      tentativas: 2,
      mp_refund_id: "7312"
    }
  );

  releaseFirst.resolve();
  await firstPromise;
  assert.deepEqual(
    await db
      .prepare(
        `SELECT status,tentativas,mp_refund_id
    FROM pedido_reembolso_pix_mp_intencoes`
      )
      .first(),
    {
      status: "PROCESSANDO",
      tentativas: 2,
      mp_refund_id: "7312"
    }
  );
  assert.equal(
    (
      await db
        .prepare(
          `SELECT fase FROM pedido_operacoes
    WHERE operation_key=?`
        )
        .bind(input.operationKey)
        .first()
    ).fase,
    "REMOTO_CONHECIDO"
  );
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 0,
    reserved: 500,
    remaining: 1500
  });

  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(
    db,
    "TEST_TOKEN",
    { cancellationId: cancellation.id },
    { force: true }
  );
  await app.itemCancellation.reconcileCancellationFinalization(db, cancellation.id);
  assert.deepEqual(
    calls.map(call => call.method),
    ["POST", "POST", "GET"]
  );
  assert.equal(calls[0].key, calls[1].key, "as duas tentativas preservam a chave remota");
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_reembolso_pix_mp_intencoes`).first()).status,
    "CONFIRMADO"
  );
  assert.deepEqual(await refundCapacity(db), {
    paid: 2000,
    refunded: 500,
    reserved: 0,
    remaining: 1500
  });
});

test("ledger confirmado com finalização local interrompida converge no detalhe sem nova rede", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let remoteCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    remoteCalls++;
    return Response.json({ id: 7010, payment_id: 9001, amount: 5, status: "approved" });
  });
  let failFinalization = true;
  db.hook = async statements => {
    if (
      failFinalization &&
      statements.some(statement =>
        statement.sql.includes("UPDATE pedido_itens SET status_item='CANCELADO'")
      )
    ) {
      failFinalization = false;
      throw new Error("processo caiu depois do ledger");
    }
    return statements;
  };
  const confirmed = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-ledger-before-finalization-01")
  );
  assert.equal(confirmed.refundStatus, "CONFIRMADO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (await db.prepare(`SELECT status_item FROM pedido_itens WHERE id=1`).first()).status_item,
    "ATIVO"
  );
  db.hook = null;
  await app.liveTabRecovery.reconcileLiveTabPedido(db, undefined, 1);
  assert.equal(remoteCalls, 1);
  assert.equal(
    (await db.prepare(`SELECT status_item FROM pedido_itens WHERE id=1`).first()).status_item,
    "CANCELADO"
  );
  assert.equal(
    (
      await db
        .prepare(`SELECT status FROM pedido_item_cancelamentos WHERE id=?`)
        .bind(cancellation.id)
        .first()
    ).status,
    "CONCLUIDO"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  await app.liveTabRecovery.reconcileLiveTabPedido(db, undefined, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("troca com refund confirmado e finalização interrompida converge sem segundo refund", async t => {
  const { db, exchange } = await exchangeScenario(t);
  const leg = exchange.refundsPendentes[0];
  let remoteCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    remoteCalls++;
    return Response.json({ id: 7011, payment_id: 9002, amount: 3, status: "approved" });
  });
  let failFinalization = true;
  db.hook = async statements => {
    if (
      failFinalization &&
      statements.some(statement =>
        statement.sql.includes("UPDATE pedido_itens SET status_item='CANCELADO'")
      )
    ) {
      failFinalization = false;
      throw new Error("processo caiu antes de concluir troca");
    }
    return statements;
  };
  const confirmed = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "exchange-ledger-before-finalization-01",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  });
  assert.equal(confirmed.refundStatus, "CONFIRMADO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
  assert.equal(
    (await db.prepare(`SELECT status_item FROM pedido_itens WHERE id=1`).first()).status_item,
    "ATIVO"
  );
  db.hook = null;
  await app.liveTabRecovery.reconcileLiveTabPedido(db, undefined, 1);
  assert.equal(remoteCalls, 1);
  assert.deepEqual(
    (await db.prepare(`SELECT id,status_item FROM pedido_itens ORDER BY id`).all()).results,
    [
      { id: 1, status_item: "CANCELADO" },
      { id: 2, status_item: "ATIVO" }
    ]
  );
  assert.equal(
    (await db.prepare(`SELECT status FROM pedido_item_trocas WHERE id=?`).bind(exchange.id).first())
      .status,
    "CONCLUIDA"
  );
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("RECUSADO é terminal para recuperação automática e não chama o provedor", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ message: "refund rejected" }, { status: 400 });
  });
  const refused = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "refund-terminal-no-auto-retry")
  );
  assert.equal(refused.refundStatus, "RECUSADO");
  await app.mpRefundIntent.recoverPixMpRefundIntentsForParent(
    db,
    "TEST_TOKEN",
    { cancellationId: cancellation.id },
    { force: true }
  );
  assert.equal(calls, 1);
  const view = await app.itemCancellation.getCancellationView(db, 1, 1);
  assert.equal(view.pernasPendentes[0].refundRemoto.status, "RECUSADO");
  assert.equal(view.pernasPendentes[0].refundRemoto.podeVerificar, false);
});

/* ── M2: GETs de estado são somente leitura; a retomada é POST /reconciliar ── */

const cookieDe = session => session.cookie.split(";")[0];
const ESCRITA_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

// Qualquer rede (Mercado Pago incluído) e qualquer escrita no D1 durante o GET
// ficam registradas para o teste afirmar que não aconteceram.
function observarGet(t, db) {
  const rede = [];
  const escritas = [];
  t.mock.method(globalThis, "fetch", async url => {
    rede.push(String(url));
    throw new Error(`GET somente leitura não pode chamar a rede: ${url}`);
  });
  db.hook = async statements => {
    for (const s of statements) if (ESCRITA_SQL.test(s.sql)) escritas.push(s.sql);
    return statements;
  };
  return { rede, escritas };
}

const intencao = db =>
  db
    .prepare(
      `SELECT status,tentativas,mp_refund_id,atualizado_em
  FROM pedido_reembolso_pix_mp_intencoes`
    )
    .first();

const getRota = (rota, db, session, url, params) =>
  rota.onRequestGet({
    env: { DB: db, MP_ACCESS_TOKEN: "TEST_TOKEN" },
    params,
    waitUntil() {},
    request: new Request(`https://local.test${url}`, { headers: { Cookie: cookieDe(session) } })
  });

const reconciliar = (db, session) =>
  app.adminOrderReconciliar.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "TEST_TOKEN" },
    params: { id: "1" },
    waitUntil() {},
    request: new Request("https://local.test/api/admin/pedidos/1/reconciliar", {
      method: "POST",
      headers: { Origin: "https://local.test", Cookie: cookieDe(session) }
    })
  });

test("M2: GET de cancelamento com refund INCONCLUSIVO não chama o MP nem escreve; POST /reconciliar retoma", async t => {
  const { db, cancellation, leg } = await cancellationScenario(t);
  const session = await app.auth.createSession(db, 1);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection lost");
  });
  const first = await app.itemCancellation.confirmCancellationRefund(
    db,
    refundInput(cancellation, leg, "m2-cancel-01")
  );
  assert.equal(first.refundStatus, "INCONCLUSIVO");
  t.mock.restoreAll();
  const antes = await intencao(db);
  assert.equal(antes.mp_refund_id, null, "estado em que a recuperação reenviaria o POST de refund");

  const obs = observarGet(t, db);
  const r = await getRota(
    app.adminItemCancellation,
    db,
    session,
    "/api/admin/pedidos/1/itens/1/cancelamentos",
    { id: "1", itemId: "1" }
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).cancelamento.id, cancellation.id);
  assert.deepEqual(obs.rede, [], "nenhuma chamada ao Mercado Pago");
  assert.deepEqual(obs.escritas, [], "nenhuma escrita no D1");
  assert.deepEqual(await intencao(db), antes, "intenção intacta");

  db.hook = null;
  t.mock.restoreAll();
  let posts = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json(
      { id: 7201, payment_id: 9001, amount: 5, status: "approved" },
      { status: 201 }
    );
  });
  assert.equal((await reconciliar(db, session)).status, 200);
  assert.equal(posts, 1, "a retomada explícita reenvia o refund com a mesma intenção");
  assert.equal((await intencao(db)).status, "CONFIRMADO");
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n, 1);
});

test("M2: GET de troca com refund INCONCLUSIVO não chama o MP nem escreve; POST /reconciliar retoma", async t => {
  const { db, exchange } = await exchangeScenario(t);
  const session = await app.auth.createSession(db, 1);
  const leg = exchange.refundsPendentes[0];
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection lost");
  });
  const first = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1,
    exchangeId: exchange.id,
    usuarioId: 1,
    operationKey: "m2-exchange-01",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    mpAccessToken: "TEST_TOKEN"
  });
  assert.equal(first.ok, true);
  t.mock.restoreAll();
  const antes = await intencao(db);
  assert.equal(antes.status, "INCONCLUSIVO");
  assert.equal(antes.mp_refund_id, null);

  const obs = observarGet(t, db);
  const r = await getRota(
    app.adminItemExchange,
    db,
    session,
    "/api/admin/pedidos/1/itens/1/trocas",
    { id: "1", itemId: "1" }
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).troca.id, exchange.id);
  assert.deepEqual(obs.rede, [], "nenhuma chamada ao Mercado Pago");
  assert.deepEqual(obs.escritas, [], "nenhuma escrita no D1");
  assert.deepEqual(await intencao(db), antes, "intenção intacta");

  db.hook = null;
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: 7202, payment_id: 9002, amount: 3, status: "approved" }, { status: 201 })
  );
  assert.equal((await reconciliar(db, session)).status, 200);
  assert.equal((await intencao(db)).status, "CONFIRMADO");
});

test("M2: GET de troca valida os identificadores", async t => {
  const { db } = await exchangeScenario(t);
  const session = await app.auth.createSession(db, 1);
  const r = await getRota(
    app.adminItemExchange,
    db,
    session,
    "/api/admin/pedidos/x/itens/1/trocas",
    { id: "x", itemId: "1" }
  );
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "ID_INVALIDO");
});
