import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state } from './helpers/b3.mjs';

const env = (db) => ({ DB: db, MP_ACCESS_TOKEN: 'fake_mp_token' });

test('R3 - A: A pending -> cancelamento confirmado -> B criado', async (t) => {
  const db = await fixture(t, { ledger: false });
  let putCalled = false;
  let postCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      postCount++;
      return Response.json({
        id: 100 + postCount,
        status: 'pending',
        date_of_expiration: '2099-01-01T00:00:00Z',
        point_of_interaction: {
          transaction_data: { qr_code: 'qr-test', qr_code_base64: 'b64', ticket_url: 'url' },
        },
      });
    }
    if (options?.method === 'PUT') {
      putCalled = true;
      assert.equal(JSON.parse(options.body).status, 'cancelled');
      return Response.json({ id: 101, status: 'cancelled' });
    }
    return Response.json({ id: 101, status: 'pending' });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: 'op-init-a',
  });
  assert.equal(a.ok, true);

  const b = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-regen-b',
  });
  assert.equal(b.ok, true);
  assert.equal(putCalled, true);
  assert.equal(b.mpPaymentId, '102');

  const s = await state(db);
  const pagA = s.pagamentos.find((p) => p.id === a.pagamentoId);
  const pagB = s.pagamentos.find((p) => p.id === b.pagamentoId);
  assert.equal(pagA.status, 'CANCELADO');
  assert.equal(pagB.status, 'PENDENTE');
  assert.equal(pagB.substitui_pagamento_id, a.pagamentoId);

  const operacao = await db
    .prepare("SELECT * FROM pedido_operacoes WHERE operation_key = 'op-regen-b'")
    .first();
  assert.equal(operacao.fase, 'CONCLUIDA');
});

test('R3 - B: A approved antes da regeneração -> sincroniza -> B não criado', async (t) => {
  const db = await fixture(t, { ledger: false });
  let postCount = 0;
  let putCalled = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      postCount++;
      return Response.json({ id: 101, status: 'pending', date_of_expiration: '2099-01-01' });
    }
    if (options?.method === 'PUT') {
      putCalled = true;
      return Response.json({ id: 101, status: 'cancelled' });
    }
    return Response.json({ id: 101, status: 'approved', date_approved: '2026-09-23T15:00:00Z' });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: 'op-init-b',
  });
  assert.equal(a.ok, true);

  const b = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-regen-b-approved',
  });

  assert.equal(b.ok, false);
  assert.equal(b.erro, 'PIX_SUBSTITUTO_JA_PAGO');
  assert.equal(putCalled, false);
  assert.equal(postCount, 1);

  const s = await state(db);
  const pagA = s.pagamentos.find((p) => p.id === a.pagamentoId);
  assert.equal(pagA.status, 'PAGO');
  assert.equal(s.pagamentos.length, 1);
});

test('R3 - C: PUT cancelamento inconclusivo + reconsulta inconclusiva -> ENVIO_INCONCLUSIVO -> B não criado', async (t) => {
  const db = await fixture(t, { ledger: false });
  let postCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      postCount++;
      return Response.json({ id: 101, status: 'pending', date_of_expiration: '2099-01-01' });
    }
    if (options?.method === 'PUT') {
      return new Response('Internal Server Error', { status: 500 });
    }
    return Response.json({ id: 101, status: 'pending' });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: 'op-init-c',
  });
  assert.equal(a.ok, true);

  const b = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-regen-c-fail',
  });

  assert.equal(b.ok, false);
  assert.equal(b.erro, 'MERCADO_PAGO_INDISPONIVEL');
  assert.equal(postCount, 1);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);

  const operacao = await db
    .prepare("SELECT * FROM pedido_operacoes WHERE operation_key = 'op-regen-c-fail'")
    .first();
  assert.equal(operacao.fase, 'ENVIO_INCONCLUSIVO');
  assert.equal(operacao.expirado_em, null);
});

