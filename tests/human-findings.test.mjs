import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {app, fixture} from './helpers/b3.mjs';

const utilitiesBundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      export * from './shared/whatsapp';
      export * from './src/lib/brl';
      export * from './src/admin/Loja/scheduleText';
      export {statusLabel} from './src/admin/Pedidos/AdminPedidos';
    `,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: {'.css': 'empty'},
});
const utilities = await import(
  `data:text/javascript;base64,${Buffer.from(utilitiesBundle.outputFiles[0].text).toString('base64')}`
);

const cookieDe = session => session.cookie.split(';')[0];
const adminRequest = (session, body) => new Request('https://local.test/api/admin/pedidos', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
  body: JSON.stringify({
    itens: [{produtoId: 1, quantidade: 1}],
    clienteNome: 'Cliente Humano',
    clienteWhatsapp: '(11) 99999-9999',
    metodoPagamento: 'DINHEIRO',
    statusPagamento: 'PENDENTE',
    operationKey: 'human-53-admin-0000-4000-800000000001',
    ...body,
  }),
});

async function cleanFixture(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=20, estoque_reservado=0 WHERE id=1').run();
  return {db, session: await app.auth.createSession(db, 1)};
}

async function list(db, session, status = 'todos') {
  const response = await app.adminCreate.onRequestGet({
    env: {DB: db},
    request: new Request(`https://local.test/api/admin/pedidos?status=${status}`, {
      headers: {Cookie: cookieDe(session)},
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('HUMAN-02/05: NOVO é canônico e só ação explícita inicia produção', async t => {
  const {db, session} = await cleanFixture(t);
  const createdResponse = await app.adminCreate.onRequestPost({
    env: {DB: db}, request: adminRequest(session, {}),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  let row = await db.prepare('SELECT status_pedido, status_pagamento FROM pedidos WHERE id=?')
    .bind(created.pedidoId).first();
  assert.deepEqual(row, {status_pedido: 'NOVO', status_pagamento: 'PENDENTE'});

  let listing = await list(db, session);
  assert.equal(listing.pedidos[0].status_pedido, 'NOVO');
  assert.equal(listing.counts.novos, 1);
  assert.equal(listing.counts.em_producao, 0);
  assert.equal((await list(db, session, 'novos')).total, 1);
  assert.equal((await list(db, session, 'em_producao')).total, 0);
  assert.equal(utilities.statusLabel('NOVO'), 'Novo');

  const transition = await app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: String(created.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({statusPedido: 'PREPARANDO'}),
    }),
  });
  assert.equal(transition.status, 200);
  listing = await list(db, session);
  assert.equal(listing.pedidos[0].status_pedido, 'PREPARANDO');
  assert.equal(listing.counts.novos, 0);
  assert.equal(listing.counts.em_producao, 1);
  assert.equal(utilities.statusLabel('PREPARANDO'), 'Em produção');

  const cancel = await app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: String(created.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({statusPedido: 'CANCELADO'}),
    }),
  });
  assert.equal(cancel.status, 200);
  listing = await list(db, session);
  assert.equal(listing.pedidos[0].status_pedido, 'CANCELADO');
  assert.equal(listing.counts.em_producao, 0);
  assert.equal(utilities.statusLabel('CANCELADO'), 'Cancelado');
});

test('HUMAN-04: WhatsApp manual é validado antes de persistir e salvo canônico', async t => {
  const {db, session} = await cleanFixture(t);
  const invalid = await app.adminCreate.onRequestPost({
    env: {DB: db},
    request: adminRequest(session, {
      clienteWhatsapp: '23523423423423423dfvsdfds',
      operationKey: 'human-53-admin-0000-4000-800000000002',
    }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /WhatsApp/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 0);

  const valid = await app.adminCreate.onRequestPost({
    env: {DB: db}, request: adminRequest(session, {}),
  });
  assert.equal(valid.status, 201);
  const created = await valid.json();
  const row = await db.prepare('SELECT cliente_whatsapp FROM pedidos WHERE id=?')
    .bind(created.pedidoId).first();
  assert.equal(row.cliente_whatsapp, '11999999999');
});

test('HUMAN-04: checkout usa a mesma validação e normalização de WhatsApp', async t => {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  const invalid = await app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 1}],
        cliente: {nome: 'Cliente', whatsapp: 'abc'},
        operationKey: 'human-53-site-0000-4000-800000000001',
      }),
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 0);

  t.mock.method(globalThis, 'fetch', async () => Response.json({
    id: 53001,
    status: 'pending',
    date_of_expiration: '2099-01-01T00:00:00Z',
    point_of_interaction: {transaction_data: {qr_code: 'qr'}},
  }));
  const valid = await app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 1}],
        cliente: {nome: 'Cliente', whatsapp: '(11) 3333-4444'},
        operationKey: 'human-53-site-0000-4000-800000000002',
      }),
    }),
  });
  assert.equal(valid.status, 200);
  const row = await db.prepare('SELECT cliente_whatsapp, status_pedido FROM pedidos').first();
  assert.deepEqual(row, {cliente_whatsapp: '1133334444', status_pedido: 'NOVO'});
});

test('HUMAN-04/07/13: formatadores são determinísticos e sem ambiguidade', () => {
  assert.equal(utilities.formatWhatsappBr('11a99999-9999xyz'), '(11) 99999-9999');
  assert.equal(utilities.normalizeWhatsappBr('(11) 99999-9999'), '11999999999');
  assert.equal(utilities.isValidWhatsappBr('11999999999'), true);
  assert.equal(utilities.isValidWhatsappBr('1133334444'), true);
  assert.equal(utilities.isValidWhatsappBr('000'), false);
  assert.equal(utilities.isValidWhatsappBr('11999999999123'), false);

  assert.equal(utilities.formatBrlInput('20,00'), '20,00');
  assert.equal(utilities.formatBrlInput('1.250,50'), '1.250,50');
  assert.equal(utilities.formatBrlInput('363563t34534dfrg'), '363.563.345,34');
  assert.equal(utilities.parseBrlInputToCents('1.250,50'), 125050);
  assert.equal(utilities.parseBrlInputToCents('12.34'), null);

  const allDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    .map(label => ({label, active: true}));
  assert.equal(
    utilities.formatScheduleText(allDays, '09:00', '20:00'),
    'Todos os dias: 09h00 às 20h00',
  );
  allDays[0].active = false;
  assert.equal(
    utilities.formatScheduleText(allDays, '09:00', '20:00'),
    'Ter a Dom: 09h00 às 20h00',
  );
});
