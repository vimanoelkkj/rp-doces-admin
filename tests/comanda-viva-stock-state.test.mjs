import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state, barrier, isPhysical } from './helpers/b3.mjs';
import {
  bancoProducao, aplicarEstoquePorItem, snapshot,
} from './helpers/b5.mjs';

const reconcile = db => app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
const release = db => app.stock.liberarReservaPedido(db, 1);
const isRelease = statements => statements.some(s => s.sql.includes("estoque_estado = 'LIBERADO'"));

async function seedMigrationCases(db, { ambiguousConverted = false, reservedAggregate = 2 } = {}) {
  await db.batch([
    db.prepare("INSERT INTO categorias(id,nome,sistema) VALUES('BOLO','Bolos',1)"),
    ...[1, 2, 3, 4].map((id, index) => db.prepare(
      `INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado)
       VALUES(?,?,'BOLO',100,10,?)`,
    ).bind(id, `Produto ${id}`, index === 0 ? reservedAggregate : 0)),
    db.prepare(`INSERT INTO pedidos(
      id,token_publico,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,cliente_nome,cliente_email,cliente_whatsapp,
      idempotency_key,status_pagamento,status_pedido,status_comanda,
      origem_pedido,reserva_status,reserva_liberada_em,estoque_baixado_em)
      VALUES
      (1,'t1','',1,0,200,'C1','','000','p1','PENDENTE','NOVO','ABERTA','SITE','ATIVA',NULL,NULL),
      (2,'t2','',1,0,100,'C2','','000','p2','PENDENTE','NOVO','ABERTA','SITE','LIBERADA','2026-01-02',NULL),
      (3,'t3','',1,0,100,'C3','','000','p3','PENDENTE','NOVO','ABERTA','SITE','SEM_RESERVA',NULL,NULL),
      (4,'t4','',1,0,100,'C4','','000','p4','PAGO','NOVO','ABERTA','SITE','CONVERTIDA',NULL,?),
      (5,'t5','',1,0,50,'C5','','000','p5','PENDENTE','NOVO','ABERTA','SITE','SEM_RESERVA',NULL,NULL)`)
      .bind(ambiguousConverted ? null : '2026-01-04'),
    db.prepare(`INSERT INTO pedido_itens(
      id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos)
      VALUES
      (1,1,1,'Produto 1',2,100,200),
      (2,2,2,'Produto 2',1,100,100),
      (3,3,3,'Produto 3',1,100,100),
      (4,4,4,'Produto 4',1,100,100),
      (5,5,NULL,'Avulso',1,50,50)`),
    db.prepare(`INSERT INTO pedido_pagamentos(
      id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key)
      VALUES(1,1,'PIX_MP','SITE',200,'PENDENTE','pag-1')`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
      pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,200)`),
  ]);
}

test('migration backfills every provable state without changing money or aggregate stock', async t => {
  const db = await bancoProducao(t, {popular: false});
  await seedMigrationCases(db);
  const before = await snapshot(db);

  await aplicarEstoquePorItem(db);

  const after = await snapshot(db);
  assert.deepEqual(after.produtos, before.produtos);
  assert.deepEqual(after.pedidos.map(p => [p.id, p.valor_total_centavos, p.status_pagamento]),
    before.pedidos.map(p => [p.id, p.valor_total_centavos, p.status_pagamento]));
  assert.deepEqual(after.pedido_pagamentos, before.pedido_pagamentos);
  assert.deepEqual(after.pedido_pagamento_alocacoes, before.pedido_pagamento_alocacoes);
  assert.deepEqual(after.pedido_reembolsos, before.pedido_reembolsos);

  const itens = after.pedido_itens;
  assert.deepEqual(itens.map(i => i.status_item), Array(5).fill('ATIVO'));
  assert.deepEqual(itens.map(i => i.estoque_estado),
    ['RESERVADO', 'LIBERADO', 'SEM_RESERVA', 'BAIXADO', 'NAO_APLICAVEL']);
  assert.equal(itens[0].estoque_reservado_em, null, 'timestamp historico desconhecido nao e inventado');
  assert.equal(itens[1].estoque_liberado_em, '2026-01-02');
  assert.equal(itens[3].estoque_baixado_em, '2026-01-04');

  await assert.rejects(
    db.prepare(`INSERT INTO pedido_itens(
      pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos)
      VALUES(3,3,'Produto 3',1,100,100)`).run(),
    /estoque_estado obrigatorio/,
  );
});

for (const [name, options] of [
  ['CONVERTIDA sem marcador fisico', {ambiguousConverted: true}],
  ['soma reservada divergente do produto', {reservedAggregate: 1}],
]) test(`migration aborts before ALTER for ambiguous history: ${name}`, async t => {
  const db = await bancoProducao(t, {popular: false});
  await seedMigrationCases(db, options);
  await assert.rejects(aplicarEstoquePorItem(db), /migration_0016_estado_fisico_ambiguo/);
  const columns = (await db.prepare("PRAGMA table_info('pedido_itens')").all()).results;
  assert.equal(columns.some(c => c.name === 'estoque_estado'), false);
});

test('RESERVADO lowers once and retry is a physical no-op', async t => {
  const db = await fixture(t, {paid: true});
  assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: true});
  const first = await state(db);
  assert.equal(first.itens[0].estoque_estado, 'BAIXADO');
  assert.equal(first.produtos[0].estoque, 8);
  assert.equal(first.produtos[0].estoque_reservado, 0);
  assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: false});
  assert.deepEqual(await state(db), first);
});

for (const estoqueEstado of ['SEM_RESERVA', 'LIBERADO']) {
  test(`${estoqueEstado} lowers stock without touching another reservation`, async t => {
    const reserve = estoqueEstado === 'LIBERADO' ? 'LIBERADA' : 'SEM_RESERVA';
    const db = await fixture(t, {paid: true, reserve});
    await db.prepare('UPDATE produtos SET estoque_reservado=3 WHERE id=1').run();
    assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: true});
    const s = await state(db);
    assert.equal(s.itens[0].estoque_estado, 'BAIXADO');
    assert.equal(s.produtos[0].estoque, 8);
    assert.equal(s.produtos[0].estoque_reservado, 3);
  });
}

test('NAO_APLICAVEL and CANCELADO are ignored by physical deduction', async t => {
  const db = await fixture(t, {paid: true});
  await db.batch([
    db.prepare("UPDATE pedido_itens SET produto_id=NULL,estoque_estado='NAO_APLICAVEL' WHERE id=1"),
    db.prepare('UPDATE produtos SET estoque_reservado=0 WHERE id=1'),
  ]);
  assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: false});
  assert.equal((await state(db)).produtos[0].estoque, 10);

  await db.prepare("UPDATE pedido_itens SET produto_id=1,status_item='CANCELADO',estoque_estado='SEM_RESERVA' WHERE id=1").run();
  assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: false});
  assert.equal((await state(db)).produtos[0].estoque, 10);
});

test('release changes only RESERVADO to LIBERADO once and never lowers stock', async t => {
  const db = await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=1").run();
  assert.deepEqual(await release(db), {ok: true, liberado: true});
  const first = await state(db);
  assert.equal(first.itens[0].estoque_estado, 'LIBERADO');
  assert.equal(first.produtos[0].estoque, 10);
  assert.equal(first.produtos[0].estoque_reservado, 0);
  assert.deepEqual(await release(db), {ok: true, liberado: false});
  assert.deepEqual(await state(db), first);

  await db.prepare("UPDATE pedido_itens SET estoque_estado='BAIXADO',estoque_baixado_em=CURRENT_TIMESTAMP WHERE id=1").run();
  assert.deepEqual(await release(db), {ok: true, liberado: false});
  assert.equal((await state(db)).produtos[0].estoque, 10);
});

test('mixed order lowers only the new RESERVADO item', async t => {
  const db = await fixture(t, {paid: true});
  await reconcile(db);
  await db.batch([
    db.prepare("INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(2,'B','BOLO',100,7,0)"),
    db.prepare("INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(3,'C','BOLO',100,10,1)"),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_baixado_em)
      VALUES(2,1,2,'B',3,0,0,'ATIVO','BAIXADO',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em)
      VALUES(3,1,3,'C',1,0,0,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)`),
  ]);

  assert.deepEqual((await reconcile(db)).estoque, {ok: true, baixado: true});
  const s = await state(db);
  assert.deepEqual(s.itens.map(i => i.estoque_estado), ['BAIXADO', 'BAIXADO', 'BAIXADO']);
  assert.deepEqual(s.produtos.map(p => [p.estoque, p.estoque_reservado]),
    [[8, 0], [7, 0], [9, 0]]);
});

