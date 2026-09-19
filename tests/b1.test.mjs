import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, isPhysical} from './helpers/b3.mjs';

const blocked = {
  error: 'A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.',
  code: 'EDICAO_ITENS_BLOQUEADA',
};
const valid = {itens: [{produtoId: 1, quantidade: 5}]};
const reconcile = db => app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
};

// Only the editor receives this connection. Concurrent operations use db directly.
// Observe and forward even forbidden calls: a write cannot be hidden by the probe.
async function editor(db, {afterOrderRead} = {}) {
  const session = await app.auth.createSession(db, 1);
  const calls = [];
  const observed = {
    prepare(sql) {
      calls.push({operation: 'prepare', sql});
      const statement = db.prepare(sql);
      const originalFirst = statement.first.bind(statement);
      statement.first = async (...args) => {
        const result = await originalFirst(...args);
        if (/FROM pedidos\b/i.test(sql)) await afterOrderRead?.();
        return result;
      };
      return statement;
    },
    batch(statements) {
      calls.push({operation: 'batch'});
      return db.batch(statements);
    },
    exec(sql) {
      calls.push({operation: 'exec', sql});
      return db.exec(sql);
    },
  };
  return {
    calls,
    call({id = '1', body = valid, raw, cookie = session.cookie.split(';')[0]} = {}) {
      return app.adminItems.onRequestPut({
        env: {DB: observed}, params: {id},
        request: new Request('https://local.test/api/admin/pedidos/' + id + '/itens', {
          method: 'PUT',
          headers: {'Content-Type': 'application/json', Cookie: cookie},
          body: raw ?? JSON.stringify(body),
        }),
      });
    },
    assertReadOnly() {
      assert.ok(calls.every(c => c.operation === 'prepare' && /^\s*SELECT\b/i.test(c.sql)),
        'editor must issue only SELECTs, never a domain write or batch');
    },
  };
}
async function assertBlocked(response) {
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), blocked);
}
async function manual(db) {
  await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO',origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
}
async function refund(db) {
  return app.ledger.registerManualRefund(db, {
    pedidoId: 1, pagamentoId: 1, valorCentavos: 10000, usuarioId: 1,
  });
}
const scenarios = [
  {name: 'apparently virgin', options: {ledger: false, reserve: 'SEM_RESERVA'}, setup: async db => {
    await db.prepare('UPDATE pedidos SET mp_payment_id=NULL,pix_expira_em=NULL WHERE id=1').run();
  }},
  {name: 'PENDENTE with ATIVA and live SITE Pix'},
  {name: 'live ADMIN Pix without remote ID or QR', setup: async db => {
    await db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
  }},
  {name: 'PARCIAL', setup: async db => {
    await db.prepare("UPDATE pedido_pagamentos SET status='PAGO',valor_centavos=4000 WHERE id=1").run();
    await reconcile(db);
  }},
  {name: 'PAGO awaiting physical deduction', options: {paid: true}, setup: async db => {
    await db.prepare("UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1").run();
  }},
  {name: 'PAGO with physical deduction and CONVERTIDA', options: {paid: true}, setup: reconcile},
  {name: 'full refund with historical allocations and physical deduction', options: {paid: true}, setup: async db => {
    await manual(db);
    await reconcile(db);
    assert.equal((await refund(db)).ok, true);
  }},
  {name: 'LIBERADA with expired Pix', options: {reserve: 'LIBERADA'}, setup: async db => {
    await db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run();
  }},
  {name: 'CONVERTIDA even with divergent financial projection', options: {reserve: 'CONVERTIDA'}},
  {name: 'ADMIN A_COMBINAR', setup: async db => {
    await db.prepare("UPDATE pedidos SET origem_pedido='MANUAL' WHERE id=1").run();
    await db.prepare("UPDATE pedido_pagamentos SET metodo='A_COMBINAR',origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
  }},
  ...['NOVO', 'PREPARANDO', 'PRONTO', 'ENTREGUE', 'CANCELADO'].map(status => ({
    name: 'operational status ' + status,
    setup: db => db.prepare('UPDATE pedidos SET status_pedido=? WHERE id=1').bind(status).run(),
  })),
  ...['CANCELADO', 'EXPIRADO', 'FALHOU', 'REEMBOLSADO'].map(status => ({
    name: 'terminal ledger status ' + status,
    setup: db => db.prepare('UPDATE pedido_pagamentos SET status=? WHERE id=1').bind(status).run(),
  })),
];
for (const scenario of scenarios) test('B1 direct API: ' + scenario.name, async t => {
  const db = await fixture(t, scenario.options);
  await scenario.setup?.(db);
  await db.prepare("UPDATE pedido_itens SET criado_em='2026-01-01',adicionado_em='2026-01-02',adicionado_por_usuario_id=1 WHERE id=1").run();
  const edit = await editor(db);
  const before = await state(db);
  await assertBlocked(await edit.call());
  assert.deepEqual(await state(db), before, 'all domain rows, audit fields and stock remain identical');
  edit.assertReadOnly();
});

test('B1 validation: malformed input is controlled, authentication precedes validation', async t => {
  const db = await fixture(t);
  const edit = await editor(db);
  const before = await state(db);
  const invalid = [
    ['JSON null', {body: null}], ['array', {body: []}],
    ['string', {body: 'text'}], ['number', {body: 1}], ['boolean', {body: true}],
    ['missing itens', {body: {}}], ['null itens', {body: {itens: null}}],
    ['object itens', {body: {itens: {}}}], ['empty itens', {body: {itens: []}}],
    ['malformed JSON', {raw: '{'}], ['empty JSON', {raw: ''}],
    ['too many items', {body: {itens: Array(51).fill(valid.itens[0])}}],
    ...[null, [], 1, 'item', {}, {produtoId: 1}, {produtoId: '1', quantidade: 1},
      {produtoId: 0, quantidade: 1}, {produtoId: -1, quantidade: 1},
      {produtoId: 1.5, quantidade: 1}, {produtoId: 1, quantidade: '1'},
      {produtoId: 1, quantidade: 0}, {produtoId: 1, quantidade: -1},
      {produtoId: 1, quantidade: 1.5}, {produtoId: 1, quantidade: 51}]
      .map((item, i) => ['invalid item ' + i, {body: {itens: [item]}}]),
    ...['0', '-1', '1.5', 'abc', 'Infinity', ''].map(id => ['invalid ID ' + id, {id}]),
  ];
  for (const [name, input] of invalid) await t.test(name, async () => {
    const response = await edit.call(input);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  });
  assert.equal((await edit.call({id: '999'})).status, 404);
  assert.equal((await edit.call({id: '999', body: null})).status, 400);
  for (const cookie of ['', 'rp_admin_session=unknown']) {
    assert.equal((await edit.call({cookie})).status, 401);
    assert.equal((await edit.call({cookie, id: 'invalid', body: null})).status, 401);
  }
  // Valid shape always conflicts for an existing order, independent of catalog/stock.
  for (const body of [
    {itens: [{produtoId: 999, quantidade: 50}]},
    {itens: Array(50).fill({produtoId: 1, quantidade: 1})},
    {itens: [{produtoId: 1, quantidade: 1}]},
  ]) await assertBlocked(await edit.call({body}));
  assert.deepEqual(await state(db), before);
  edit.assertReadOnly();
});

const concurrent = [
  {
    name: 'legacy materialization after reading old total',
    options: {ledger: false, reserve: 'SEM_RESERVA'},
    atWrite: s => s.some(x => x.sql.includes('INSERT OR IGNORE INTO pedido_pagamentos')),
    run: db => app.ledger.ensureLegacyPaymentMaterialized(db, 1),
    check(s) {
      assert.equal(s.pagamentos.length, 1);
      assert.equal(s.pagamentos[0].valor_centavos, 10000);
      assert.equal(s.alocacoes[0].pedido_item_id, 1);
      assert.equal(s.alocacoes[0].valor_centavos, 10000);
    },
  },
  {
    name: 'manual payment',
    options: {ledger: false},
    atWrite: s => s.some(x => /INSERT INTO pedido_pagamentos/.test(x.sql)),
    run: db => app.ledger.registerAdminPayment(db, {pedidoId: 1, metodo: 'DINHEIRO', valorCentavos: 10000, usuarioId: 1}),
    check(s) {
      assert.equal(s.pedido.status_pagamento, 'PAGO');
      assert.equal(s.pagamentos.filter(p => p.status === 'PAGO').length, 1);
      assert.equal(s.produtos[0].estoque, 8);
      assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
    },
  },
  {
    name: 'manual refund',
    options: {paid: true},
    setup: async db => { await manual(db); await reconcile(db); },
    atWrite: s => s.some(x => /INSERT INTO pedido_reembolsos/.test(x.sql)),
    run: refund,
    check(s) {
      assert.equal(s.refunds.length, 1);
      assert.equal(s.refunds[0].valor_centavos, 10000);
      assert.equal(s.pedido.status_pagamento, 'PENDENTE');
      assert.equal(s.produtos[0].estoque, 8);
      assert.equal(s.alocacoes.length, 1);
    },
  },
  {
    name: 'physical stock deduction',
    options: {paid: true},
    setup: db => db.prepare("UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1").run(),
    atWrite: isPhysical,
    run: db => app.stock.baixarEstoquePedido(db, 1),
    check(s) {
      assert.equal(s.produtos[0].estoque, 8);
      assert.equal(s.produtos[0].estoque_reservado, 0);
      assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
      assert.ok(s.itens[0].estoque_baixado_em);
    },
  },
  {
    name: 'reservation release',
    setup: db => db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run(),
    atWrite: s => s.some(x => x.sql.includes("estoque_estado = 'LIBERADO'")),
    run: db => app.stock.liberarReservaPedido(db, 1),
    check(s) {
      assert.equal(s.pedido.reserva_status, 'LIBERADA');
      assert.equal(s.produtos[0].estoque_reservado, 0);
      assert.equal(s.produtos[0].estoque, 10);
    },
  },
  {
    name: 'verified late MP approval',
    options: {reserve: 'LIBERADA'},
    setup: db => db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run(),
    atWrite: s => s.some(x => x.sql.includes('SET status = ?')),
    run: async db => app.sync.syncPaymentFromMp(db, 1, await app.sync.fetchMpPayment('fake', '101')),
    check(s) {
      assert.equal(s.pagamentos[0].status, 'PAGO');
      assert.equal(s.pedido.status_pagamento, 'PAGO');
      assert.equal(s.produtos[0].estoque, 8);
      assert.ok(s.itens[0].estoque_baixado_em);
    },
  },
];
for (const operation of concurrent) for (const order of ['editor finishes before write', 'operation finishes after editor read']) {
  test('B1 concurrency: ' + operation.name + ' / ' + order, {timeout: 20000}, async t => {
    const db = await fixture(t, operation.options);
    await operation.setup?.(db);
    const reached = deferred(), resume = deferred();
    t.after(() => resume.resolve());
    let edit;
    if (order === 'editor finishes before write') {
      edit = await editor(db);
      db.hook = async statements => {
        if (operation.atWrite(statements)) {
          db.hook = null;
          reached.resolve();
          await resume.promise;
        }
      };
      const running = operation.run(db);
      await Promise.race([reached.promise, running.then(() => { throw new Error('write barrier was not reached'); })]);
      const paused = await state(db);
      try {
        await assertBlocked(await edit.call());
        assert.deepEqual(await state(db), paused, 'editor changes nothing while legitimate writer is paused');
      } finally {
        resume.resolve();
        await running;
      }
    } else {
      edit = await editor(db, {afterOrderRead: async () => { reached.resolve(); await resume.promise; }});
      const running = edit.call();
      await reached.promise;
      try {
        await operation.run(db);
        const committed = await state(db);
        resume.resolve();
        await assertBlocked(await running);
        assert.deepEqual(await state(db), committed, 'editor changes nothing after legitimate operation commits');
      } finally {
        resume.resolve();
        await running;
      }
    }
    edit.assertReadOnly();
    const final = await state(db);
    operation.check(final);
    assert.equal(final.pedido.valor_total_centavos, 10000);
    assert.equal(final.itens.length, 1);
    assert.equal(final.itens[0].id, 1);
    assert.equal(final.itens[0].quantidade, 2);
    assert.equal(final.itens[0].valor_total_centavos, 10000);
  });
}
