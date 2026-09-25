import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state, barrier, isProjection, isPhysical, refund, withWaitUntil } from './helpers/b3.mjs';

const reconcile = db => app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
const approve = async db => app.sync.syncPaymentFromMp(db, 1, await app.sync.fetchMpPayment('fake', '101'));

// operationKey: contrato A1, obrigatório nos endpoints. Uma key fixa por
// helper mantém as asserções B3 inalteradas (cada teste usa um D1 novo).
async function adminOperation(db, kind, amount, operationKey = `b3-${kind}-${amount}`) {
  const session = await app.auth.createSession(db, 1);
  return () => app[kind === 'PAGAMENTO' ? 'adminPayment' : 'adminRefund'].onRequestPost({
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'POST', headers: {Cookie: session.cookie.split(';')[0], Origin: 'https://local.test', 'Content-Type': 'application/json'},
      body: JSON.stringify(kind === 'PAGAMENTO'
        ? {metodo: 'DINHEIRO', valorCentavos: amount, operationKey}
        : {pagamentoId: 1, valorCentavos: amount, operationKey}),
    }),
    env: {DB: db}, params: {id: '1'},
  });
}

function assertPersistedFactLog(log, kind, id) {
  const entry = log.mock.calls.find(c => c.arguments[0] ===
    'Fato financeiro administrativo persistido; falha nos efeitos derivados');
  assert.ok(entry, 'post-commit failure must leave diagnostic evidence');
  assert.deepEqual(entry.arguments[1], {pedidoId: 1, operacao: kind, fatoId: id});
  assert.match(entry.arguments[2].message, /injected/);
}

for (const [amount, stage] of [[4000, 'projection'], [10000, 'projection'], [10000, 'stock']]) {
  test(`admin payment ${amount}: ${stage} failure after commit returns 201 and sweep recovers without another payment`, async t => {
    const db = await fixture(t, {ledger: false});
    const call = await adminOperation(db, 'PAGAMENTO', amount);
    const log = t.mock.method(console, 'error', () => {});
    db.hook = (s, op) => {
      if (stage === 'projection' ? op === 'first' && isProjection(s[0].sql) : op === 'batch' && isPhysical(s)) {
        db.hook = null;
        throw new Error('injected post-payment failure');
      }
    };
    const response = await call();
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body, {ok: true, pagamentoId: 1});
    assertPersistedFactLog(log, 'PAGAMENTO', body.pagamentoId);
    const pending = await state(db);
    assert.equal(pending.pagamentos.length, 1);
    assert.equal(pending.pagamentos[0].status, 'PAGO');
    assert.equal(pending.pagamentos[0].valor_centavos, amount);
    assert.equal(pending.pedido.status_pagamento, stage === 'projection' ? 'PENDENTE' : 'PAGO');
    assert.equal(pending.pedido.estoque_baixado_em, null);
    assert.equal(pending.produtos[0].estoque, 10);
    await app.reconcile.reconcilePedidosDivergentes(db);
    const recovered = await state(db);
    assert.deepEqual(recovered.pagamentos, pending.pagamentos);
    assert.deepEqual(recovered.alocacoes, pending.alocacoes);
    assert.equal(recovered.pedido.status_pagamento, amount === 10000 ? 'PAGO' : 'PARCIAL');
    assert.equal(recovered.produtos[0].estoque, amount === 10000 ? 8 : 10);
    assert.equal(Boolean(recovered.pedido.estoque_baixado_em), amount === 10000);
    await reconcile(db);
    assert.deepEqual(await state(db), recovered);
  });
}

