import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// M7: GET /api/pedido e GET /api/pedido-status são somente leitura. A
// recuperação do pagamento (Mercado Pago, expiração local, reconciliação) é
// o POST /api/pedido-status, e a consulta ao MP é limitada a uma por
// tentativa a cada 15s por um claim atômico em pedido_pagamentos.atualizado_em.
// Nenhum sleep: a passagem da janela é simulada movendo atualizado_em.

const env = db => ({DB: db, MP_ACCESS_TOKEN: 'fake'});
const ESCRITA_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

const getStatus = db => app.polling.onRequestGet({env: env(db),
  request: new Request('https://local.test/api/pedido-status?token=token')});
const getDetalhe = db => app.detail.onRequestGet({env: env(db),
  request: new Request('https://local.test/api/pedido?token=token')});
const postStatus = (db, headers = {Origin: 'https://local.test'}) => app.polling.onRequestPost({env: env(db),
  request: new Request('https://local.test/api/pedido-status?token=token', {method: 'POST', headers})});

// Janela de 15s já vencida para a tentativa: o próximo POST pode consultar o MP.
const abrirJanela = db => db.prepare(`UPDATE pedido_pagamentos
  SET atualizado_em=datetime('now','-1 minute') WHERE id=1`).run();

function mercadoPago(t, responder) {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    chamadas.push(`${init.method ?? 'GET'} ${url}`);
    return responder(url, init);
  });
  return chamadas;
}

function registrarEscritas(db) {
  const escritas = [];
  db.hook = async statements => {
    for (const s of statements) if (ESCRITA_SQL.test(s.sql)) escritas.push(s.sql);
    return statements;
  };
  return escritas;
}

test('M7: GET /api/pedido-status é puro — sem rede e sem escrita, mesmo com Pix elegível', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => { throw new Error('GET não pode chamar o MP'); });
  const antes = await state(db);
  const escritas = registrarEscritas(db);
  for (let i = 0; i < 3; i++) {
    const r = await getStatus(db);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {pedidoId: 1, statusPagamento: 'PENDENTE', statusPedido: 'NOVO'});
  }
  db.hook = null;
  assert.deepEqual(chamadas, []);
  assert.deepEqual(escritas, []);
  assert.deepEqual(await state(db), antes);
});

test('M7: GET /api/pedido é puro e mantém o contrato de detalhes', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => { throw new Error('GET não pode chamar o MP'); });
  const antes = await state(db);
  const escritas = registrarEscritas(db);
  const r = await getDetalhe(db);
  db.hook = null;
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.pedidoId, 1);
  assert.equal(body.clienteNome, 'Teste');
  assert.equal(body.valorTotalCentavos, 10000);
  assert.ok(body.criadoEm);
  assert.equal(body.itens.length, 1);
  assert.equal(body.statusPagamento, 'PENDENTE');
  assert.equal(body.statusPedido, 'NOVO');
  assert.deepEqual(chamadas, []);
  assert.deepEqual(escritas, []);
  assert.deepEqual(await state(db), antes);
});

test('M7: pedido legado sem ledger — GET não materializa e usa o estado persistido', async t => {
  const db = await fixture(t, {ledger: false});
  await db.prepare(`UPDATE pedidos SET status_pagamento='PENDENTE' WHERE id=1`).run();
  const chamadas = mercadoPago(t, () => { throw new Error('GET não pode chamar o MP'); });
  for (const r of [await getStatus(db), await getDetalhe(db)]) {
    assert.equal(r.status, 200);
    assert.equal((await r.json()).statusPagamento, 'PENDENTE');
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_pagamentos').first()).n, 0);
  assert.deepEqual(chamadas, []);
});

test('M7: POST exige mesma origem e, com MP approved, sincroniza normalmente', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, url =>
    Response.json({id: Number(String(url).split('/').at(-1)), status: 'approved'}));

  const antes = await state(db);
  const cruzado = await postStatus(db, {Origin: 'https://evil.test'});
  assert.equal(cruzado.status, 403);
  assert.deepEqual(chamadas, []);
  assert.deepEqual(await state(db), antes);

  const r = await postStatus(db);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {pedidoId: 1, statusPagamento: 'PAGO', statusPedido: 'PREPARANDO'});
  assert.deepEqual(chamadas, ['GET https://api.mercadopago.com/v1/payments/101']);
  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.produtos[0].estoque, 8);
});

test('M7: polling repetido consulta o MP no máximo uma vez por janela de 15s', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => Response.json({id: 101, status: 'pending'}));
  for (let i = 0; i < 5; i++) {
    const r = await postStatus(db);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).statusPagamento, 'PENDENTE');
  }
  assert.equal(chamadas.length, 1);
});

test('M7: falha de rede consome a janela; reaberta, uma nova consulta é permitida', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  t.mock.method(console, 'error', () => {});
  let falhar = true;
  const chamadas = mercadoPago(t, () => {
    if (falhar) throw new TypeError('network down');
    return Response.json({id: 101, status: 'pending'});
  });

  const primeira = await postStatus(db);
  assert.equal(primeira.status, 200);
  assert.equal((await primeira.json()).statusPagamento, 'PENDENTE', 'falha de rede não inventa rejeição');
  assert.equal(chamadas.length, 1);

  // Próximo polling (ex.: 4s depois): o claim da tentativa com falha segura a janela.
  const segunda = await postStatus(db);
  assert.equal(segunda.status, 200);
  assert.equal(chamadas.length, 1, 'nenhuma nova chamada dentro da janela');

  // Janela reaberta (>15s): a próxima tentativa pode consultar de novo.
  falhar = false;
  await abrirJanela(db);
  const terceira = await postStatus(db);
  assert.equal(terceira.status, 200);
  assert.equal(chamadas.length, 2);
});

test('M7: EXPIRADO -> PAGO tardio continua recuperável pelo POST', async t => {
  const db = await fixture(t);
  await app.sync.expireLocalPayment(db, 1);
  assert.equal((await state(db)).pagamentos[0].status, 'EXPIRADO');
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => Response.json({id: 101, status: 'approved'}));
  const r = await postStatus(db);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).statusPagamento, 'PAGO');
  assert.equal(chamadas.length, 1);
  assert.equal((await state(db)).pagamentos[0].status, 'PAGO');
});

test('M7: GETs repetidos nunca aumentam o contador de chamadas ao MP', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => Response.json({id: 101, status: 'pending'}));
  for (let i = 0; i < 5; i++) {
    assert.equal((await getStatus(db)).status, 200);
    assert.equal((await getDetalhe(db)).status, 200);
  }
  assert.equal(chamadas.length, 0);
  // A tentativa continuava elegível: só o POST consulta.
  assert.equal((await postStatus(db)).status, 200);
  assert.equal(chamadas.length, 1);
});

test('M7: claim compartilhado — a janela aberta pelo POST público também throttle o sweep do admin', async t => {
  const db = await fixture(t);
  await abrirJanela(db);
  const chamadas = mercadoPago(t, () => Response.json({id: 101, status: 'pending'}));
  assert.equal((await postStatus(db)).status, 200);
  await app.sync.reconcilePendingPixPayments(env(db));
  assert.equal(chamadas.length, 1, 'mesmo claim: o sweep respeita a janela já consumida');
});
