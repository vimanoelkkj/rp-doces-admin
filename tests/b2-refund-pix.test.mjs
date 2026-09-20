import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, barrier} from './helpers/b3.mjs';

// B-2 — registro MANUAL, no ledger, de um estorno de PIX_MP já devolvido
// fora do sistema. Não existe chamada remota ao Mercado Pago em nenhum
// caminho desta suíte: o `fetch` global é armado para FALHAR se alguém
// tentar. Refund automático via API do MP continua fora de escopo.

const cookieDe = session => session.cookie.split(';')[0];
const KEY = 'b2ref-1111-4111-8111-111111111111';
const KEY2 = 'b2ref-2222-4222-8222-222222222222';
const ambas = (a, b) => Promise.all([a, b].map(async p => corpo(await p)));

async function corpo(response) {
  return {status: response.status, body: await response.json()};
}

function proibirRede(t) {
  return t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('nenhuma chamada remota deve acontecer no estorno manual');
  });
}

// Pedido SITE com Pix do Mercado Pago efetivamente PAGO e estoque baixado.
async function pixPago(t, {origem = 'SITE'} = {}) {
  const db = await fixture(t, {paid: true});
  if (origem === 'ADMIN') {
    await db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN' WHERE id=1").run();
  }
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const s = await state(db);
  assert.equal(s.pagamentos[0].metodo, 'PIX_MP');
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.ok(s.pedido.estoque_baixado_em, 'estoque já baixado antes do estorno');
  assert.equal(s.produtos[0].estoque, 8);
  return {db, session: await app.auth.createSession(db, 1)};
}

const estornar = (db, session, body) =>
  app.adminRefund.onRequestPost({
    env: {DB: db}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/reembolsos', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({pagamentoId: 1, valorCentavos: 3000, ...body}),
    }),
  });

const cancelar = (db, session) =>
  app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({statusPedido: 'CANCELADO'}),
    }),
  });

test('estorno parcial de PIX_MP é registrado e o líquido passa a refletir a devolução', async t => {
  const {db, session} = await pixPago(t);
  const rede = proibirRede(t);

  const r = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.statusFinanceiro, 'PARCIAL');
  assert.equal(r.body.saldoCentavos, 3000, 'R$ 30 devolvidos reabrem R$ 30 de saldo');

  const s = await state(db);
  assert.equal(s.refunds.length, 1);
  assert.equal(s.refunds[0].metodo, 'PIX_MP');
  assert.equal(s.refunds[0].origem, 'MANUAL', 'quem criou o fato foi o operador');
  assert.equal(s.refunds[0].status, 'REEMBOLSADO');
  assert.equal(s.refunds[0].valor_centavos, 3000);
  assert.equal(s.refunds[0].devolveu_estoque, 0);

  // Pagamento original intocado — fato histórico íntegro.
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pagamentos[0].valor_centavos, 10000);
  assert.equal(s.pagamentos[0].mp_payment_id, '101');
  assert.equal(s.alocacoes.length, 1, 'allocations preservadas');

  // Estoque NÃO é reposto.
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 0);
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.ok(s.pedido.estoque_baixado_em);

  assert.equal(rede.mock.callCount(), 0, 'nenhuma chamada ao Mercado Pago');
});

test('estorno integral de PIX_MP zera o líquido e destrava o cancelamento', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);

  // Antes do estorno o cancelamento é recusado pelo guard de líquido.
  const recusado = await corpo(await cancelar(db, session));
  assert.equal(recusado.status, 409);
  assert.match(recusado.body.error, /estorno antes de cancelar/i);

  const r = await corpo(await estornar(db, session, {valorCentavos: 10000, operationKey: KEY}));
  assert.equal(r.status, 201);
  assert.equal(r.body.statusFinanceiro, 'PENDENTE', 'líquido zero');

  const aceito = await corpo(await cancelar(db, session));
  assert.equal(aceito.status, 200);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, 'CANCELADO');
  assert.equal(s.pagamentos[0].status, 'PAGO', 'pagamento original nunca vira REEMBOLSADO');
  assert.equal(s.refunds.length, 1);
  // Estoque baixado não volta, e a reserva convertida não é reaberta.
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
});

test('estorno de PIX_MP de origem ADMIN também é registrável', async t => {
  const {db, session} = await pixPago(t, {origem: 'ADMIN'});
  proibirRede(t);
  const r = await corpo(await estornar(db, session, {valorCentavos: 10000, operationKey: KEY}));
  assert.equal(r.status, 201);
  const s = await state(db);
  assert.equal(s.refunds[0].metodo, 'PIX_MP');
  assert.equal(s.pedido.status_pagamento, 'PENDENTE');
});

test('A1 preservado: retry com a mesma operationKey recupera o MESMO estorno', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);

  const primeira = await corpo(await estornar(db, session, {operationKey: KEY}));
  const retry = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.reembolsoId, primeira.body.reembolsoId);
  assert.equal(retry.body.replay, true);
  assert.equal((await state(db)).refunds.length, 1, 'nenhuma segunda devolução');

  // Payload incompatível com a mesma key continua sendo conflito estável.
  const conflito = await corpo(await estornar(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_PAYLOAD');
  assert.equal((await state(db)).refunds.length, 1);
});