for (const amount of [3000, 10000]) {
  test(`admin refund ${amount}: projection failure after commit returns 201 and sweep recovers without another refund`, async t => {
    const db = await fixture(t, {paid: true});
    await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
    await reconcile(db);
    const before = await state(db);
    const call = await adminOperation(db, 'REEMBOLSO', amount);
    const log = t.mock.method(console, 'error', () => {});
    db.hook = (s, op) => {
      if (op === 'first' && isProjection(s[0].sql)) {
        db.hook = null;
        throw new Error('injected post-refund failure');
      }
    };
    const response = await call();
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body, {ok: true, reembolsoId: 1});
    assertPersistedFactLog(log, 'REEMBOLSO', body.reembolsoId);
    const pending = await state(db);
    assert.equal(pending.refunds.length, 1);
    assert.equal(pending.refunds[0].status, 'REEMBOLSADO');
    assert.equal(pending.refunds[0].valor_centavos, amount);
    assert.equal(pending.pedido.status_pagamento, 'PAGO');
    await app.reconcile.reconcilePedidosDivergentes(db);
    const recovered = await state(db);
    assert.equal(recovered.pedido.status_pagamento, amount === 10000 ? 'PENDENTE' : 'PARCIAL');
    assert.deepEqual(recovered.refunds, pending.refunds);
    assert.deepEqual(recovered.pagamentos, before.pagamentos);
    assert.deepEqual(recovered.alocacoes, before.alocacoes);
    assert.deepEqual(recovered.produtos, before.produtos);
    assert.deepEqual(recovered.itens, before.itens);
    assert.equal(recovered.pedido.estoque_baixado_em, before.pedido.estoque_baixado_em);
    await reconcile(db);
    assert.deepEqual(await state(db), recovered);
  });
}

for (const kind of ['PAGAMENTO', 'REEMBOLSO']) {
  test(`admin ${kind}: balance read failure after reconciliation still confirms persisted fact`, async t => {
    const db = await fixture(t, {ledger: kind === 'REEMBOLSO', paid: true});
    if (kind === 'REEMBOLSO') {
      await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
      await reconcile(db);
    }
    const call = await adminOperation(db, kind, 3000);
    const log = t.mock.method(console, 'error', () => {});
    db.hook = (s, op) => {
      if (op === 'first' && s[0].sql === 'SELECT valor_total_centavos FROM pedidos WHERE id = ?') {
        db.hook = null;
        throw new Error('injected balance read failure');
      }
    };
    const response = await call();
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {ok: true, [kind === 'PAGAMENTO' ? 'pagamentoId' : 'reembolsoId']: 1});
    assertPersistedFactLog(log, kind, 1);
    const s = await state(db);
    assert.equal(s.pagamentos.length, 1);
    assert.equal(s.refunds.length, kind === 'REEMBOLSO' ? 1 : 0);
    assert.equal(s.pedido.status_pagamento, 'PARCIAL');
  });

  test(`admin ${kind}: failure before financial commit remains an error with no new fact`, async t => {
    const db = await fixture(t, {ledger: kind === 'REEMBOLSO', paid: true});
    if (kind === 'REEMBOLSO') await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
    const call = await adminOperation(db, kind, 3000);
    const before = await state(db);
    const log = t.mock.method(console, 'error', () => {});
    // A1 tornou a escrita do refund atômica com o claim da operação, então
    // ela também viaja num batch. O ponto de injeção continua sendo o mesmo
    // ("antes do commit financeiro") e as asserções não mudaram.
    db.hook = (s, op) => {
      if ((op === 'batch' || op === 'run') && s[0].sql.includes(
        kind === 'PAGAMENTO' ? 'INSERT INTO pedido_pagamentos' : 'INSERT INTO pedido_reembolsos')) {
        db.hook = null;
        throw new Error('injected pre-commit failure');
      }
    };
    const response = await call();
    assert.equal(response.status, kind === 'PAGAMENTO' ? 409 : 500);
    assert.ok((await response.json()).error);
    assert.deepEqual(await state(db), before);
    assert.equal(log.mock.calls.some(c => c.arguments[0].startsWith('Fato financeiro administrativo persistido')), false);
  });
}

