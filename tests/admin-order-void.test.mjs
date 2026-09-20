import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {app, fixture, state, barrier} from './helpers/b3.mjs';
import {bancoProducao, aplicarB5, aplicarEstoquePorItem, aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem, aplicarTrocaPorItem, aplicarRefundPixMpRecuperavel,
  aplicarCoberturaFinanceiraLinhagem, snapshot} from './helpers/b5.mjs';

const context = (db, session, body, overrides = {}) => ({
  env: {DB: db}, params: {id: '1'}, waitUntil() {},
  request: new Request('https://local.test/api/admin/pedidos/1/anulacao', {
    method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json',
      ...(session ? {Cookie: session.cookie.split(';')[0]} : {})}, body: JSON.stringify(body),
  }), ...overrides,
});
const anular = (db, session, devolverEstoque = true) => app.adminVoid.onRequestPost(
  context(db, session, {devolverEstoque, motivo: 'Pedido duplicado'}),
);
const get = (handler, db, session, url, params = {id: '1'}) => handler({
  env: {DB: db}, params, waitUntil() {}, request: new Request(`https://local.test${url}`, {
    headers: {Cookie: session.cookie.split(';')[0]},
  }),
});

async function manual(t, {reserve = 'CONVERTIDA', paid = true, metodo = 'DINHEIRO'} = {}) {
  const db = await fixture(t, {reserve, paid});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_pagamento=?,valor_total_centavos=4000,
      mp_payment_id=NULL,criado_em='2026-09-20 12:00:00' WHERE id=1`).bind(paid ? 'PAGO' : 'PENDENTE'),
    db.prepare(`UPDATE pedido_itens SET valor_unitario_centavos=2000,valor_total_centavos=4000 WHERE id=1`),
    db.prepare(`UPDATE pedido_pagamentos SET metodo=?,origem='ADMIN',mp_payment_id=NULL,
      valor_centavos=4000,pago_em=? WHERE id=1`).bind(metodo, paid ? '2026-09-20 12:01:00' : null),
    db.prepare(`UPDATE pedido_pagamento_alocacoes SET valor_centavos=4000 WHERE id=1`),
  ]);
  return {db, session: await app.auth.createSession(db, 1)};
}

async function dashboard(db, session) {
  const response = await get(app.dashboard.onRequestGet, db, session,
    '/api/admin/dashboard?date=2026-09-20&today=2026-09-20');
  assert.equal(response.status, 200);
  return response.json();
}

for (const metodo of ['DINHEIRO', 'PIX_EXTERNO']) test(`${metodo} R$40: preserva ledger e retira todos os agregados, inclusive no reload`, async t => {
  const {db, session} = await manual(t, {metodo});
  const before = await state(db);
  const initial = await dashboard(db, session);
  assert.equal(initial.financeiro.liquidoCentavos, 4000);
  assert.equal(initial.recebidoHoje.total, 4000);
  assert.equal(initial.maisVendidos[0].quantidade, 2);
  const response = await anular(db, session, false);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.anulacao.liquido_original_centavos, 4000);
  assert.equal(result.anulacao.criado_por_usuario_id, 1);
  assert.equal(result.anulacao.usuario_nome, 'Teste');
  assert.equal(result.anulacao.motivo, 'Pedido duplicado');
  assert.deepEqual(await state(db), before, 'sem devolucao, todo o dominio original permanece igual');

  for (let reload = 0; reload < 2; reload++) {
    const after = await dashboard(db, session);
    assert.deepEqual(after.financeiro, {brutoCentavos: 0, reembolsadoCentavos: 0, liquidoCentavos: 0});
    assert.deepEqual(after.recebidoHoje, {count: 0, total: 0});
    assert.equal(after.aReceber.total, 0);
    assert.equal(after.comandasAbertas, 0);
    assert.equal(after.aguardandoPreparo, 0);
    assert.deepEqual(after.pagamentosPendentes, []);
    assert.deepEqual(after.maisVendidos, []);
    assert.deepEqual(after.pedidosRecentes, []);
    for (const tab of ['todos','hoje','novos','em_producao','prontos','entregues','arquivados']) {
      const listed = await (await get(app.admin.onRequestGet, db, session,
        `/api/admin/pedidos?status=${tab}&search=Teste`)).json();
      assert.equal(listed.total, 0, tab);
      assert.ok(Object.values(listed.counts).every(count => count === 0));
    }
  }
  const detail = await (await get(app.adminOrder.onRequestGet, db, session, '/api/admin/pedidos/1')).json();
  assert.equal(detail.pedido.valor_total_centavos, 4000);
  assert.equal(detail.financeiro.brutoPagoCentavos, 4000);
  assert.equal(detail.financeiro.liquidoCentavos, 4000);
  assert.equal(detail.anulacao.id, result.anulacao.id);
  const history = await (await get(app.adminHistorico.onRequestGet, db, session, '/api/admin/pedidos/1/historico')).json();
  assert.equal(history.eventos.find(e => e.tipo === 'PAGAMENTO').valorCentavos, 4000);
  const event = history.eventos.find(e => e.tipo === 'PEDIDO_ANULADO');
  assert.equal(event.valorCentavos, -4000);
  assert.equal(event.usuario, 'Teste');
  assert.equal(event.estoqueAcao, 'MANTER');
  assert.deepEqual(await state(db), before, 'consultar o historico nao reconcilia nem altera fatos');
  const notifications = await app.notificacoes.listarNotificacoes(db, 1);
  assert.ok(!notifications.notificacoes.some(n => n.tipo === 'PEDIDO' || n.tipo === 'PAGAMENTO'));
});

test('saldo pendente some do card e nao retorna pela manutencao automatica', async t => {
  const {db, session} = await manual(t, {paid: false, reserve: 'ATIVA'});
  assert.equal((await dashboard(db, session)).aReceber.total, 4000);
  assert.equal((await dashboard(db, session)).pagamentosPendentes.length, 1);
  assert.equal((await anular(db, session, false)).status, 200);
  const before = await state(db);
  await app.reconcile.reconcilePedidosDivergentes(db);
  await app.stock.liberarReservaPedido(db, 1);
  await app.stock.baixarEstoquePedido(db, 1);
  await app.liveTabRecovery.reconcileLiveTabPedido(db, undefined, 1);
  assert.deepEqual(await state(db), before);
  assert.equal((await dashboard(db, session)).aReceber.total, 0);
  assert.deepEqual((await dashboard(db, session)).pagamentosPendentes, []);
});

for (const [reserve, estado, devolver, estoque, reservado, final] of [
  ['CONVERTIDA','BAIXADO',true,12,0,'REPOSTO'],
  ['CONVERTIDA','BAIXADO',false,10,0,'BAIXADO'],
  ['ATIVA','RESERVADO',true,10,0,'LIBERADO'],
  ['ATIVA','RESERVADO',false,10,2,'RESERVADO'],
  ['CONVERTIDA','REPOSTO',true,10,0,'REPOSTO'],
  ['LIBERADA','LIBERADO',true,10,0,'LIBERADO'],
  ['SEM_RESERVA','SEM_RESERVA',true,10,0,'SEM_RESERVA'],
]) test(`${estado} devolver=${devolver}: efeito fisico correto e retry inerte`, async t => {
  const {db, session} = await manual(t, {reserve});
  await db.prepare('UPDATE pedido_itens SET estoque_estado=? WHERE id=1').bind(estado).run();
  const before = await state(db);
  assert.equal((await anular(db, session, devolver)).status, 200);
  const after = await state(db);
  assert.equal(after.produtos[0].estoque, estoque);
  assert.equal(after.produtos[0].estoque_reservado, reservado);
  assert.equal(after.itens[0].estoque_estado, final);
  assert.deepEqual(after.pagamentos, before.pagamentos);
  assert.deepEqual(after.alocacoes, before.alocacoes);
  assert.deepEqual(after.refunds, before.refunds);
  const retry = await (await anular(db, session, !devolver)).json();
  assert.equal(retry.replay, true);
  assert.equal(retry.anulacao.estoque_acao, devolver ? 'DEVOLVER' : 'MANTER');
  assert.deepEqual(await state(db), after);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_anulacoes').first()).n, 1);
});

test('itens cancelados e origem de troca preservados; apenas destino atual e reposto', async t => {
  const {db, session} = await manual(t);
  await db.batch([
    db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO' WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado) VALUES(2,1,1,'Destino',2,2000,4000,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,produto_destino_id,quantidade_destino,
      preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,
      estoque_acao_origem,status,snapshot_financeiro) VALUES(1,1,1,2,1,2,2000,4000,4000,0,'ZERO','NAO_REPOR','CONCLUIDA','{}')`),
  ]);
  const origin = await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first();
  const exchange = await db.prepare('SELECT * FROM pedido_item_trocas').first();
  assert.equal((await anular(db, session)).status, 200);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first(), origin);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_item_trocas').first(), exchange);
  assert.equal((await state(db)).produtos[0].estoque, 12);
  assert.equal((await state(db)).itens[1].estoque_estado, 'REPOSTO');
});

