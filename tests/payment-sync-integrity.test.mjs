import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

const validPayment = {
  id: 101,
  status: 'approved',
  transaction_amount: 100,
  payment_method_id: 'pix',
  external_reference: 'token',
  currency_id: 'BRL',
};

function mercadoPago(t, payment) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.mercadopago.com/v1/payments/101');
    assert.equal(options.headers.Authorization, 'Bearer fake');
    return Response.json(payment);
  });
}

async function sincronizar(db) {
  const payment = await app.sync.fetchMpPayment('fake', '101');
  return app.sync.syncPaymentFromMp(db, 1, payment);
}

async function detalheAdmin(db) {
  const session = await app.auth.createSession(db, 1);
  const response = await app.adminOrder.onRequestGet({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      headers: {Cookie: session.cookie.split(';')[0]},
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function assertBlocked(snapshot, diagnostic) {
  assert.equal(snapshot.pagamentos[0].status, 'PENDENTE');
  assert.equal(snapshot.pagamentos[0].mp_status, 'approved');
  assert.equal(snapshot.pagamentos[0].mp_status_detail, diagnostic);
  assert.equal(snapshot.pedido.status_pagamento, 'PENDENTE');
  assert.equal(snapshot.pedido.reserva_status, 'ATIVA');
  assert.equal(snapshot.pedido.estoque_baixado_em, null);
  assert.equal(snapshot.produtos[0].estoque, 10);
  assert.equal(snapshot.produtos[0].estoque_reservado, 2);
  assert.equal(snapshot.itens[0].estoque_estado, 'RESERVADO');
  assert.equal(snapshot.refunds.length, 0);
}

async function vencerReserva(db) {
  await db.prepare(
    `UPDATE pedidos
     SET reserva_expira_em = '2000-01-01T00:00:00Z', pix_expira_em = '2000-01-01T00:00:00Z'
     WHERE id = 1`,
  ).run();
  await db.prepare(
    `UPDATE pedido_pagamentos
     SET pix_expira_em = '2000-01-01T00:00:00Z', atualizado_em = datetime('now', '-1 minute')
     WHERE id = 1`,
  ).run();
}

test('bloqueia approved de R$ 0,01 para um pagamento local de R$ 100,00', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});

  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PENDENTE', transicionou: false});
  assertBlocked(await state(db), 'INTEGRIDADE_MP:VALOR_DIVERGENTE');

  mercadoPago(t, validPayment);
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PAGO', transicionou: true});
  assert.equal((await state(db)).produtos[0].estoque, 8);
});

test('bloqueia approved com valor correto e método diferente de Pix', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, payment_method_id: 'credit_card'});

  await sincronizar(db);
  assertBlocked(await state(db), 'INTEGRIDADE_MP:METODO_DIVERGENTE');
});

test('bloqueia approved cuja referência externa não identifica a tentativa local', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, external_reference: 'outro-pedido'});

  await sincronizar(db);
  assertBlocked(await state(db), 'INTEGRIDADE_MP:REFERENCIA_DIVERGENTE');
});

test('valor, método, referência e moeda corretos preservam a confirmação normal', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: '100.00'});

  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PAGO', transicionou: true});
  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'PAGO');
  assert.equal(snapshot.pedido.status_pagamento, 'PAGO');
  assert.equal(snapshot.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(snapshot.produtos[0].estoque, 8);
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.itens[0].estoque_estado, 'BAIXADO');
});

test('webhook duplicado e sincronização repetida confirmam e baixam estoque uma vez', async t => {
  const db = await fixture(t);
  const fetch = mercadoPago(t, validPayment);
  const secret = 'integrity-local-only';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'],
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode('id:101;request-id:integrity;ts:1;'),
  )).toString('hex');
  const webhook = () => app.webhook.onRequestPost({
    request: new Request('https://local.test/api/webhooks/mercadopago?data.id=101&type=payment', {
      method: 'POST',
      headers: {'x-signature': `ts=1,v1=${signature}`, 'x-request-id': 'integrity'},
    }),
    env: {DB: db, MP_ACCESS_TOKEN: 'fake', MP_WEBHOOK_SECRET: secret},
  });

  assert.equal((await webhook()).status, 200);
  assert.equal((await webhook()).status, 200);
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PAGO', transicionou: false});
  assert.equal(fetch.mock.callCount(), 3);

  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'PAGO');
  assert.equal(snapshot.produtos[0].estoque, 8);
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.itens[0].estoque_estado, 'BAIXADO');
});