test('admin payment and refund validation failures still reject before persistence', async t => {
  const db = await fixture(t, {ledger: false});
  assert.deepEqual(await app.ledger.registerAdminPayment(db,
    {pedidoId: 1, metodo: 'DINHEIRO', valorCentavos: 11000, usuarioId: 1}),
    {ok: false, erro: 'VALOR_ACIMA_DO_SALDO'});
  assert.deepEqual(await app.ledger.registerManualRefund(db,
    {pedidoId: 1, pagamentoId: 999, valorCentavos: 3000, usuarioId: 1}),
    {ok: false, erro: 'PAGAMENTO_NAO_ENCONTRADO'});
  const s = await state(db);
  assert.equal(s.pagamentos.length, 0);
  assert.equal(s.refunds.length, 0);
});

function converted(s) {
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.ok(s.pedido.estoque_baixado_em);
  assert.ok(s.itens[0].estoque_baixado_em);
  assert.equal(s.itens[0].estoque_estado, 'BAIXADO');
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 0);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.alocacoes.length, 1);
  assert.equal(s.refunds.length, 0);
}

test('A: approval confirms ledger, projection and stock', async t => {
  const db = await fixture(t);
  assert.equal((await approve(db)).transicionou, true);
  converted(await state(db));
});

test('B/C: PAGO ledger + PENDENTE order converges; 100 repeats preserve all domain data', async t => {
  const db = await fixture(t, { paid: true });
  const result = await reconcile(db);
  assert.equal(result.estoque.baixado, true);
  const before = await state(db);
  converted(before);
  for (let i = 0; i < 100; i++) assert.equal((await reconcile(db)).estoque.baixado, false);
  assert.deepEqual(await state(db), before);
});

for (const [label, match] of [
  ['G: failure between ledger and projection', (s, op) => op === 'first' && s.some(x => isProjection(x.sql))],
  ['H: failure between projection and stock', (s, op) => op === 'batch' && isPhysical(s)],
]) test(`${label}; identical approved retry repairs effects`, async t => {
  const db = await fixture(t);
  db.hook = (s, op) => { if (match(s, op)) { db.hook = null; throw new Error('injected transient D1 failure'); } };
  await assert.rejects(approve(db), /injected/);
  const intermediate = await state(db);
  assert.equal(intermediate.pagamentos[0].status, 'PAGO');
  assert.equal(intermediate.pedido.status_pagamento, label.startsWith('G') ? 'PENDENTE' : 'PAGO');
  assert.equal(intermediate.pedido.estoque_baixado_em, null);
  assert.equal((await approve(db)).transicionou, false);
  converted(await state(db));
});

test('F: concurrent approved events and concurrent physical batches debit once', async t => {
  const db = await fixture(t);
  const paymentGate = barrier(2);
  const stockGate = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'first' && s[0].sql.includes('SELECT id, pedido_id, status FROM pedido_pagamentos')) await paymentGate();
    if (op === 'batch' && isPhysical(s)) await stockGate();
  };
  const results = await Promise.all([approve(db), approve(db)]);
  db.hook = null;
  assert.equal(results.filter(r => r.transicionou).length, 1);
  converted(await state(db));
});

test('D: partial net corrects stale PAGO without physical effects', async t => {
  const db = await fixture(t, { paid: true });
  await db.prepare("UPDATE pedido_pagamentos SET valor_centavos=4000 WHERE id=1").run();
  await db.prepare("UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1").run();
  assert.equal((await reconcile(db)).statusFinanceiro, 'PARCIAL');
  const s = await state(db);
  assert.equal(s.produtos[0].estoque, 10);
  assert.equal(s.produtos[0].estoque_reservado, 2);
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.pedido.estoque_baixado_em, null);
});