test('duas requests simultaneas disputam UNIQUE e movimentam estoque somente uma vez', async t => {
  const {db, session} = await manual(t);
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements[0].sql.includes('INSERT INTO pedido_anulacoes')) await gate();
    return statements;
  };
  const results = await Promise.all([anular(db, session), anular(db, session)]);
  db.hook = null;
  const bodies = await Promise.all(results.map(r => r.json()));
  assert.deepEqual(results.map(r => r.status), [200,200]);
  assert.equal(bodies.filter(b => b.replay).length, 1);
  assert.equal(bodies[0].anulacao.id, bodies[1].anulacao.id);
  assert.equal((await state(db)).produtos[0].estoque, 12);
});

test('NAO_APLICAVEL e destino TROCA_PENDENTE usam a autoridade fisica atual', async t => {
  const {db, session} = await manual(t);
  await db.batch([
    db.prepare(`UPDATE produtos SET estoque_reservado=2 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,produto_destino_id,quantidade_destino,
      preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,
      estoque_acao_origem,status,snapshot_financeiro)
      VALUES(1,1,1,1,2,1000,4000,2000,-2000,'DEVOLVER','REPOR','AGUARDANDO_REEMBOLSO','{}')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado,pedido_item_troca_id)
      VALUES(2,1,1,'Destino pendente',2,1000,2000,'TROCA_PENDENTE','RESERVADO',1)`),
    db.prepare(`UPDATE pedido_item_trocas SET item_destino_id=2 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado) VALUES(3,1,'Avulso',1,0,0,'ATIVO','NAO_APLICAVEL')`),
  ]);
  const original = await db.prepare('SELECT * FROM pedido_itens WHERE id=3').first();
  assert.equal((await anular(db, session)).status, 200);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_itens WHERE id=3').first(), original);
  const after = await state(db);
  assert.equal(after.produtos[0].estoque, 12);
  assert.equal(after.produtos[0].estoque_reservado, 0);
  assert.equal(after.itens[1].estoque_estado, 'LIBERADO');
  assert.equal(after.itens[1].status_item, 'TROCA_PENDENTE');
});