test('R3 - D: webhook cancelled de A durante LOCAL_CRIADA -> reserva NÃO liberada', async (t) => {
  const db = await fixture(t, { ledger: false });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 101, status: 'pending' }));

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 10000,
    operationKey: 'op-init-d',
  });
  assert.equal(a.ok, true);

  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, pedido_id, pagamento_id
      ) VALUES ('op-regen-active', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'LOCAL_CRIADA', 'mp-k', 1, ?)`,
    )
    .bind(a.pagamentoId)
    .run();

  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 101, status: 'cancelled' }));
  const paymentA = await app.sync.fetchMpPayment('fake', '101');
  await app.sync.syncPaymentFromMp(db, a.pagamentoId, paymentA);

  const s = await state(db);
  const pagA = s.pagamentos.find((p) => p.id === a.pagamentoId);
  assert.equal(pagA.status, 'CANCELADO');
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.produtos[0].estoque_reservado, 2);
});

test('R3 - E: duas regenerações simultâneas com operationKeys diferentes -> somente uma adquire o claim; somente uma pode tocar no Mercado Pago', async (t) => {
  const db = await fixture(t, { ledger: false });
  let mpCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    mpCalls++;
    if (options?.method === 'POST') {
      return Response.json({ id: 101 + mpCalls, status: 'pending', date_of_expiration: '2099-01-01' });
    }
    if (options?.method === 'PUT') {
      return Response.json({ id: 101, status: 'cancelled' });
    }
    return Response.json({ id: 101, status: 'pending' });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: 'op-init-e',
  });
  assert.equal(a.ok, true);

  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, pedido_id, pagamento_id
      ) VALUES ('op-first', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'LOCAL_CRIADA', 'mp-k', 1, ?)`,
    )
    .bind(a.pagamentoId)
    .run();

  const callsBefore = mpCalls;
  const res2 = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-second',
  });

  assert.equal(res2.ok, false);
  assert.equal(res2.erro, 'OPERACAO_EM_PROCESSAMENTO');
  assert.equal(mpCalls, callsBefore);
});

test('R3 - F: cenário TOCTOU: Y valida A como PENDENTE, X conclui regeneração, Y recheck pós-claim detecta A não elegível e NÃO toca no MP', async (t) => {
  const db = await fixture(t, { ledger: false });
  let mpCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    mpCalls++;
    const urlStr = String(url);
    if (options?.method === 'POST') {
      return Response.json({
        id: 100 + mpCalls,
        status: 'pending',
        date_of_expiration: '2099-01-01',
        point_of_interaction: {
          transaction_data: { qr_code: 'qr-x', qr_code_base64: 'b64', ticket_url: 'url' },
        },
      });
    }
    const paymentId = Number(urlStr.split('/').at(-1));
    if (options?.method === 'PUT') {
      return Response.json({ id: paymentId, status: 'cancelled' });
    }
    return Response.json({ id: paymentId, status: 'pending' });
  });

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    operationKey: 'op-init-f',
  });
  assert.equal(a.ok, true);

  const x = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-x-12345',
  });
  assert.equal(x.ok, true);

  const callsAfterX = mpCalls;

  const y = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 5000,
    substituiId: a.pagamentoId,
    operationKey: 'op-y-12345',
  });

  assert.equal(y.ok, false);
  assert.equal(y.erro, 'PIX_PARA_SUBSTITUIR_INVALIDO');
  assert.equal(mpCalls, callsAfterX);
});

test('R3 - G: operação com expirado_em preenchido -> não mantém hold de estoque', async (t) => {
  const db = await fixture(t, { ledger: false });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 101, status: 'pending' }));

  const a = await app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    usuarioId: 1,
    valorCentavos: 10000,
    operationKey: 'op-init-g',
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
      ) VALUES ('op-regen-exp', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp', 'ENVIO_INCONCLUSIVO', 'mp-k', 1, ?, datetime('now', '-10 minutes'))`,
    )
    .bind(a.pagamentoId)
    .run();

  const liberacao = await app.stock.liberarReservaPedido(db, 1);
  assert.equal(liberacao.ok, true);

  const s = await state(db);
  assert.equal(s.pedido.reserva_status, 'LIBERADA');
  assert.equal(s.produtos[0].estoque_reservado, 0);
});