test('A1 preservado: mesma operationKey concorrente registra exatamente um estorno', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);
  const escritas = barrier(2);
  db.hook = async s => {
    if (s.some(x => x.sql.includes('INSERT INTO pedido_reembolsos'))) await escritas();
  };
  const resultados = await ambas(
    estornar(db, session, {operationKey: KEY}),
    estornar(db, session, {operationKey: KEY}),
  );
  db.hook = null;

  assert.ok(resultados.every(r => r.status === 201));
  assert.equal(resultados[0].body.reembolsoId, resultados[1].body.reembolsoId);
  const s = await state(db);
  assert.equal(s.refunds.length, 1);
  assert.equal(s.operacoes.length, 1);
});

test('keys diferentes registram devoluções parciais distintas até o teto do pagamento', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);

  const a = await corpo(await estornar(db, session, {valorCentavos: 3000, operationKey: KEY}));
  const b = await corpo(await estornar(db, session, {valorCentavos: 7000, operationKey: KEY2}));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.reembolsoId, b.body.reembolsoId);

  const s = await state(db);
  assert.equal(s.refunds.length, 2);
  assert.equal(s.refunds.reduce((total, r) => total + r.valor_centavos, 0), 10000);
  assert.equal(s.pedido.status_pagamento, 'PENDENTE');
});

test('excesso de estorno é recusado pelo teto reembolsável, sem gravar nada', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);

  await estornar(db, session, {valorCentavos: 7000, operationKey: KEY});
  const antes = await state(db);

  // Restam R$ 30; pedir R$ 50 com uma intenção NOVA é recusado.
  const excesso = await corpo(await estornar(db, session, {valorCentavos: 5000, operationKey: KEY2}));
  assert.equal(excesso.status, 409);
  assert.equal(excesso.body.code, 'SALDO_REEMBOLSAVEL_INSUFICIENTE');
  assert.deepEqual(await state(db), antes, 'nenhuma escrita no excesso');

  // E acima do valor total do pagamento também.
  const absurdo = await corpo(await estornar(db, session, {
    valorCentavos: 999999, operationKey: 'b2ref-3333-4333-8333-333333333333',
  }));
  assert.equal(absurdo.status, 409);
  assert.equal((await state(db)).refunds.length, 1);
});

test('B3 permanece convergente depois do estorno de PIX_MP', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);
  await estornar(db, session, {valorCentavos: 10000, operationKey: KEY});

  for (let i = 0; i < 5; i++) await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  await app.reconcile.reconcilePedidosDivergentes(db);

  const s = await state(db);
  assert.equal(s.pedido.status_pagamento, 'PENDENTE', 'projeção estável');
  assert.equal(s.refunds.length, 1, 'reconciliação repetida não cria fato novo');
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.produtos[0].estoque, 8, 'estoque nunca reposto pela reconciliação');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
});

test('B4 preservado: reserva convertida não é reaberta e não há liberação por estorno', async t => {
  const {db, session} = await pixPago(t);
  proibirRede(t);
  await estornar(db, session, {valorCentavos: 10000, operationKey: KEY});

  const liberacao = await app.stock.liberarReservaPedido(db, 1);
  assert.equal(liberacao.ok, true);
  assert.equal(liberacao.liberado, false, 'estoque já convertido nunca volta ao estado de reserva');
  const s = await state(db);
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 0);
});

test('B2 preservado: refunded/charged_back do MP não alteram o ledger por conta própria', async t => {
  const db = await fixture(t, {paid: true});
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const antes = await state(db);

  // Investigado, deliberadamente NÃO sincronizado neste blocker: `refunded`
  // e `charged_back` não têm mapeamento, então o GET verificado só registra
  // o status bruto para diagnóstico e nunca inventa um fato de devolução.
  for (const status of ['refunded', 'charged_back']) {
    assert.equal(app.sync.mapMpStatus(status), null, `${status} não é estado final mapeado`);
    t.mock.method(globalThis, 'fetch', async () => Response.json({id: 101, status}));
    const r = await app.sync.syncPaymentFromMp(db, 1, await app.sync.fetchMpPayment('fake', '101'));
    assert.equal(r.transicionou, false);
    t.mock.restoreAll();
  }

  const depois = await state(db);
  assert.equal(depois.refunds.length, 0, 'nenhum estorno inventado');
  assert.equal(depois.pagamentos[0].status, 'PAGO');
  assert.equal(depois.pedido.status_pagamento, antes.pedido.status_pagamento);
  assert.equal(depois.produtos[0].estoque, antes.produtos[0].estoque);
});

test('método OUTRO continua fora do estorno manual', async t => {
  const db = await fixture(t, {paid: true});
  const session = await app.auth.createSession(db, 1);
  proibirRede(t);
  // `pedido_pagamentos.metodo` não aceita OUTRO; o guard é exercitado com um
  // pagamento cujo método não está no conjunto registrável.
  await db.prepare("UPDATE pedido_pagamentos SET metodo='A_COMBINAR',origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
  const r = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'METODO_NAO_REEMBOLSAVEL_MANUALMENTE');
  assert.equal((await state(db)).refunds.length, 0);
});