test('refund historico permanece e o impacto nos totais usa liquido', async t => {
  const {db, session} = await manual(t);
  await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key)
    VALUES(1,1,'MANUAL','DINHEIRO',1000,'REEMBOLSADO','refund-historico')`).run();
  const before = await state(db);
  assert.equal((await dashboard(db, session)).financeiro.liquidoCentavos, 3000);
  const response = await anular(db, session, false);
  assert.equal(response.status, 200);
  const {anulacao} = await response.json();
  assert.equal(anulacao.bruto_original_centavos, 4000);
  assert.equal(anulacao.reembolsado_original_centavos, 1000);
  assert.equal(anulacao.liquido_original_centavos, 3000);
  assert.deepEqual(await state(db), before);
  assert.deepEqual((await dashboard(db, session)).financeiro,
    {brutoCentavos:0,reembolsadoCentavos:0,liquidoCentavos:0});
});

test('MP confirmado exige estorno real por pagamento; sem refund implicito', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);
  let network = 0;
  t.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('unexpected MP'); });
  const before = await state(db);
  assert.equal((await anular(db, session)).status, 409);
  assert.deepEqual(await state(db), before);
  await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key)
    VALUES(1,1,'MANUAL','DINHEIRO',10000,'REEMBOLSADO','manual-nao-prova-mp')`).run();
  assert.equal((await anular(db, session)).status, 409, 'refund manual nao prova devolucao MP');
  await db.prepare(`UPDATE pedido_reembolsos SET origem='MERCADO_PAGO',metodo='PIX_MP',mp_refund_id='refund-real'`).run();
  const refunds = (await state(db)).refunds;
  assert.equal((await anular(db, session)).status, 200);
  assert.deepEqual((await state(db)).refunds, refunds);
  assert.equal(network, 0);
});

for (const status of ['PENDENTE','EXPIRADO']) test(`MP ${status} bloqueia anulacao atomicamente`, async t => {
  const db = await fixture(t);
  await db.prepare('UPDATE pedido_pagamentos SET status=?').bind(status).run();
  const session = await app.auth.createSession(db, 1);
  const before = await state(db);
  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ANULACAO_MP_PENDENTE');
  assert.deepEqual(await state(db), before);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_anulacoes').first()).n, 0);
});