test('concurrent double deduction and double release each apply once', async t => {
  const lowerDb = await fixture(t, {paid: true});
  const lowerGate = barrier(2);
  lowerDb.hook = async (statements, operation) => {
    if (operation === 'batch' && isPhysical(statements)) await lowerGate();
  };
  const lowerResults = await Promise.all([reconcile(lowerDb), reconcile(lowerDb)]);
  lowerDb.hook = null;
  assert.equal(lowerResults.filter(r => r.estoque.baixado).length, 1);
  assert.deepEqual((await state(lowerDb)).produtos.map(p => [p.estoque, p.estoque_reservado]), [[8, 0]]);

  const releaseDb = await fixture(t);
  await releaseDb.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=1").run();
  const releaseGate = barrier(2);
  releaseDb.hook = async (statements, operation) => {
    if (operation === 'batch' && isRelease(statements)) await releaseGate();
  };
  const releaseResults = await Promise.all([release(releaseDb), release(releaseDb)]);
  releaseDb.hook = null;
  assert.equal(releaseResults.filter(r => r.liberado).length, 1);
  assert.deepEqual((await state(releaseDb)).produtos.map(p => [p.estoque, p.estoque_reservado]), [[10, 0]]);
});

test('payment deduction racing reservation release converges to BAIXADO once', async t => {
  const db = await fixture(t, {paid: true});
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && (isPhysical(statements) || isRelease(statements))) await gate();
  };
  await Promise.all([reconcile(db), release(db)]);
  db.hook = null;
  const s = await state(db);
  assert.equal(s.itens[0].estoque_estado, 'BAIXADO');
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 0);
});