for (const amount of [3000, 10000]) test(`E: manual refund ${amount} corrects net without returning stock`, async t => {
  const db = await fixture(t, { paid: true });
  await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
  await reconcile(db);
  const before = await state(db);
  const r = await app.ledger.registerManualRefund(db, { pedidoId: 1, pagamentoId: 1, valorCentavos: amount, usuarioId: 1 });
  assert.equal(r.ok, true);
  for (let i = 0; i < 10; i++) await reconcile(db);
  const after = await state(db);
  assert.equal(after.pedido.status_pagamento, amount === 10000 ? 'PENDENTE' : 'PARCIAL');
  assert.deepEqual(after.produtos, before.produtos);
  assert.deepEqual(after.itens, before.itens);
  assert.deepEqual(after.pagamentos, before.pagamentos);
  assert.deepEqual(after.alocacoes, before.alocacoes);
  assert.equal(after.refunds.length, 1);
  assert.equal(after.pedido.reserva_status, 'CONVERTIDA');
});

test('LIBERADA recognizes payment and never consumes another order reservation', async t => {
  const db = await fixture(t, { paid: true, reserve: 'LIBERADA' });
  await db.prepare('UPDATE produtos SET estoque_reservado=3 WHERE id=1').run();
  await reconcile(db);
  const s = await state(db);
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 3);
  await reconcile(db);
  assert.deepEqual(await state(db), s);
});

test('insufficient free stock preserves PAGO and retries after stock becomes available', async t => {
  const db = await fixture(t, { paid: true, reserve: 'LIBERADA' });
  await db.prepare('UPDATE produtos SET estoque=4,estoque_reservado=3 WHERE id=1').run();
  const result = await reconcile(db);
  assert.equal(result.statusFinanceiro, 'PAGO');
  assert.equal(result.estoque.erro, 'ESTOQUE_INSUFICIENTE');
  const s = await state(db);
  assert.equal(s.pedido.estoque_baixado_em, null);
  assert.equal(s.produtos[0].estoque, 4);
  assert.equal(s.produtos[0].estoque_reservado, 3);
  await db.prepare('UPDATE produtos SET estoque=5 WHERE id=1').run();
  await reconcile(db);
  assert.equal((await state(db)).produtos[0].estoque, 3);
});

test('physical batch rollback leaves neither product nor item partially debited', async t => {
  const db = await fixture(t, { paid: true });
  db.hook = (s, op) => {
    if (op === 'batch' && isPhysical(s)) {
      db.hook = null;
      const i = s.findIndex(x => x.sql.includes('estoque = estoque -'));
      return [...s.slice(0, i + 1), { sql: 'INSERT INTO missing_b3_test_table VALUES (1)', args: [] }, ...s.slice(i + 1)];
    }
  };
  await assert.rejects(reconcile(db), /missing_b3_test_table/);
  const s = await state(db);
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.produtos[0].estoque, 10);
  assert.equal(s.produtos[0].estoque_reservado, 2);
  assert.equal(s.itens[0].estoque_baixado_em, null);
  await reconcile(db);
  converted(await state(db));
});

test('refund committed between projection and physical batch prevents debit', async t => {
  const db = await fixture(t, { paid: true });
  db.hook = async (s, op) => {
    if (op === 'batch' && isPhysical(s)) { db.hook = null; await refund(db, 3000); }
  };
  assert.equal((await reconcile(db)).statusFinanceiro, 'PARCIAL');
  const s = await state(db);
  assert.equal(s.produtos[0].estoque, 10);
  assert.equal(s.produtos[0].estoque_reservado, 2);
  assert.equal(s.pedido.estoque_baixado_em, null);
});

test('projection computes current total and refunds at write, not an older JS snapshot', async t => {
  const db = await fixture(t, { paid: true });
  db.hook = async (s, op) => {
    if (op === 'first' && isProjection(s[0].sql)) {
      db.hook = null;
      await db.prepare('UPDATE pedidos SET valor_total_centavos=15000 WHERE id=1').run();
      await refund(db, 1000);
    }
  };
  assert.equal((await reconcile(db)).statusFinanceiro, 'PARCIAL');
  assert.equal((await state(db)).produtos[0].estoque, 10);
});