test('MP confirmado entre leitura e batch bloqueia a anulacao sem devolver estoque', async t => {
  const {db, session} = await manual(t);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements[0].sql.includes('INSERT INTO pedido_anulacoes')) {
      db.hook = null;
      await db.prepare(`UPDATE pedido_pagamentos SET metodo='PIX_MP',mp_payment_id='101' WHERE id=1`).run();
    }
    return statements;
  };
  assert.equal((await anular(db, session)).status, 409);
  assert.equal((await state(db)).produtos[0].estoque, 10);
});

test('falha fisica reverte anulação e todo o batch', async t => {
  const {db, session} = await manual(t, {reserve: 'ATIVA'});
  await db.prepare('UPDATE produtos SET estoque_reservado=0 WHERE id=1').run();
  const before = await state(db);
  t.mock.method(console, 'error', () => {});
  assert.equal((await anular(db, session)).status, 500);
  assert.deepEqual(await state(db), before);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_anulacoes').first()).n, 0);
});

test('sameOrigin antecede auth/db; payload estrito e autenticacao obrigatoria', async t => {
  const poison = {prepare() { throw new Error('nao pode acessar db'); }};
  const cross = await app.adminVoid.onRequestPost(context(poison, null, {}, {
    request: new Request('https://local.test/api/admin/pedidos/1/anulacao', {
      method: 'POST', headers: {Origin: 'https://evil.test'}, body: '{}',
    }),
  }));
  assert.equal(cross.status, 403);
  const {db, session} = await manual(t);
  assert.equal((await anular(db, null)).status, 401);
  for (const body of [null, [], {}, {devolverEstoque:'sim'}, {devolverEstoque:true, total:0},
    {devolverEstoque:true, motivo:12}, {devolverEstoque:true, motivo:'x'.repeat(301)}]) {
    assert.equal((await app.adminVoid.onRequestPost(context(db, session, body))).status, 400);
  }
  assert.equal((await app.adminVoid.onRequestPost(context(db, session, {devolverEstoque:true}, {params:{id:'999'}}))).status, 404);
});

test('anulado recusa mutacoes administrativas e protege batches ja em voo', async t => {
  const {db, session} = await manual(t);
  assert.equal((await anular(db, session, false)).status, 200);
  for (const [handler, method] of [
    [app.adminOrder.onRequestPatch,'PATCH'], [app.adminPayment.onRequestPost,'POST'],
    [app.adminPix.onRequestPost,'POST'], [app.adminItems.onRequestPost,'POST'], [app.adminItems.onRequestPut,'PUT'],
    [app.adminItemExchange.onRequestPost,'POST'], [app.adminItemCancellation.onRequestPost,'POST'],
    [app.adminRefund.onRequestPost,'POST'], [app.adminItemExchangeRefund.onRequestPost,'POST'],
    [app.adminItemCancellationRefund.onRequestPost,'POST'],
  ]) {
    const ctx = context(db, session, {});
    ctx.request = new Request(ctx.request, {method});
    assert.equal((await handler(ctx)).status, 409);
  }
  const before = await state(db);
  await assert.rejects(db.batch([
    db.prepare('UPDATE produtos SET estoque=estoque-1 WHERE id=1'),
    db.prepare(`UPDATE pedido_itens SET estoque_estado='SEM_RESERVA' WHERE id=1`),
  ]), /PEDIDO_ANULADO/);
  assert.deepEqual(await state(db), before);
  await assert.rejects(db.prepare('UPDATE pedido_pagamentos SET valor_centavos=0 WHERE id=1').run(), /PEDIDO_ANULADO/);
  await assert.rejects(db.prepare('DELETE FROM pedido_pagamento_alocacoes WHERE id=1').run(), /PEDIDO_ANULADO/);
  await assert.rejects(db.prepare('DELETE FROM pedido_anulacoes WHERE pedido_id=1').run(), /PEDIDO_ANULADO/);
});

test('0022 sobre banco representativo 0016-0021 preserva dados e foreign_key_check vazio', async t => {
  const db = await bancoProducao(t);
  for (const apply of [aplicarB5, aplicarEstoquePorItem, aplicarOperacaoPorItem, aplicarCancelamentoPorItem,
    aplicarTrocaPorItem, aplicarRefundPixMpRecuperavel, aplicarCoberturaFinanceiraLinhagem]) await apply(db);
  const before = await snapshot(db);
  const sql = (await readFile('migrations/0022_pedido_anulacoes.sql','utf8')).replace(/--[^\n]*/g,'');
  for (const statement of sql.match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? []) {
    await db.prepare(statement).run();
  }
  const after = await snapshot(db);
  delete before.__objetos; delete after.__objetos;
  assert.deepEqual(after, before);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_anulacoes').first()).n, 0);
});
