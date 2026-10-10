import { mpResponse } from "./helpers/mp-orders.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";

const env = db => ({ DB: db, MP_ACCESS_TOKEN: "fake_mp_token" });

for (const remoteStatus of ["pending", "approved", "cancelled"]) {
  test(`R3: regeneration is suspended without observing or mutating a ${remoteStatus} predecessor`, async t => {
    const db = await fixture(t, { ledger: false });
    t.mock.method(globalThis, "fetch", async () =>
      mpResponse({ id: 101, status: "pending", date_of_expiration: "2099-01-01" })
    );
    const a = await app.pix.createAdminPixCharge(env(db), {
      pedidoId: 1,
      usuarioId: 1,
      valorCentavos: 5000,
      operationKey: "op-init-suspended"
    });
    assert.equal(a.ok, true);
    const before = await state(db);
    let remoteCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      remoteCalls++;
      return mpResponse({ id: 101, status: remoteStatus });
    });

    const result = await app.pix.createAdminPixCharge(env(db), {
      pedidoId: 1,
      usuarioId: 1,
      valorCentavos: 5000,
      substituiId: a.pagamentoId,
      operationKey: "op-regen-suspended"
    });
    assert.deepEqual(result, { ok: false, erro: "PIX_REGENERACAO_SUSPENSA" });
    assert.equal(remoteCalls, 0, "no GET, cancellation or successor POST");
    const after = await state(db);
    assert.deepEqual(after.pagamentos, before.pagamentos);
    assert.deepEqual(after.produtos, before.produtos);
    assert.deepEqual(after.itens, before.itens);
    assert.deepEqual(after.pedido, before.pedido);
    const claim = after.operacoes.find(o => o.operation_key === "op-regen-suspended");
    assert.equal(claim.fase, "RECUSADA");
    assert.equal(claim.erro, "PIX_REGENERACAO_SUSPENSA");
    assert.equal(claim.pagamento_id, a.pagamentoId);
    assert.equal(claim.mp_payment_id, null);
  });
}

test("R3 - D: webhook cancelled de A durante LOCAL_CRIADA -> reserva NÃO liberada", async t => {
  const db = await fixture(t, { ledger: false });
  t.mock.method(globalThis, "fetch", async () => mpResponse({ id: 101, status: "pending" }));

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 10000,
    operationKey: "op-init-d"
  });
  assert.equal(a.ok, true);

  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, pedido_id, pagamento_id
      ) VALUES ('op-regen-active', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'LOCAL_CRIADA', 'mp-k', 1, ?)`
    )
    .bind(a.pagamentoId)
    .run();

  t.mock.method(globalThis, "fetch", async () => mpResponse({ id: 101, status: "cancelled" }));
  const paymentA = await app.sync.fetchMpPayment("fake", "ORD101");
  await app.sync.syncPaymentFromMp(db, a.pagamentoId, paymentA);

  const s = await state(db);
  const pagA = s.pagamentos.find(p => p.id === a.pagamentoId);
  assert.equal(pagA.status, "CANCELADO");
  assert.equal(s.pedido.reserva_status, "ATIVA");
  assert.equal(s.produtos[0].estoque_reservado, 2);
});

test("R3 - E: duas regenerações simultâneas com operationKeys diferentes -> somente uma adquire o claim; somente uma pode tocar no Mercado Pago", async t => {
  const db = await fixture(t, { ledger: false });
  let mpCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    mpCalls++;
    if (options?.method === "POST" && !String(url).endsWith("/cancel")) {
      return mpResponse({
        id: 101 + mpCalls,
        status: "pending",
        date_of_expiration: "2099-01-01"
      });
    }
    if (String(url).endsWith("/cancel")) {
      return mpResponse({ id: 101, status: "cancelled" });
    }
    return mpResponse({ id: 101, status: "pending" });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: "op-init-e"
  });
  assert.equal(a.ok, true);

  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, pedido_id, pagamento_id
      ) VALUES ('op-first', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'LOCAL_CRIADA', 'mp-k', 1, ?)`
    )
    .bind(a.pagamentoId)
    .run();

  const callsBefore = mpCalls;
  const res2 = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: "op-second"
  });

  assert.equal(res2.ok, false);
  assert.equal(res2.erro, "OPERACAO_EM_PROCESSAMENTO");
  assert.equal(mpCalls, callsBefore);
});