for (const [label, payment] of [
  ['valor ausente', {...validPayment, transaction_amount: undefined}],
  ['valor não numérico', {...validPayment, transaction_amount: 'cem'}],
]) test(`bloqueia resposta approved com ${label}`, async t => {
  const db = await fixture(t);
  mercadoPago(t, payment);

  await sincronizar(db);
  assertBlocked(await state(db), 'INTEGRIDADE_MP:VALOR_INVALIDO');
});

test('bloqueia approved em moeda diferente de BRL', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, currency_id: 'USD'});

  await sincronizar(db);
  assertBlocked(await state(db), 'INTEGRIDADE_MP:MOEDA_DIVERGENTE');
});

for (const [label, expirar] of [
  ['expiracao direta', db => app.sync.expireLocalPayment(db, 1)],
  ['sweep de reservas vencidas', db => app.sync.liberarReservasVencidasLocalmente({DB: db})],
]) test(`${label} nao libera approved remoto com integridade divergente`, async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);
  await vencerReserva(db);

  await expirar(db);

  assertBlocked(await state(db), 'INTEGRIDADE_MP:VALOR_DIVERGENTE');
});

test('trava estruturada impede liberacao mesmo se a expiracao venceu a corrida de status', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);
  await db.prepare("UPDATE pedido_pagamentos SET status = 'EXPIRADO' WHERE id = 1").run();

  assert.deepEqual(await app.stock.liberarReservaPedido(db, 1), {ok: true, liberado: false});
  const snapshot = await state(db);
  assert.equal(snapshot.pedido.reserva_status, 'ATIVA');
  assert.equal(snapshot.produtos[0].estoque_reservado, 2);
  assert.equal(snapshot.itens[0].estoque_estado, 'RESERVADO');
});

test('divergencia permanece bloqueada enquanto GET autenticado continua pending', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);

  mercadoPago(t, {...validPayment, status: 'pending'});
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PENDENTE', transicionou: false});
  await vencerReserva(db);
  await app.sync.expireLocalPayment(db, 1);

  assertBlocked(await state(db), 'INTEGRIDADE_MP:VALOR_DIVERGENTE');
});

test('legacy REEMBOLSADO com mp_status approved nao vira divergencia nem bloqueia estoque', async t => {
  const db = await fixture(t, {ledger: false});
  await db.prepare(
    "UPDATE pedidos SET status_pagamento = 'REEMBOLSADO', mp_status = 'approved' WHERE id = 1",
  ).run();

  assert.equal((await app.ledger.ensureLegacyPaymentMaterialized(db, 1)).materialized, true);
  const pagamento = await db.prepare('SELECT status, mp_status FROM pedido_pagamentos WHERE pedido_id = 1').first();
  assert.deepEqual(pagamento, {status: 'REEMBOLSADO', mp_status: 'approved'});
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);

  assert.deepEqual(await app.stock.liberarReservaPedido(db, 1), {ok: true, liberado: true});
  const snapshot = await state(db);
  assert.equal(snapshot.pedido.reserva_status, 'LIBERADA');
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.deepEqual((await detalheAdmin(db)).operacoesInconclusivas, []);
});

for (const status of ['cancelled', 'rejected']) test(
  `GET autenticado ${status} resolve divergencia de valor como tentativa sem captura`,
  async t => {
    const db = await fixture(t);
    mercadoPago(t, {...validPayment, transaction_amount: 0.01});
    await sincronizar(db);

    mercadoPago(t, {...validPayment, status, transaction_amount: 0.01});
    assert.deepEqual(await sincronizar(db), {ok: true, status: 'CANCELADO', transicionou: true});

    const snapshot = await state(db);
    assert.equal(snapshot.pagamentos[0].status, 'CANCELADO');
    assert.equal(snapshot.pagamentos[0].mp_status, status);
    assert.equal(snapshot.pedido.reserva_status, 'LIBERADA');
    assert.equal(snapshot.produtos[0].estoque_reservado, 0);
    assert.equal(snapshot.itens[0].estoque_estado, 'LIBERADO');
    assert.equal(snapshot.refunds.length, 0);
    assert.deepEqual((await detalheAdmin(db)).operacoesInconclusivas, []);
  },
);

