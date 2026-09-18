import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, barrier, isProjection, refund} from './helpers/b3.mjs';

const env = db => ({DB:db, MP_ACCESS_TOKEN:'fake'});
const reconcile = db => app.reconcile.reconcilePedidoAfterFinancialChange(db,1);
const release = db => app.stock.liberarReservaPedido(db,1);
const isRelease = s => s.some(x=>x.sql.includes("reserva_status = 'LIBERADA'"));
const isCreation = s => s.some(x=>x.sql.includes('INSERT INTO pedido_pagamentos')) &&
  s.some(x=>x.sql.includes('substitui_pagamento_id'));
const create = (db, extra={}) => app.pix.createAdminPixCharge(env(db),{pedidoId:1,usuarioId:1,valorCentavos:5000,...extra});
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
function remote(t, statuses={}) {
  let id=200;
  return t.mock.method(globalThis,'fetch',async (url,options)=> {
    assert.match(String(url),/^https:\/\/api\.mercadopago\.com\/v1\/payments/);
    if(options?.method==='POST') return Response.json({id:++id,status:'pending',date_of_expiration:'2099-01-01'});
    const paymentId=Number(String(url).split('/').at(-1));
    return Response.json({id:paymentId,status:statuses[paymentId]??'pending'});
  });
}
const sync = async (db,id,mpId) => app.sync.syncPaymentFromMp(db,id,await app.sync.fetchMpPayment('fake',String(mpId)));
async function second(db,{method='PIX_MP',mpId='102',deadline=null,substitui=null}={}) {
  await db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
    mp_payment_id,pix_expira_em,idempotency_key,substitui_pagamento_id)
    VALUES(2,1,?,'ADMIN',5000,'PENDENTE',?,?,'second',?)`).bind(method,mpId,deadline,substitui).run();
}
function reserved(s) {
  assert.equal(s.pedido.reserva_status,'ATIVA');
  assert.equal(s.produtos[0].estoque_reservado,2);
  assert.equal(s.produtos[0].estoque,10);
  assert.equal(s.pedido.estoque_baixado_em,null);
}
function released(s) {
  assert.equal(s.pedido.reserva_status,'LIBERADA');
  assert.equal(s.produtos[0].estoque_reservado,0);
  assert.equal(s.produtos[0].estoque,10);
  assert.equal(s.pedido.estoque_baixado_em,null);
}

for(const status of ['cancelled','expired']) for(const origin of ['ADMIN','SITE']) {
  test(`A/B/C: ${origin} ${status} retains another ADMIN Pix; last terminal releases once`,async t=>{
    const db=await fixture(t); await second(db);
    await db.prepare('UPDATE pedido_pagamentos SET origem=? WHERE id=1').bind(origin).run();
    const statuses={101:status,102:status}; remote(t,statuses);
    await sync(db,1,101); reserved(await state(db));
    await sync(db,2,102); released(await state(db));
    const before=await state(db);
    await sync(db,1,101); await sync(db,2,102); await release(db);
    const after=await state(db);
    assert.deepEqual(after.produtos,before.produtos);
    assert.deepEqual(after.pedido,before.pedido);
    assert.deepEqual(after.pagamentos.map(({atualizado_em,...p})=>p),before.pagamentos.map(({atualizado_em,...p})=>p));
  });
}

for(const oldDies of [true,false]) test(`D: real regeneration; terminalizing ${oldDies?'original':'successor'} retains the other`,async t=>{
  const db=await fixture(t,{ledger:false}); const statuses={}; remote(t,statuses);
  const a=await create(db); assert.equal(a.ok,true);
  const b=await create(db,{substituiId:a.pagamentoId}); assert.equal(b.ok,true);
  const first=oldDies?a:b, last=oldDies?b:a;
  statuses[Number(first.mpPaymentId)]='cancelled';
  await sync(db,first.pagamentoId,first.mpPaymentId); reserved(await state(db));
  statuses[Number(last.mpPaymentId)]='expired';
  await sync(db,last.pagamentoId,last.mpPaymentId); released(await state(db));
});

for(const extra of [{mpId:null},{deadline:'2000-01-01'},{substitui:1}]) {
  test(`pending relevance ignores remote ID, deadline and substitution: ${JSON.stringify(extra)}`,async t=>{
    const db=await fixture(t); await second(db,extra);
    await app.sync.expireLocalPayment(db,1); reserved(await state(db));
  });
}
for(const method of ['A_COMBINAR','DINHEIRO','CARTAO','PIX_EXTERNO']) test(`local placeholder ${method} does not block release`,async t=>{
  const db=await fixture(t); await second(db,{method,mpId:null});
  await app.sync.expireLocalPayment(db,1); released(await state(db));
  assert.equal((await state(db)).pagamentos[1].status,'PENDENTE');
});

for(const amount of [5000,10000]) test(`E: confirmed ${amount} between projection and release batch blocks release`,async t=>{
  const db=await fixture(t); await second(db); remote(t,{101:'cancelled'});
  let injected=false;
  db.hook=async (s,op)=>{
    if(op==='batch' && isRelease(s) && !injected) {
      injected=true;
      await db.prepare("UPDATE pedido_pagamentos SET status='PAGO',valor_centavos=? WHERE id=2").bind(amount).run();
      assert.equal((await state(db)).pedido.status_pagamento,'PENDENTE');
    }
  };
  await sync(db,1,101); assert.equal(injected,true); reserved(await state(db));
  assert.equal((await state(db)).pedido.status_pagamento,amount===10000?'PAGO':'PARCIAL');
  await reconcile(db);
  const s=await state(db);
  assert.equal(s.produtos[0].estoque,amount===10000?8:10);
  assert.equal(s.pedido.reserva_status,amount===10000?'CONVERTIDA':'ATIVA');
});

test('F: two terminalizations meet at writes and release batches; exactly one decrement',async t=>{
  const db=await fixture(t); await second(db); remote(t,{101:'cancelled',102:'expired'});
  const writes=barrier(2), batches=barrier(2); let attempts=0;
  db.hook=async (s,op)=>{
    if(op==='run' && s[0].sql.includes('SET status = ?')) await writes();
    if(op==='batch' && isRelease(s)) {attempts++; await batches();}
  };
  await Promise.all([sync(db,1,101),sync(db,2,102)]);
  assert.equal(attempts,2); released(await state(db));
});

test('CAS loser still finalizes an already persisted terminal state',async t=>{
  const db=await fixture(t); let injected=false;
  db.hook=async (s,op)=>{
    if(op==='run' && s[0].sql.includes('SET status = ?') && !injected) {
      injected=true;
      await db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run();
    }
  };
  const r=await app.sync.expireLocalPayment(db,1);
  assert.equal(r.transicionou,false); assert.equal(injected,true); released(await state(db));
});

test('G: paid/converted order ignores late cancellation and refund never restores stock',async t=>{
  const db=await fixture(t,{paid:true}); await second(db); remote(t,{102:'cancelled'});
  await reconcile(db); const before=await state(db);
  await sync(db,2,102); await release(db);
  assert.deepEqual((await state(db)).produtos,before.produtos);
  assert.equal((await state(db)).pedido.reserva_status,'CONVERTIDA');
  await refund(db,10000); await reconcile(db); await release(db);
  assert.deepEqual((await state(db)).produtos,before.produtos);
  assert.equal((await state(db)).pedido.reserva_status,'CONVERTIDA');
});

test('H: expired/released late payment remains authoritative and B3 reclaims once',async t=>{
  const db=await fixture(t); await app.sync.expireLocalPayment(db,1); released(await state(db));
  await db.prepare('UPDATE produtos SET estoque=3,estoque_reservado=2 WHERE id=1').run();
  remote(t,{101:'approved'}); t.mock.method(console,'error',()=>{});
  await sync(db,1,101);
  let s=await state(db); assert.equal(s.pagamentos[0].status,'PAGO');
  assert.equal(s.pedido.estoque_baixado_em,null); assert.equal(s.produtos[0].estoque_reservado,2);
  await db.prepare('UPDATE produtos SET estoque=10 WHERE id=1').run();
  await app.reconcile.reconcilePedidosDivergentes(db); await reconcile(db);
  s=await state(db); assert.equal(s.produtos[0].estoque,8); assert.equal(s.produtos[0].estoque_reservado,2);
  assert.equal(s.pedido.reserva_status,'CONVERTIDA'); assert.equal(s.pagamentos.length,1);
});

for(const path of ['polling','sweep']) test(`SITE + ADMIN: ${path} expiration retains ADMIN reserve`,async t=>{
  const db=await fixture(t); await second(db); remote(t);
  await db.prepare("UPDATE pedidos SET pix_expira_em='2000-01-01',reserva_expira_em='2000-01-01' WHERE id=1").run();
  await db.prepare("UPDATE pedido_pagamentos SET pix_expira_em='2000-01-01' WHERE id=1").run();
  if(path==='sweep') await app.sync.liberarReservasVencidasLocalmente(env(db));
  else {
    const r=await app.polling.onRequestGet({env:env(db),request:new Request('https://local.test/api/pedido-status?token=token')});
    assert.equal(r.status,200);
  }
  reserved(await state(db)); assert.equal((await state(db)).pagamentos[0].status,'EXPIRADO');
});

test('creation wins before release write: new pending Pix protects existing reservation and TTL',async t=>{
  const db=await fixture(t); remote(t); const before=await state(db); let inserted=false;
  db.hook=async (s,op)=>{
    if(op==='batch' && isRelease(s) && !inserted) {
      inserted=true; assert.equal((await create(db)).ok,true);
    }
  };
  await app.sync.expireLocalPayment(db,1); assert.equal(inserted,true); reserved(await state(db));
  assert.equal((await state(db)).pedido.reserva_expira_em,before.pedido.reserva_expira_em);
});

for(const insufficient of [false,true]) test(`release wins after creation read; reacquire insufficient=${insufficient}`,async t=>{
  const db=await fixture(t); const mp=remote(t); let expired=false;
  db.hook=async (s,op)=>{
    if(op==='batch' && isCreation(s) && !expired) {
      expired=true; await app.sync.expireLocalPayment(db,1); released(await state(db));
      if(insufficient) await db.prepare('UPDATE produtos SET estoque_reservado=9 WHERE id=1').run();
    }
  };
  const result=await create(db); assert.equal(expired,true);
  assert.equal(result.ok,!insufficient);
  const s=await state(db);
  if(insufficient) {
    assert.equal(result.erro,'ESTOQUE_INSUFICIENTE'); assert.equal(mp.mock.callCount(),0);
    assert.equal(s.pedido.reserva_status,'LIBERADA'); assert.equal(s.produtos[0].estoque_reservado,9);
    assert.equal(s.pagamentos.length,1); assert.equal(s.alocacoes.length,1);
  } else {reserved(s); assert.equal(mp.mock.callCount(),1); assert.equal(s.pagamentos.length,2);}
});

test('two concurrent admin creations acquire one reservation and preserve capacity',async t=>{
  const db=await fixture(t,{reserve:'LIBERADA',ledger:false}); remote(t);
  const gate=barrier(2); let calls=0;
  db.hook=async (s,op)=>{if(op==='batch' && isCreation(s)){calls++;await gate();}};
  const results=await Promise.all([create(db),create(db)]);
  assert.equal(calls,2); assert.ok(results.every(r=>r.ok)); reserved(await state(db));
  assert.equal((await state(db)).pagamentos.length,2);
  assert.equal(await app.pix.getCapacidadeCobravel(db,1),0);
});

for(const marked of ['CONVERTIDA','order','item']) test(`creation never reopens physical state ${marked}`,async t=>{
  const db=await fixture(t,{reserve:'LIBERADA',ledger:false}); const mp=remote(t);
  if(marked==='CONVERTIDA') await db.prepare("UPDATE pedidos SET reserva_status='CONVERTIDA' WHERE id=1").run();
  if(marked==='order') await db.prepare("UPDATE pedidos SET estoque_baixado_em='2026-01-01' WHERE id=1").run();
  if(marked==='item') await db.prepare("UPDATE pedido_itens SET estoque_baixado_em='2026-01-01' WHERE id=1").run();
  const before=await state(db);
  await assert.rejects(create(db),/NOT NULL/); // conditional INSERT refused; allocations roll back the whole batch
  assert.deepEqual(await state(db),before); assert.equal(mp.mock.callCount(),0);
});

test('release transaction rolls back products and marker; repeated expiration recovers',async t=>{
  const db=await fixture(t); t.mock.method(console,'error',()=>{});
  db.hook=(s,op)=>{
    if(op==='batch' && isRelease(s)) {db.hook=null;return [...s,{sql:'SELECT * FROM missing_b4_table',args:[]}];}
  };
  await assert.rejects(app.sync.expireLocalPayment(db,1),/ERRO_TRANSACIONAL_LIBERACAO/);
  reserved(await state(db)); assert.equal((await state(db)).pagamentos[0].status,'EXPIRADO');
  await app.sync.expireLocalPayment(db,1); released(await state(db));
});

for(const status of ['cancelled','expired']) test(`durable ${status} after projection failure: generic recovery never releases; same-state retry does`,async t=>{
  const db=await fixture(t); remote(t,{101:status}); t.mock.method(console,'error',()=>{});
  db.hook=(s,op)=>{if(op==='first' && isProjection(s[0].sql)){db.hook=null;throw new Error('injected projection failure');}};
  await assert.rejects(sync(db,1,101),/injected/); reserved(await state(db));
  await app.reconcile.reconcilePedidosDivergentes(db);
  await app.sync.liberarReservasVencidasLocalmente(env(db));
  await reconcile(db); reserved(await state(db));
  await db.prepare("UPDATE pedido_pagamentos SET atualizado_em='2000-01-01' WHERE id=1").run();
  await app.sync.reconcilePendingPixPayments(env(db));
  if(status==='cancelled') reserved(await state(db)); // CANCELADO is not a sweep candidate
  else released(await state(db)); // existing financial sweep can retry EXPIRADO with an MP ID
  await sync(db,1,101); released(await state(db));
});

test('expired without remote ID remains retained after interrupted finalization until explicit retry',async t=>{
  const db=await fixture(t); await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
  db.hook=(s,op)=>{if(op==='first' && isProjection(s[0].sql)){db.hook=null;throw new Error('injected');}};
  await assert.rejects(app.sync.expireLocalPayment(db,1),/injected/);
  await app.reconcile.reconcilePedidosDivergentes(db);
  await app.sync.reconcilePendingPixPayments(env(db));
  await app.sync.liberarReservasVencidasLocalmente(env(db)); reserved(await state(db));
  await app.sync.expireLocalPayment(db,1); released(await state(db));
});

// A política mudou deliberadamente: cancelar com Pix vivo passou a ser
// RECUSADO (ver tests/cancelamento-pix.test.mjs). O que este teste guarda
// continua valendo e é o que importa aqui: a tentativa nunca é terminalizada
// pelo cancelamento e a reserva do pedido não se move.
test('operational cancellation is refused and never terminalizes the live Pix',async t=>{
  const db=await fixture(t); const session=await app.auth.createSession(db,1);
  const r=await app.adminOrder.onRequestPatch({env:env(db),params:{id:'1'},request:new Request('https://local.test/api/admin/pedidos/1',{
    method:'PATCH',headers:{Cookie:session.cookie.split(';')[0]},body:JSON.stringify({statusPedido:'CANCELADO'}),
  })});
  assert.equal(r.status,409);
  assert.equal((await r.json()).code,'PEDIDO_COM_PIX_PENDENTE');
  reserved(await state(db));
  assert.equal((await state(db)).pedido.status_pedido,'NOVO');
  assert.equal((await state(db)).pagamentos[0].status,'PENDENTE');
});

for(const path of ['ADMIN','SITE']) for(const status of ['approved','cancelled','expired']) {
  test(`late ${path} POST refusal cannot overwrite verified ${status}`,async t=>{
    const db=await fixture(t,{ledger:false,reserve:'LIBERADA'}); t.mock.method(console,'error',()=>{});
    if(path==='SITE') await db.prepare('DELETE FROM pedidos WHERE id=1').run();
    let confirmed;
    t.mock.method(globalThis,'fetch',async (url,options)=>{
      assert.match(String(url),/^https:\/\/api\.mercadopago\.com\/v1\/payments/);
      if(options?.method!=='POST') return Response.json({id:101,status});
      const payment=await db.prepare('SELECT id FROM pedido_pagamentos ORDER BY id DESC LIMIT 1').first();
      await db.prepare("UPDATE pedido_pagamentos SET mp_payment_id='101' WHERE id=?").bind(payment.id).run();
      await sync(db,payment.id,101); // webhook/GET path wins before POST completes
      confirmed=await state(db);
      return new Response('definitive rejection',{status:400});
    });
    if(path==='ADMIN') assert.equal((await create(db,{valorCentavos:10000})).erro,'MERCADO_PAGO_RECUSOU');
    else {
      const r=await app.checkout.onRequestPost({env:env(db),request:new Request('https://local.test/api/checkout',{
        // operationKey: contrato A1, obrigatório no endpoint. Asserções inalteradas.
        method:'POST',body:JSON.stringify({items:[{id:1,quantity:2}],cliente:{nome:'Teste',whatsapp:'000'},operationKey:`b4-checkout-${status}`}),
      })});
      assert.equal(r.status,502);
    }
    const after=await state(db);
    assert.deepEqual(after.pagamentos,confirmed.pagamentos);
    assert.deepEqual(after.produtos,confirmed.produtos);
    assert.deepEqual(after.itens,confirmed.itens);
    assert.equal(after.pagamentos[0].status,{approved:'PAGO',cancelled:'CANCELADO',expired:'EXPIRADO'}[status]);
  });
}

for(const reserve of ['ATIVA','LIBERADA']) test(`ADMIN refusal compensates only an acquired reserve: initial ${reserve}`,async t=>{
  const db=await fixture(t,{reserve,ledger:false}); t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',async ()=>new Response('rejected',{status:400}));
  assert.equal((await create(db)).erro,'MERCADO_PAGO_RECUSOU');
  const s=await state(db); assert.equal(s.pagamentos[0].status,'FALHOU');
  if(reserve==='ATIVA') reserved(s); else released(s);
});

for(const bothFail of [false,true]) test(`failing reserve owner retains concurrent Pix; all-FALHOU debt=${bothFail}`,async t=>{
  const db=await fixture(t,{reserve:'LIBERADA',ledger:false}); t.mock.method(console,'error',()=>{});
  const enteredA=deferred(), enteredB=deferred(), responseA=deferred(), responseB=deferred(); let calls=0;
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    assert.equal(options.method,'POST');
    if(++calls===1) {enteredA.resolve();return responseA.promise;}
    enteredB.resolve(); return responseB.promise;
  });
  const a=create(db); await enteredA.promise;
  const b=create(db); await enteredB.promise;
  responseA.resolve(new Response('rejected',{status:400}));
  assert.equal((await a).erro,'MERCADO_PAGO_RECUSOU'); reserved(await state(db));
  responseB.resolve(bothFail?new Response('rejected',{status:400}):Response.json({id:202,status:'pending',date_of_expiration:'2099-01-01'}));
  assert.equal((await b).ok,!bothFail); reserved(await state(db));
  assert.deepEqual((await state(db)).pagamentos.map(p=>p.status),['FALHOU',bothFail?'FALHOU':'PENDENTE']);
  if(bothFail) {
    await app.reconcile.reconcilePedidosDivergentes(db);
    await app.sync.reconcilePendingPixPayments(env(db));
    await app.sync.liberarReservasVencidasLocalmente(env(db)); reserved(await state(db));
  }
});

for(const replacement of [false,true]) test(`creation CAS keeps ${replacement?'one successor':'monetary capacity'} under forced concurrency`,async t=>{
  const db=await fixture(t,{ledger:false,reserve:'LIBERADA'}); const mp=remote(t);
  const original=replacement?await create(db):null;
  const beforeCalls=mp.mock.callCount(); const gate=barrier(2);
  db.hook=async (s,op)=>{if(op==='batch' && isCreation(s)) await gate();};
  const extra=replacement?{substituiId:original.pagamentoId}:{valorCentavos:7000};
  const results=await Promise.allSettled([create(db,extra),create(db,extra)]);
  assert.equal(results.filter(r=>r.status==='fulfilled' && r.value.ok).length,1);
  assert.equal(mp.mock.callCount()-beforeCalls,1); reserved(await state(db));
  assert.equal((await state(db)).pagamentos.length,replacement?2:1);
});

test('signed webhook reports release failure and its retry recovers CANCELADO',async t=>{
  const db=await fixture(t); remote(t,{101:'cancelled'});
  const logs=t.mock.method(console,'error',()=>{});
  const secret='b4-local-only';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('id:101;request-id:b4;ts:1;'))).toString('hex');
  const webhook=()=>app.webhook.onRequestPost({env:{...env(db),MP_WEBHOOK_SECRET:secret},request:new Request('https://local.test/api/webhooks/mercadopago?data.id=101&type=payment',{
    method:'POST',headers:{'x-signature':`ts=1,v1=${sig}`,'x-request-id':'b4'},body:JSON.stringify({data:{id:101}}),
  })});
  db.hook=(s,op)=>{if(op==='batch' && isRelease(s)){db.hook=null;throw new Error('injected release failure');}};
  assert.equal((await webhook()).status,502); reserved(await state(db));
  assert.equal((await state(db)).pagamentos[0].status,'CANCELADO');
  assert.ok(logs.mock.calls.some(c=>c.arguments[0]==='Falha ao liberar reserva de estoque'));
  assert.equal((await webhook()).status,200); released(await state(db));
});

test('multiple products and repeated product items release atomically, including rollback',async t=>{
  const db=await fixture(t); t.mock.method(console,'error',()=>{});
  await db.batch([
    db.prepare("INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(2,'Doce','BOLO',100,5,1)"),
    db.prepare("INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos) VALUES(2,1,2,'Doce',1,100,100)"),
    db.prepare("INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos) VALUES(3,1,1,'Bolo',1,100,100)"),
    db.prepare('UPDATE produtos SET estoque_reservado=3 WHERE id=1'),
  ]);
  const before=await state(db);
  db.hook=(s,op)=>{
    if(op==='batch' && isRelease(s)) {
      db.hook=null;
      return [...s.slice(0,2),{sql:'SELECT * FROM missing_b4_table',args:[]},...s.slice(2)];
    }
  };
  await assert.rejects(app.sync.expireLocalPayment(db,1),/ERRO_TRANSACIONAL_LIBERACAO/);
  assert.deepEqual((await state(db)).produtos,before.produtos);
  assert.equal((await state(db)).pedido.reserva_status,'ATIVA');
  await app.sync.expireLocalPayment(db,1); await app.sync.expireLocalPayment(db,1);
  const after=await state(db);
  assert.deepEqual(after.produtos.map(p=>[p.estoque,p.estoque_reservado]),[[10,0],[5,0]]);
  assert.equal(after.pedido.reserva_status,'LIBERADA');
});

for(const mark of ['order','item']) test(`inconsistent ATIVA with physical ${mark} mark never releases`,async t=>{
  const db=await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=1").run();
  await db.prepare(`UPDATE ${mark==='order'?'pedidos':'pedido_itens'} SET estoque_baixado_em='2026-01-01' WHERE id=1`).run();
  assert.equal((await release(db)).liberado,false);
  assert.equal((await state(db)).produtos[0].estoque_reservado,2);
  assert.equal((await state(db)).pedido.reserva_status,'ATIVA');
});