test('R3 - H: B criado remotamente e persistência local falha -> recovery encontra B sem criar outro payment', async (t) => {
  const db = await fixture(t, { ledger: false });
  let postCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      postCount++;
      return Response.json({
        id: 202,
        status: 'pending',
        date_of_expiration: '2099-01-01T00:00:00Z',
        point_of_interaction: {
          transaction_data: { qr_code: 'qr-b', qr_code_base64: 'b64-b', ticket_url: 'url-b' },
        },
      });
    }
    const urlStr = String(url);
    if (urlStr.includes('/v1/payments/search')) {
      return Response.json({
        results: [{ id: 202, status: 'pending', external_reference: 'idemp-b-h' }],
      });
    }
    if (urlStr.includes('/v1/payments/202')) {
      return Response.json({
        id: 202,
        status: 'pending',
        date_of_expiration: '2099-01-01T00:00:00Z',
        external_reference: 'idemp-b-h',
        transaction_amount: 50.0,
        point_of_interaction: {
          transaction_data: { qr_code: 'qr-b', qr_code_base64: 'b64-b', ticket_url: 'url-b' },
        },
      });
    }
    return Response.json({ id: 101, status: 'pending' });
  });

  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PENDENTE', '101')`,
    )
    .run();

  const mpRequest = {
    transaction_amount: 50.0,
    description: 'Pedido R&P Doces',
    payment_method_id: 'pix',
    date_of_expiration: '2099-01-01T00:00:00Z',
    external_reference: 'idemp-b-h',
    payer: { email: 'cliente@checkout.rpdoces.com.br', first_name: 'Cliente' },
  };
  await db
    .prepare(
      `INSERT INTO pedido_operacoes (
        operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
        fase, mp_idempotency_key, mp_request, pedido_id, pagamento_id, atualizado_em
      ) VALUES (
        'op-regen-h', 'PIX_ADMIN_REGENERACAO', 'ADMIN', 1, 1, 'fp',
        'ENVIO_INCONCLUSIVO', 'mp-k', ?, 1, 1, datetime('now', '-70 seconds')
      )`,
    )
    .bind(JSON.stringify(mpRequest))
    .run();

  const postsBeforeRecovery = postCount;
  await app.paymentSync.recuperarOperacoesInconclusivas(env(db));

  assert.equal(postCount, postsBeforeRecovery);

  const s = await state(db);
  const pagA = s.pagamentos.find((p) => p.id === 1);
  const pagB = s.pagamentos.find((p) => p.idempotency_key === 'idemp-b-h');
  assert.ok(pagB, 'Pagamento B deve ter sido persistido pelo recovery');
  assert.equal(pagB.mp_payment_id, '202');
  assert.equal(pagB.status, 'PENDENTE');
  assert.equal(pagA.status, 'CANCELADO');

  const op = await db
    .prepare("SELECT * FROM pedido_operacoes WHERE operation_key = 'op-regen-h'")
    .first();
  assert.equal(op.fase, 'REMOTO_CONHECIDO');
});

test('R3 - I: sobrepagamento: total 5000; líquido 10000; excessoCentavos 5000; temExcesso true', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db.prepare('UPDATE pedidos SET valor_total_centavos = 5000 WHERE id = 1').run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', '101'),
              (2, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', '102')`,
    )
    .run();

  const fin = await app.ledger.getFinanceiroPedido(db, 1);
  assert.equal(fin.totalCentavos, 5000);
  assert.equal(fin.liquidoCentavos, 10000);
  assert.equal(fin.excessoCentavos, 5000);
  assert.equal(fin.temExcesso, true);
});

test('R3 - J: após reembolso parcial de 5000: líquido 5000; excesso 0; temExcesso false', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db.prepare('UPDATE pedidos SET valor_total_centavos = 5000 WHERE id = 1').run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', '101'),
              (2, 1, 'PIX_MP', 'ADMIN', 5000, 'PAGO', '102')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO pedido_reembolsos (pedido_id, pagamento_id, valor_centavos, status, registrado_por_usuario_id, origem, metodo, idempotency_key)
       VALUES (1, 1, 5000, 'REEMBOLSADO', 1, 'MANUAL', 'PIX_MP', 'refund-1')`,
    )
    .run();

  const fin = await app.ledger.getFinanceiroPedido(db, 1);
  assert.equal(fin.totalCentavos, 5000);
  assert.equal(fin.liquidoCentavos, 5000);
  assert.equal(fin.excessoCentavos, 0);
  assert.equal(fin.temExcesso, false);
});

test('R3 - K: estoque continua baixado apenas uma vez', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db
    .prepare("UPDATE pedidos SET status_pedido = 'ENTREGUE', status_comanda = 'ENCERRADA', status_pagamento = 'PAGO' WHERE id = 1")
    .run();
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos (id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id)
       VALUES (1, 1, 'PIX_MP', 'ADMIN', 10000, 'PAGO', '101')`,
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