test('estado terminal sem identidade financeira coerente nao encerra a divergencia', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);

  mercadoPago(t, {
    ...validPayment,
    status: 'cancelled',
    transaction_amount: 0.01,
    external_reference: 'outra-tentativa',
  });
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PENDENTE', transicionou: false});
  assertBlocked(await state(db), 'INTEGRIDADE_MP:VALOR_DIVERGENTE');
});

test('approved legitimo concorrente vence resolucao cancelled sem liberar estoque', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);

  mercadoPago(t, {...validPayment, status: 'cancelled', transaction_amount: 0.01});
  const cancelado = await app.sync.fetchMpPayment('fake', '101');
  mercadoPago(t, validPayment);
  const aprovado = await app.sync.fetchMpPayment('fake', '101');
  let chegou;
  let liberar;
  const barreira = new Promise(resolve => { chegou = resolve; });
  const continuar = new Promise(resolve => { liberar = resolve; });

  db.hook = async (statements, operation) => {
    if (operation === 'run' && statements.some(statement =>
      statement.args.includes('INTEGRIDADE_MP:RESOLVIDA_SEM_CAPTURA'))
    ) {
      db.hook = null;
      chegou();
      await continuar;
    }
    return statements;
  };

  const cancelando = app.sync.syncPaymentFromMp(db, 1, cancelado);
  await Promise.race([
    barreira,
    cancelando.then(() => { throw new Error('resolucao nao alcancou a barreira'); }),
  ]);
  assert.deepEqual(
    await app.sync.syncPaymentFromMp(db, 1, aprovado),
    {ok: true, status: 'PAGO', transicionou: true},
  );
  liberar();
  assert.deepEqual(await cancelando, {ok: true, status: 'PAGO', transicionou: false});

  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'PAGO');
  assert.equal(snapshot.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(snapshot.produtos[0].estoque, 8);
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.itens[0].estoque_estado, 'BAIXADO');
});

test('GET refunded reconhece captura devolvida antes de liberar e mantem aviso deduplicado', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);

  mercadoPago(t, {...validPayment, status: 'refunded', transaction_amount: 0.01});
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'REEMBOLSADO', transicionou: true});
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'REEMBOLSADO', transicionou: false});
  await vencerReserva(db);
  await app.sync.expireLocalPayment(db, 1);

  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'REEMBOLSADO');
  assert.equal(snapshot.pagamentos[0].mp_status, 'refunded');
  assert.equal(snapshot.pagamentos[0].mp_status_detail, 'INTEGRIDADE_MP:REFUNDED_RECONHECIDO');
  assert.equal(snapshot.pedido.reserva_status, 'LIBERADA');
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.refunds.length, 0, 'status remoto nao inventa reembolso local');
  const avisos = (await detalheAdmin(db)).operacoesInconclusivas;
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, 'PIX_MP_INTEGRIDADE');
  assert.equal(avisos[0].diagnostico, 'INTEGRIDADE_MP:REFUNDED_RECONHECIDO');
});

test('PAGO refunded so deixa de alertar quando reembolso local integral ja esta contabilizado', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  mercadoPago(t, {...validPayment, status: 'refunded'});
  await sincronizar(db);
  assert.equal((await detalheAdmin(db)).operacoesInconclusivas.length, 1);

  assert.equal((await app.ledger.registerManualRefund(db, {
    pedidoId: 1,
    pagamentoId: 1,
    valorCentavos: 10000,
    usuarioId: 1,
  })).ok, true);
  assert.deepEqual((await detalheAdmin(db)).operacoesInconclusivas, []);

  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'PAGO');
  assert.equal(snapshot.refunds.length, 1);
  assert.equal(snapshot.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(snapshot.produtos[0].estoque, 10);
});

test('webhook divergente entre expiracao e batch de liberacao preserva reserva e reconcilia depois', async t => {
  const db = await fixture(t);
  await vencerReserva(db);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  let sincronizouNaBarreira = false;

  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements.some(statement =>
      statement.sql.includes('estoque_reservado = estoque_reservado -'))
    ) {
      db.hook = null;
      await sincronizar(db);
      sincronizouNaBarreira = true;
    }
    return statements;
  };

  await app.sync.expireLocalPayment(db, 1);

  assert.equal(sincronizouNaBarreira, true);
  let snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, 'EXPIRADO');
  assert.equal(snapshot.pagamentos[0].mp_status, 'approved');
  assert.equal(snapshot.pedido.reserva_status, 'ATIVA');
  assert.equal(snapshot.produtos[0].estoque_reservado, 2);
  assert.equal(snapshot.itens[0].estoque_estado, 'RESERVADO');

  mercadoPago(t, validPayment);
  assert.deepEqual(await sincronizar(db), {ok: true, status: 'PAGO', transicionou: true});
  snapshot = await state(db);
  assert.equal(snapshot.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(snapshot.produtos[0].estoque, 8);
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.itens[0].estoque_estado, 'BAIXADO');
});

