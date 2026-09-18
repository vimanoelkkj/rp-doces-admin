import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// Admin > Loja > Diagnósticos permanentes — "Pix real de diagnóstico" e
// "Pedido de produto de teste". Ambos são OWNER-only e ambos precisam ser
// estruturalmente incapazes de afetar pedidos, estoque, pagamentos ou
// métricas — os testes aqui existem para garantir exatamente isso.

const cookieDe = session => session.cookie.split(';')[0];

async function bancada(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
    VALUES(2,'Admin','admin','admin@example.invalid','unused','ADMIN')`).run();
  const owner = await app.auth.createSession(db, 1);
  const admin = await app.auth.createSession(db, 2);
  return {db, owner, admin};
}

function pixRequest(session, body = {operationKey: 'diag-op-0000001'}) {
  return new Request('https://local.test/api/admin/diagnosticos/pix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://local.test',
      ...(session ? {Cookie: cookieDe(session)} : {}),
    },
    body: JSON.stringify(body),
  });
}

function testeRequest(session) {
  return new Request('https://local.test/api/admin/diagnosticos/pedido-teste', {
    method: 'POST',
    headers: {
      Origin: 'https://local.test',
      ...(session ? {Cookie: cookieDe(session)} : {}),
    },
  });
}

const pixEnv = (db, token = 'fake-token') => ({DB: db, MP_ACCESS_TOKEN: token});

function mockMpSucesso(t) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.mercadopago.com/v1/payments');
    return Response.json({
      id: 555,
      status: 'pending',
      date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {
        transaction_data: {qr_code: '000201...copia-e-cola', qr_code_base64: 'base64img', ticket_url: 'https://mp.test/ticket'},
      },
    }, {status: 201});
  });
}

/* ─────────────────────────── Pix de diagnóstico ─────────────────────────── */

test('OWNER gera o Pix de diagnóstico com sucesso', async t => {
  const {db, owner} = await bancada(t);
  const mock = mockMpSucesso(t);

  const response = await app.diagnosticoPix.onRequestPost({request: pixRequest(owner), env: pixEnv(db)});
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.valorCentavos, 1);
  assert.equal(body.mpPaymentId, '555');
  assert.equal(body.qrCode, '000201...copia-e-cola');
  assert.equal(body.qrCodeBase64, 'base64img');
  assert.equal(body.ticketUrl, 'https://mp.test/ticket');
  assert.equal(body.expiresAt, '2099-01-01T00:00:00Z');

  // Exatamente 1 centavo enviado ao Mercado Pago.
  const [, options] = mock.mock.calls[0].arguments;
  const enviado = JSON.parse(options.body);
  assert.equal(enviado.transaction_amount, 0.01);
  assert.equal(enviado.payment_method_id, 'pix');
});

test('ADMIN recebe 403 ao tentar gerar o Pix de diagnóstico', async t => {
  const {db, admin} = await bancada(t);
  const response = await app.diagnosticoPix.onRequestPost({request: pixRequest(admin), env: pixEnv(db)});
  assert.equal(response.status, 403);
});

test('sem sessão recebe 401 no Pix de diagnóstico', async t => {
  const {db} = await bancada(t);
  const response = await app.diagnosticoPix.onRequestPost({request: pixRequest(null), env: pixEnv(db)});
  assert.equal(response.status, 401);
});

test('origem inválida é recusada antes de autenticar', async t => {
  const {db, owner} = await bancada(t);
  const request = new Request('https://local.test/api/admin/diagnosticos/pix', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: 'https://evil.test', Cookie: cookieDe(owner)},
    body: JSON.stringify({operationKey: 'diag-op-0000001'}),
  });
  const response = await app.diagnosticoPix.onRequestPost({request, env: pixEnv(db)});
  assert.equal(response.status, 403);
});

test('MP_ACCESS_TOKEN ausente nunca finge sucesso', async t => {
  const {db, owner} = await bancada(t);
  const response = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner), env: {DB: db},
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'MERCADO_PAGO_NAO_CONFIGURADO');
});

test('recusa definitiva do Mercado Pago vira erro explícito, nunca sucesso', async t => {
  const {db, owner} = await bancada(t);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({message: 'invalid parameter', cause: [{code: '123'}]}, {status: 400}));
  const response = await app.diagnosticoPix.onRequestPost({request: pixRequest(owner), env: pixEnv(db)});
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'MERCADO_PAGO_RECUSOU');
});

test('resultado ambíguo (timeout/transporte) nunca vira sucesso', async t => {
  const {db, owner} = await bancada(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const response = await app.diagnosticoPix.onRequestPost({request: pixRequest(owner), env: pixEnv(db)});
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'MERCADO_PAGO_INDISPONIVEL');
});

test('mesma operationKey em duas tentativas deriva a mesma X-Idempotency-Key', async t => {
  const {db, owner} = await bancada(t);
  const mock = mockMpSucesso(t);
  await app.diagnosticoPix.onRequestPost({request: pixRequest(owner, {operationKey: 'diag-op-0000002'}), env: pixEnv(db)});
  await app.diagnosticoPix.onRequestPost({request: pixRequest(owner, {operationKey: 'diag-op-0000002'}), env: pixEnv(db)});
  const chaves = mock.mock.calls.map(c => c.arguments[1].headers['X-Idempotency-Key']);
  assert.equal(chaves.length, 2);
  assert.equal(chaves[0], chaves[1], 'o provedor recebe a mesma key nas duas tentativas');
});

test('operationKey ausente ou inválida é rejeitada', async t => {
  const {db, owner} = await bancada(t);
  const response = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, {operationKey: 'curta'}), env: pixEnv(db),
  });
  assert.equal(response.status, 400);
});

test('Pix de diagnóstico nunca escreve em pedidos, pagamentos ou estoque', async t => {
  const {db, owner} = await bancada(t);
  mockMpSucesso(t);
  const antes = await state(db);
  await app.diagnosticoPix.onRequestPost({request: pixRequest(owner), env: pixEnv(db)});
  assert.deepEqual(await state(db), antes, 'nenhuma tabela de domínio foi tocada');
});

/* ─────────────────────────── Pedido de teste ─────────────────────────── */

test('OWNER dispara o pedido de teste com sucesso', async t => {
  const {db, owner} = await bancada(t);
  const response = await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(owner), env: {DB: db}});
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('ADMIN recebe 403 ao tentar disparar o pedido de teste', async t => {
  const {db, admin} = await bancada(t);
  const response = await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(admin), env: {DB: db}});
  assert.equal(response.status, 403);
});

test('sem sessão recebe 401 no pedido de teste', async t => {
  const {db} = await bancada(t);
  const response = await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(null), env: {DB: db}});
  assert.equal(response.status, 401);
});

test('pedido de teste nunca cria pedido real, nem altera estoque ou pagamento', async t => {
  const {db, owner} = await bancada(t);
  const antes = await state(db);
  const pedidosAntes = await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first();
  await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(owner), env: {DB: db}});
  assert.deepEqual(await state(db), antes, 'pedidos, itens, pagamentos e estoque intocados');

  const pedidosDepois = await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first();
  assert.equal(pedidosDepois.n, pedidosAntes.n, 'nenhum pedido, real ou fictício, foi criado');
});

test('pedido de teste aparece como notificação TESTE, com destino nulo', async t => {
  const {db, owner} = await bancada(t);
  await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(owner), env: {DB: db}});

  const {notificacoes} = await app.notificacoes.listarNotificacoes(db, 1);
  const evento = notificacoes.find(n => n.tipo === 'TESTE');
  assert.ok(evento, 'a notificação de teste é derivada do evento registrado');
  assert.equal(evento.destino, null, 'nunca aponta para um /admin/pedidos/:id inexistente');
  assert.match(evento.descricao, /simula/i);
});

test('disparos repetidos de teste não duplicam a mesma notificação por chave', async t => {
  const {db, owner} = await bancada(t);
  await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(owner), env: {DB: db}});
  await app.diagnosticoPedidoTeste.onRequestPost({request: testeRequest(owner), env: {DB: db}});

  const {notificacoes} = await app.notificacoes.listarNotificacoes(db, 1);
  const eventos = notificacoes.filter(n => n.tipo === 'TESTE');
  assert.equal(eventos.length, 2, 'cada disparo é um evento distinto, mas nenhum é um pedido');
  assert.notEqual(eventos[0].chave, eventos[1].chave);
});