test('opportunistic recovery finds confirmed ledger without mp id and corrects stale refunded projection', async t => {
  const db = await fixture(t, { paid: true });
  await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
  await app.reconcile.reconcilePedidosDivergentes(db);
  converted(await state(db));
  await refund(db, 10000);
  await app.reconcile.reconcilePedidosDivergentes(db);
  const s = await state(db);
  assert.equal(s.pedido.status_pagamento, 'PENDENTE');
  assert.equal(s.produtos[0].estoque, 8);
});

for (const handler of ['polling', 'detail']) test(`${handler}: early return with expired QR still repairs already confirmed ledger`, async t => {
  const db = await fixture(t, { paid: true });
  await db.prepare("UPDATE pedidos SET pix_expira_em='2000-01-01T00:00:00Z' WHERE id=1").run();
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network must not be used'); });
  for (let i = 0; i < 2; i++) {
    // M7: a recuperação é o POST /api/pedido-status; os GETs só leem.
    const env = {DB:db,MP_ACCESS_TOKEN:'fake'};
    const post = await app.polling.onRequestPost({env, request: new Request('https://local.test/api/pedido-status?token=token',
      {method: 'POST', headers: {Origin: 'https://local.test'}})});
    assert.equal(post.status, 200);
    const response = await app[handler].onRequestGet({request: new Request('https://local.test/api/pedido?token=token'), env});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).statusPagamento, 'PAGO');
  }
  converted(await state(db));
});

test('signed webhook retry repairs a failure after ledger commit', async t => {
  const db = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({id:101,status:'approved'}));
  const secret = 'local-test-only';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('id:101;request-id:b3;ts:1;'))).toString('hex');
  const call = () => app.webhook.onRequestPost({
    request:new Request('https://local.test/api/webhooks/mercadopago?data.id=101&type=payment', {method:'POST',headers:{'x-signature':`ts=1,v1=${signature}`,'x-request-id':'b3'}}),
    env:{DB:db,MP_ACCESS_TOKEN:'fake',MP_WEBHOOK_SECRET:secret},
  });
  db.hook = (s, op) => { if (op === 'first' && isProjection(s[0].sql)) {db.hook=null;throw new Error('injected projection failure');} };
  assert.equal((await call()).status,502);
  assert.equal((await call()).status,200);
  assert.equal((await call()).status,200);
  converted(await state(db));
});

test('legacy without ledger and missing order are explicit non-mutating results', async t => {
  const db = await fixture(t, { ledger:false });
  await db.prepare("UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1").run();
  const before=await state(db);
  assert.deepEqual(await reconcile(db), {ok:false,motivo:'LEGADO_SEM_LEDGER'});
  await app.reconcile.reconcilePedidosDivergentes(db);
  assert.deepEqual(await state(db),before);
  assert.deepEqual(await app.reconcile.reconcilePedidoAfterFinancialChange(db,999),{ok:false,motivo:'PEDIDO_NAO_ENCONTRADO'});
});

test('item BAIXADO is authoritative even if the global projection is stale', async t => {
  const db = await fixture(t, { paid:true, reserve:'CONVERTIDA' });
  await db.prepare("UPDATE pedidos SET reserva_status='ATIVA',estoque_baixado_em=NULL WHERE id=1").run();
  assert.deepEqual((await reconcile(db)).estoque,{ok:true,baixado:false});
  const s = await state(db);
  assert.equal(s.produtos[0].estoque,10);
  assert.equal(s.pedido.reserva_status,'CONVERTIDA');
  assert.ok(s.pedido.estoque_baixado_em);
});

test('another conversion completed between reads is a successful no-op', async t => {
  const db=await fixture(t,{paid:true});
  db.hook=async (s,op)=>{
    if (op==='all' && s[0].sql.includes('SELECT id, produto_id, quantidade') &&
        s[0].sql.includes('FROM pedido_itens')) {
      db.hook=null;
      await reconcile(db);
    }
  };
  const result=await reconcile(db);
  assert.deepEqual(result.estoque,{ok:true,baixado:false});
  converted(await state(db));
});