test('resposta pending tardia do POST nao apaga approved divergente recebido por webhook', async t => {
  const db = await fixture(t, {ledger: false});
  await db.prepare('DELETE FROM pedidos WHERE id = 1').run();
  await db.prepare('UPDATE produtos SET estoque_reservado = 0 WHERE id = 1').run();
  const secret = 'integrity-post-race';
  let externalReference;

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      externalReference = JSON.parse(options.body).external_reference;
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'],
      );
      const signature = Buffer.from(await crypto.subtle.sign(
        'HMAC', key, new TextEncoder().encode('id:101;request-id:post-race;ts:1;'),
      )).toString('hex');
      const webhook = await app.webhook.onRequestPost({
        env: {DB: db, MP_ACCESS_TOKEN: 'fake', MP_WEBHOOK_SECRET: secret},
        request: new Request('https://local.test/api/webhooks/mercadopago?data.id=101&type=payment', {
          method: 'POST',
          headers: {'x-signature': `ts=1,v1=${signature}`, 'x-request-id': 'post-race'},
        }),
      });
      assert.equal(webhook.status, 200);
      return Response.json({
        id: 101,
        status: 'pending',
        date_of_expiration: '2099-01-01T00:00:00Z',
        point_of_interaction: {transaction_data: {qr_code: 'pix-101'}},
      });
    }
    return Response.json({...validPayment, transaction_amount: 0.01, external_reference: externalReference});
  });

  const response = await app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 2}],
        cliente: {nome: 'Teste', whatsapp: '11999999999'},
        operationKey: 'integrity-post-race-key',
      }),
    }),
  });

  assert.equal(response.status, 200);
  const checkout = await response.json();
  const pagamento = await db.prepare(
    'SELECT id, pedido_id, mp_status, mp_status_detail FROM pedido_pagamentos',
  ).first();
  assert.equal(pagamento.mp_status, 'approved');
  assert.equal(pagamento.mp_status_detail, 'INTEGRIDADE_MP:VALOR_DIVERGENTE');
  assert.equal(pagamento.pedido_id, checkout.pedidoId);
  await db.prepare(
    "UPDATE pedidos SET reserva_expira_em = '2000-01-01T00:00:00Z' WHERE id = ?",
  ).bind(checkout.pedidoId).run();
  await app.sync.expireLocalPayment(db, pagamento.id);
  assert.equal((await db.prepare('SELECT status FROM pedido_pagamentos WHERE id = ?')
    .bind(pagamento.id).first()).status, 'PENDENTE');
  assert.equal((await db.prepare('SELECT reserva_status FROM pedidos WHERE id = ?')
    .bind(checkout.pedidoId).first()).reserva_status, 'ATIVA');
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id = 1')
    .first()).estoque_reservado, 2);
});

test('expiracao normal de Pix nao pago continua liberando a reserva', async t => {
  const db = await fixture(t);
  await vencerReserva(db);

  assert.deepEqual(
    await app.sync.expireLocalPayment(db, 1),
    {ok: true, status: 'EXPIRADO', transicionou: true},
  );
  const snapshot = await state(db);
  assert.equal(snapshot.pedido.reserva_status, 'LIBERADA');
  assert.equal(snapshot.produtos[0].estoque, 10);
  assert.equal(snapshot.produtos[0].estoque_reservado, 0);
  assert.equal(snapshot.itens[0].estoque_estado, 'LIBERADO');
});

test('detalhe admin expoe aprovacao remota divergente para intervencao humana', async t => {
  const db = await fixture(t);
  mercadoPago(t, {...validPayment, transaction_amount: 0.01});
  await sincronizar(db);
  const session = await app.auth.createSession(db, 1);

  const response = await app.adminOrder.onRequestGet({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      headers: {Cookie: session.cookie.split(';')[0]},
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.operacoesInconclusivas, [{
    tipo: 'PIX_MP_INTEGRIDADE',
    diagnostico: 'INTEGRIDADE_MP:VALOR_DIVERGENTE',
    atualizadoEm: body.operacoesInconclusivas[0].atualizadoEm,
  }]);
});