test("R3 - F: a historical successor makes A ineligible without another provider call", async t => {
  const db = await fixture(t, { ledger: false });
  let mpCalls = 0;
  let canceled = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    mpCalls++;
    const urlStr = String(url);
    if (options?.method === "POST" && !String(url).endsWith("/cancel")) {
      return mpResponse({
        id: 100 + mpCalls,
        status: "pending",
        date_of_expiration: "2099-01-01",
        point_of_interaction: {
          transaction_data: { qr_code: "qr-x", qr_code_base64: "b64", ticket_url: "url" }
        }
      });
    }
    const paymentId = Number(
      urlStr
        .replace(/\/cancel$/, "")
        .split("/")
        .at(-1)
        .replace(/^ORD/, "")
    );
    if (String(url).endsWith("/cancel")) {
      canceled = true;
      return mpResponse({ id: paymentId, status: "cancelled" });
    }
    return mpResponse({ id: paymentId, status: canceled ? "cancelled" : "pending" });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: "op-init-f"
  });
  assert.equal(a.ok, true);

  // State left by a completed regeneration before dispatch was suspended.
  await db.batch([
    db.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=?").bind(a.pagamentoId),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,
           mp_order_id,mp_payment_id,substitui_pagamento_id,idempotency_key)
         VALUES(1,'PIX_MP','ADMIN',5000,'PENDENTE','ORD999','PAY999',?,'historical-successor')`
      )
      .bind(a.pagamentoId)
  ]);

  const callsAfterX = mpCalls;

  const y = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: "op-y-12345"
  });

  assert.equal(y.ok, false);
  assert.equal(y.erro, "PIX_PARA_SUBSTITUIR_INVALIDO");
  assert.equal(mpCalls, callsAfterX);
});

test("R3 - G: operação com expirado_em preenchido -> não mantém hold de estoque", async t => {
  const db = await fixture(t, { ledger: false });
  t.mock.method(globalThis, "fetch", async () => mpResponse({ id: 101, status: "pending" }));

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 10000,
    operationKey: "op-init-g"
  });
  assert.equal(a.ok, true);

  await db
    .prepare("UPDATE pedido_pagamentos SET status = 'CANCELADO' WHERE id = ?")
    .bind(a.pagamentoId)
    .run();

  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, pedido_id, pagamento_id, expirado_em
      ) VALUES ('op-regen-exp', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'ENVIO_INCONCLUSIVO', 'mp-k', 1, ?, datetime('now', '-10 minutes'))`
    )
    .bind(a.pagamentoId)
    .run();

  const liberacao = await app.stock.liberarReservaPedido(db, 1);
  assert.equal(liberacao.ok, true);

  const s = await state(db);
  assert.equal(s.pedido.reserva_status, "LIBERADA");
  assert.equal(s.produtos[0].estoque_reservado, 0);
});

