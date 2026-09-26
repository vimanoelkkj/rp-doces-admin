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
    assert.deepEqual(await r.json(), {pedidoId: 1, statusPagamento: 'PENDENTE', statusPedido: 'NOVO', estoquePendente: false});
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
  assert.equal(body.estoquePendente, false);
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
  assert.deepEqual(await r.json(), {pedidoId: 1, statusPagamento: 'PAGO', statusPedido: 'PREPARANDO', estoquePendente: false});
  assert.deepEqual(chamadas, ['GET https://api.mercadopago.com/v1/payments/101']);
  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.produtos[0].estoque, 8);
  assert.ok(s.itens.every(i => i.estoque_estado === 'BAIXADO'));
  assert.equal(s.pedido.status_pedido, 'PREPARANDO');
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

// Pix tardio depois que a reserva expirou e foi LIBERADA. O estoque físico
// livre foi consumido por outro pedido (estoque_reservado=2 de terceiros em
// estoque=3): a baixa recusa com ESTOQUE_INSUFICIENTE e nada fica negativo.
async function pixTardioSemEstoque(t) {
  const db = await fixture(t);
  await app.sync.expireLocalPayment(db, 1);
  await db.prepare('UPDATE produtos SET estoque=3, estoque_reservado=2 WHERE id=1').run();
  await abrirJanela(db);
  t.mock.method(console, 'error', () => {});
  const chamadas = mercadoPago(t, () => Response.json({id: 101, status: 'approved'}));
  return {db, chamadas};
}

test('Pix tardio: EXPIRADO + reserva LIBERADA + estoque insuficiente -> PAGO, NOVO, estoquePendente', async t => {
  const {db, chamadas} = await pixTardioSemEstoque(t);
  const antes = await state(db);
  assert.equal(antes.pagamentos[0].status, 'EXPIRADO');
  assert.ok(antes.itens.every(i => i.estoque_estado === 'LIBERADO'));

  const r = await postStatus(db);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(),
    {pedidoId: 1, statusPagamento: 'PAGO', statusPedido: 'NOVO', estoquePendente: true});
  assert.equal(chamadas.length, 1);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO', 'verdade financeira continua autoritativa');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.pedido.status_pedido, 'NOVO', 'não promove para PREPARANDO sem baixa física');
  assert.equal(s.refunds.length, 0, 'sem refund automático');
  assert.equal(s.produtos[0].estoque, 3, 'estoque não fica negativo nem é consumido');
  assert.equal(s.produtos[0].estoque_reservado, 2, 'reserva de outros pedidos intacta');
  assert.ok(s.itens.every(i => i.estoque_estado === 'LIBERADO'), 'LIBERADO não volta a RESERVADO');
  assert.equal(s.pedido.estoque_baixado_em, null);
});

test('Pix tardio: GET público lê estoquePendente sem MP e sem escrita', async t => {
  const {db, chamadas} = await pixTardioSemEstoque(t);
  assert.equal((await postStatus(db)).status, 200);
  const chamadasAposPost = chamadas.length;
  const antes = await state(db);
  const escritas = registrarEscritas(db);
  const status = await getStatus(db);
  const detalhe = await getDetalhe(db);
  db.hook = null;
  assert.deepEqual(await status.json(),
    {pedidoId: 1, statusPagamento: 'PAGO', statusPedido: 'NOVO', estoquePendente: true});
  const body = await detalhe.json();
  assert.equal(body.statusPagamento, 'PAGO');
  assert.equal(body.statusPedido, 'NOVO');
  assert.equal(body.estoquePendente, true);
  assert.equal(chamadas.length, chamadasAposPost, 'GET não consulta o MP');
  assert.deepEqual(escritas, []);
  assert.deepEqual(await state(db), antes);
});

test('Pix tardio: estoque volta -> reconciliação baixa exatamente uma vez e estoquePendente zera', async t => {
  const {db} = await pixTardioSemEstoque(t);
  assert.equal((await postStatus(db)).status, 200);

  await db.prepare('UPDATE produtos SET estoque=10 WHERE id=1').run();
  await app.reconcile.reconcilePedidosDivergentes(db);
  await app.reconcile.reconcilePedidosDivergentes(db);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);

  let s = await state(db);
  assert.equal(s.produtos[0].estoque, 8, 'baixa única de 2 unidades');
  assert.equal(s.produtos[0].estoque_reservado, 2, 'reserva de outros pedidos intacta');
  assert.ok(s.itens.every(i => i.estoque_estado === 'BAIXADO'));
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');

  const r = await postStatus(db);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.statusPagamento, 'PAGO');
  assert.equal(body.estoquePendente, false);
  // Sem nova transição financeira, o POST não promove o eixo operacional;
  // o pedido segue NOVO + PAGO, como um pagamento recebido por webhook.
  assert.equal(body.statusPedido, 'NOVO');
  s = await state(db);
  assert.equal(s.produtos[0].estoque, 8, 'POST repetido não baixa de novo');

  const get = await (await getStatus(db)).json();
  assert.equal(get.estoquePendente, false);
});

test('Pix tardio: estoque pendente nunca rebaixa status operacional avançado', async t => {
  const {db} = await pixTardioSemEstoque(t);
  assert.equal((await postStatus(db)).status, 200);
  await db.prepare(`UPDATE pedidos SET status_pedido='PREPARANDO' WHERE id=1`).run();
  const body = await (await postStatus(db)).json();
  assert.equal(body.statusPedido, 'PREPARANDO');
  assert.equal(body.estoquePendente, true);
  assert.equal((await state(db)).pedido.status_pedido, 'PREPARANDO');
});

test('estoquePendente ignora pedido sem produto controlado', async t => {
  const {db} = await pixTardioSemEstoque(t);
  await db.prepare('UPDATE pedido_itens SET produto_id=NULL WHERE id=1').run();
  const body = await (await postStatus(db)).json();
  assert.equal(body.statusPagamento, 'PAGO');
  assert.equal(body.estoquePendente, false);
  assert.equal(await app.stock.pedidoTemEstoquePendente(db, 1), false);
});