test('admin GET repairs a paid ledger before the stale reservation expiration sweep', async t => {
  const db=await fixture(t,{paid:true});
  await db.prepare("UPDATE pedidos SET reserva_expira_em='2000-01-01' WHERE id=1").run();
  const session=await app.auth.createSession(db,1);
  const list=()=>withWaitUntil(app.admin.onRequestGet, {
    request:new Request('https://local.test/api/admin/pedidos',{headers:{Cookie:session.cookie.split(';')[0]}}),env:{DB:db},
  });
  // The repair now runs off `context.waitUntil` instead of blocking the
  // response (deliberate since "stop blocking orders list on Mercado
  // Pago"), so the FIRST response can still read the pre-repair projection.
  // `withWaitUntil` still lets the test wait for that background work
  // deterministically; the repair itself is what this test verifies, via
  // the ledger/stock state and a second listing read.
  const first=await list();
  assert.equal(first.status,200);
  converted(await state(db));
  const second=await list();
  assert.equal((await second.json()).total,1,'a leitura seguinte já reflete o reparo feito em segundo plano');
});

test('manual payment uses the convergent result without changing registration semantics', async t => {
  const db=await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET metodo='A_COMBINAR',origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
  const result=await app.ledger.registerAdminPayment(db,{pedidoId:1,metodo:'DINHEIRO',valorCentavos:10000,usuarioId:1});
  assert.equal(result.ok,true);
  assert.equal(result.statusFinanceiro,'PAGO');
  const s=await state(db);
  assert.equal(s.pagamentos.length,2);
  assert.equal(s.pagamentos[0].status,'CANCELADO');
  assert.equal(s.pagamentos[1].status,'PAGO');
  assert.equal(s.produtos[0].estoque,8);
  await reconcile(db);
  assert.deepEqual(await state(db),s);
});

test('non-terminal MP snapshot still repairs persisted PAGO; terminal matrix stays unchanged', async t => {
  const db=await fixture(t,{paid:true});
  t.mock.method(globalThis, 'fetch', async () => Response.json({id:101,status:'pending'}));
  const result=await app.sync.syncPaymentFromMp(db,1,await app.sync.fetchMpPayment('fake','101'));
  assert.equal(result.transicionou,false);
  assert.equal(result.status,'PAGO');
  converted(await state(db));
  await db.prepare("UPDATE pedidos SET status_pagamento='PENDENTE' WHERE id=1").run();
  t.mock.method(globalThis, 'fetch', async () => Response.json({id:101,status:'cancelled'}));
  assert.equal((await app.sync.syncPaymentFromMp(db,1,await app.sync.fetchMpPayment('fake','101'))).status,'PAGO');
  converted(await state(db));
});

test('B2: verified MP approval now recovers local expiration', async t => {
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  assert.equal((await approve(db)).status,'PAGO');
  converted(await state(db));
});

test('generic reconciliation never releases even with only expired payments', async t => {
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  await db.prepare("UPDATE pedidos SET reserva_status='ATIVA' WHERE id=1").run();
  await db.prepare('UPDATE produtos SET estoque_reservado=2 WHERE id=1').run();
  await reconcile(db);
  assert.equal((await state(db)).pedido.reserva_status,'ATIVA');
  assert.equal((await state(db)).produtos[0].estoque_reservado,2);
});

test('B4 protects another pending Pix when one payment is cancelled', async t => {
  const db=await fixture(t);
  await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'PIX_MP','ADMIN',5000,'PENDENTE','second')").run();
  t.mock.method(globalThis, 'fetch', async () => Response.json({id:101,status:'cancelled'}));
  await app.sync.syncPaymentFromMp(db,1,await app.sync.fetchMpPayment('fake','101'));
  assert.equal((await state(db)).pedido.reserva_status,'ATIVA');
  assert.equal((await state(db)).produtos[0].estoque_reservado,2);
});