test("R3 - H: B criado remotamente e persistência local falha -> recovery encontra B sem criar outro payment", async t => {
  const db = await fixture(t, { ledger: false });
  let postCount = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options?.method === "POST" && !String(url).endsWith("/cancel")) {
      postCount++;
      return mpResponse({
        id: 202,
        status: "pending",
        date_of_expiration: "2099-01-01T00:00:00Z",
        point_of_interaction: {
          transaction_data: { qr_code: "qr-b", qr_code_base64: "b64-b", ticket_url: "url-b" }
        }
      });
    }
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders?")) {
      return mpResponse({
        results: [
          {
            id: 202,
            status: "pending",
            external_reference: "ee211f5f4691b8a8e4c66a2db1a6f2bbb9ec16c21000ca83212b136ff57fd1ea"
          }
        ]
      });
    }
    if (urlStr.includes("/v1/orders/ORD202")) {
      return mpResponse({
        id: 202,
        status: "pending",
        date_of_expiration: "2099-01-01T00:00:00Z",
        external_reference: "ee211f5f4691b8a8e4c66a2db1a6f2bbb9ec16c21000ca83212b136ff57fd1ea",
        transaction_amount: 50.0,
        payment_method_id: "pix",
        point_of_interaction: {
          transaction_data: { qr_code: "qr-b", qr_code_base64: "b64-b", ticket_url: "url-b" }
        }
      });
    }
    return mpResponse({ id: 101, status: "pending" });
  });

  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PENDENTE', 'PAY101', 'ORD101')`
    )
    .run();

  const mpRequest = {
    transaction_amount: 50.0,
    description: "Pedido R&P Doces",
    payment_method_id: "pix",
    date_of_expiration: "2099-01-01T00:00:00Z",
    external_reference: "ee211f5f4691b8a8e4c66a2db1a6f2bbb9ec16c21000ca83212b136ff57fd1ea",
    payer: { email: "cliente@checkout.rpdoces.com.br", first_name: "Cliente" }
  };
  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, mp_request, pedido_id, pagamento_id, atualizado_em
      ) VALUES (
        'op-regen-h', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp',
        'ENVIO_INCONCLUSIVO', 'mp-k', ?, 1, 1, datetime('now', '-70 seconds')
      )`
    )
    .bind(JSON.stringify(mpRequest))
    .run();

  const postsBeforeRecovery = postCount;
  await app.paymentSync.recuperarOperacoesInconclusivas(env(db));

  assert.equal(postCount, postsBeforeRecovery);

  const s = await state(db);
  const pagA = s.pagamentos.find(p => p.id === 1);
  const pagB = s.pagamentos.find(p => p.idempotency_key === "a1:op-regen-h:pag");
  assert.ok(pagB, "Pagamento B deve ter sido persistido pelo recovery");
  assert.equal(pagB.mp_payment_id, "PAY202");
  assert.equal(pagB.status, "PENDENTE");
  assert.equal(pagA.status, "CANCELADO");

  const op = await db
    .prepare("SELECT * FROM pedido_operacoes WHERE operation_key = 'op-regen-h'")
    .first();
  assert.equal(op.fase, "REMOTO_CONHECIDO");
});

test("R3 - I: sobrepagamento: total 5000; líquido 10000; excessoCentavos 5000; temExcesso true", async t => {
  const db = await fixture(t, { ledger: false });
  await db.prepare("UPDATE pedidos SET valor_total_centavos = 5000 WHERE id = 1").run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', 'PAY101', 'ORD101'),
              (2, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', 'PAY102', 'ORD102')`
    )
    .run();

  const fin = await app.ledger.getFinanceiroPedido(db, 1);
  assert.equal(fin.totalCentavos, 5000);
  assert.equal(fin.liquidoCentavos, 10000);
  assert.equal(fin.excessoCentavos, 5000);
  assert.equal(fin.temExcesso, true);
});

test("R3 - J: após reembolso parcial de 5000: líquido 5000; excesso 0; temExcesso false", async t => {
  const db = await fixture(t, { ledger: false });
  await db.prepare("UPDATE pedidos SET valor_total_centavos = 5000 WHERE id = 1").run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', 'PAY101', 'ORD101'),
              (2, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', 'PAY102', 'ORD102')`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO pedido_reembolsos (pedido_id, pagamento_id, valor_centavos, status, registrado_por_usuario_id, origem, metodo, idempotency_key)
       VALUES (1, 1, 5000, 'REEMBOLSADO', 1, 'MANUAL', 'PIX_MP', 'refund-1')`
    )
    .run();

  const fin = await app.ledger.getFinanceiroPedido(db, 1);
  assert.equal(fin.totalCentavos, 5000);
  assert.equal(fin.liquidoCentavos, 5000);
  assert.equal(fin.excessoCentavos, 0);
  assert.equal(fin.temExcesso, false);
});

test("R3 - K: estoque continua baixado apenas uma vez", async t => {
  const db = await fixture(t, { ledger: false });
  await db
    .prepare(
      "UPDATE pedidos SET status_pedido = 'ENTREGUE', status_comanda = 'ENCERRADA', status_pagamento = 'PAGO' WHERE id = 1"
    )
    .run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 10000, 'PAGO', 'PAY101', 'ORD101')`
    )
    .run();

  const sInitial = await state(db);
  assert.equal(sInitial.produtos[0].estoque, 10);
  assert.equal(sInitial.produtos[0].estoque_reservado, 2);

  const r1 = await app.stock.baixarEstoquePedido(db, 1);
  assert.equal(r1.ok, true);

  const sAfter1 = await state(db);
  assert.equal(sAfter1.produtos[0].estoque, 8);
  assert.equal(sAfter1.produtos[0].estoque_reservado, 0);

  const r2 = await app.stock.baixarEstoquePedido(db, 1);
  assert.equal(r2.ok, true);

  const sAfter2 = await state(db);
  assert.equal(sAfter2.produtos[0].estoque, 8);
  assert.equal(sAfter2.produtos[0].estoque_reservado, 0);
});
