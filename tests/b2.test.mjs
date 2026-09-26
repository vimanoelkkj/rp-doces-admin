import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, barrier} from './helpers/b3.mjs';

const env = db => ({DB:db,MP_ACCESS_TOKEN:'fake',MP_WEBHOOK_SECRET:'b2-local-only'});
const expired = db => db.prepare("UPDATE pedidos SET pix_expira_em='2000-01-01',reserva_expira_em='2000-01-02' WHERE id=1").run();
const recover = db => app.reconcile.reconcilePedidoAfterFinancialChange(db,1);
// M7: os GETs públicos são somente leitura; a recuperação (MP, expiração,
// reconciliação) é o POST /api/pedido-status. Estes testes cobrem a lógica de
// recuperação, então abrem explicitamente a janela do throttle de 15s antes
// de cada chamada; o throttle em si é coberto em
// public-pedido-reconcile.test.mjs. 'detail' = POST de recuperação seguido da
// leitura pura de GET /api/pedido.
const abrirJanelaMp = db => db.prepare(`UPDATE pedido_pagamentos SET atualizado_em=datetime('now','-1 minute')
  WHERE metodo='PIX_MP' AND status IN ('PENDENTE','EXPIRADO')`).run();
const consultar = async (db, handler='polling', token='token') => {
  await abrirJanelaMp(db);
  const reconciliado=await app.polling.onRequestPost({env:env(db),request:new Request(`https://local.test/api/pedido-status?token=${token}`,
    {method:'POST',headers:{Origin:'https://local.test'}})});
  const response=handler==='polling' ? reconciliado
    : await app.detail.onRequestGet({request:new Request(`https://local.test/api/pedido?token=${token}`),env:env(db)});
  return {response,body:await response.json()};
};
function mp(t,status,extra={}) {
  return t.mock.method(globalThis,'fetch',async (url,options)=> {
    assert.match(String(url), /^https:\/\/api\.mercadopago\.com\/v1\/payments\/\d+$/);
    assert.equal(options.headers.Authorization,'Bearer fake');
    return Response.json({id:Number(String(url).split('/').at(-1)),status,...extra});
  });
}
async function hook(db, id=101, payloadStatus='approved', signatureValid=true) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('b2-local-only'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`id:${id};request-id:b2;ts:1;`))).toString('hex');
  return app.webhook.onRequestPost({request:new Request(`https://local.test/api/webhooks/mercadopago?data.id=${id}&type=payment`,{
    method:'POST',headers:{'x-signature':`ts=1,v1=${signatureValid?sig:'bad'}`,'x-request-id':'b2'},
    body:JSON.stringify({data:{id},status:payloadStatus}),
  }),env:env(db)});
}
// A manutenção global do admin (sweep Pix, reconciliação, reservas vencidas)
// é o POST explícito /api/admin/pedidos/reconciliar — sessão + mesma origem.
// GET /api/admin/pedidos é somente leitura.
async function reconciliarAdmin(db) {
  const session=await app.auth.createSession(db,1);
  const response=await app.adminReconciliar.onRequestPost({request:new Request('https://local.test/api/admin/pedidos/reconciliar',{
    method:'POST',headers:{Cookie:session.cookie.split(';')[0],Origin:'https://local.test'},
  }),env:env(db)});
  assert.equal(response.status,200);
  return response;
}
async function listarAdmin(db) {
  const session=await app.auth.createSession(db,1);
  const response=await app.admin.onRequestGet({request:new Request('https://local.test/api/admin/pedidos',{
    headers:{Cookie:session.cookie.split(';')[0]},
  }),env:env(db)});
  assert.equal(response.status,200);
  return response;
}
function paid(s) {
  assert.equal(s.pagamentos[0].status,'PAGO');
  assert.equal(s.pedido.status_pagamento,'PAGO');
  assert.equal(s.produtos[0].estoque,8);
  assert.equal(s.produtos[0].estoque_reservado,0);
  assert.ok(s.pedido.estoque_baixado_em);
}

test('A: real checkout creation then authoritative GET approval preserves normal flow', async t=>{
  const db=await fixture(t,{ledger:false});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque_reservado=0 WHERE id=1').run();
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,'https://api.mercadopago.com/v1/payments');
    assert.equal(options.method,'POST');
    return Response.json({id:101,status:'pending',date_of_expiration:'2099-01-01',point_of_interaction:{transaction_data:{qr_code:'fake'}}});
  });
  const response=await app.checkout.onRequestPost({env:env(db),request:new Request('https://local.test/api/checkout',{
    // operationKey: contrato A1, obrigatório no endpoint. Asserções inalteradas.
    method:'POST',body:JSON.stringify({items:[{id:1,quantity:2}],cliente:{nome:'Teste',whatsapp:'11999999999'},operationKey:'b2-checkout-a'}),
  })});
  assert.equal(response.status,200);
  const checkout=await response.json();
  mp(t,'approved');
  assert.equal((await consultar(db,'polling',checkout.tokenPublico)).body.statusPagamento,'PAGO');
  assert.equal((await db.prepare('SELECT status FROM pedido_pagamentos').first()).status,'PAGO');
  assert.equal((await db.prepare('SELECT estoque FROM produtos WHERE id=1').first()).estoque,8);
});

for(const handler of ['polling','detail']) test(`B: ${handler} queries approved before expiration`,async t=>{
  const db=await fixture(t);
  await expired(db);
  const fetch=mp(t,'approved',{date_approved:'2026-09-01T12:00:00Z'});
  const r=await consultar(db,handler);
  assert.equal(r.response.status,200);
  assert.equal(r.body.statusPagamento,'PAGO');
  assert.equal(fetch.mock.callCount(),1);
  const s=await state(db); paid(s);
  assert.equal(s.pagamentos[0].cancelado_em,null);
  assert.equal(s.pedido.reserva_liberada_em,null);
});

test('C: public detail recovers already expired ledger and released reserve',async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  assert.equal((await consultar(db,'detail')).body.statusPagamento,'PAGO');
  paid(await state(db));
});

test('C/G/K: local sweep releases reserve; repeated signed webhook recovers once and preserves historical marks',async t=>{
  const db=await fixture(t);
  await expired(db);
  await app.sync.liberarReservasVencidasLocalmente({DB:db});
  const before=await state(db);
  assert.equal(before.pagamentos[0].status,'EXPIRADO');
  assert.equal(before.pedido.reserva_status,'LIBERADA');
  mp(t,'approved',{date_approved:'2026-09-01T12:00:00Z'});
  for(let i=0;i<5;i++) assert.equal((await hook(db)).status,200);
  const after=await state(db); paid(after);
  assert.equal(after.pagamentos.length,1);
  assert.deepEqual(after.alocacoes,before.alocacoes);
  assert.equal(after.pagamentos[0].cancelado_em,before.pagamentos[0].cancelado_em);
  assert.equal(after.pedido.reserva_liberada_em,before.pedido.reserva_liberada_em);
  assert.equal(after.pagamentos[0].pago_em,'2026-09-01T12:00:00Z');
  await hook(db);
  const retry=await state(db);
  assert.equal(retry.pagamentos[0].pago_em,after.pagamentos[0].pago_em);
  assert.deepEqual(retry.produtos,after.produtos);
  assert.deepEqual(retry.itens,after.itens);
  assert.equal(retry.pedido.estoque_baixado_em,after.pedido.estoque_baixado_em);
});

for(const status of ['expired','cancelled','rejected','refunded','charged_back']) test(`D: EXPIRADO + MP ${status} never invents PAGO/refund`,async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  mp(t,status);
  assert.equal((await hook(db)).status,200);
  const s=await state(db);
  const expectedStatus = ['cancelled', 'rejected'].includes(status) ? 'CANCELADO' : 'EXPIRADO';
  assert.equal(s.pagamentos[0].status, expectedStatus);
  assert.equal(s.pagamentos[0].mp_status,status);
  assert.equal(s.produtos[0].estoque,10);
  assert.equal(s.refunds.length,0);
});

test('E: expired deadline + pending GET expires operationally; next polling approved recovers',async t=>{
  const db=await fixture(t);
  await expired(db);
  mp(t,'pending');
  assert.equal((await consultar(db)).body.statusPagamento,'EXPIRADO');
  assert.equal((await state(db)).pedido.reserva_status,'LIBERADA');
  mp(t,'approved');
  assert.equal((await consultar(db)).body.statusPagamento,'PAGO');
  paid(await state(db));
});

for(const failure of ['500','timeout']) test(`F: ${failure} after deadline does not invent remote rejection; retry recovers`,async t=>{
  const db=await fixture(t);
  await expired(db);
  t.mock.method(globalThis,'fetch',async ()=> {
    if(failure==='timeout') throw new DOMException('timeout','TimeoutError');
    return new Response('unavailable',{status:500});
  });
  assert.equal((await consultar(db)).body.statusPagamento,'EXPIRADO');
  const s=await state(db);
  assert.equal(s.pagamentos[0].mp_status,null);
  assert.equal(s.pedido.status_pagamento,'PENDENTE');
  assert.equal(s.produtos[0].estoque,10);
  mp(t,'approved');
  assert.equal((await consultar(db)).body.statusPagamento,'PAGO');
  paid(await state(db));
});

test('F: GET timeout actually aborts a hanging request using the central deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',async (_url,{signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  const rejection=assert.rejects(app.sync.fetchMpPayment('fake','101'),/abort/i);
  t.mock.timers.tick(app.sync.MP_PAYMENT_GET_TIMEOUT_MS);
  await rejection;
});

test('H: late approval cannot consume other reservations; B3 retries after replenishment',async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  await db.prepare('UPDATE produtos SET estoque=3,estoque_reservado=2 WHERE id=1').run();
  assert.equal((await hook(db)).status,200);
  const s=await state(db);
  assert.equal(s.pagamentos[0].status,'PAGO');
  assert.equal(s.pedido.status_pagamento,'PAGO');
  assert.equal(s.pedido.estoque_baixado_em,null);
  assert.equal(s.produtos[0].estoque,3);
  assert.equal(s.produtos[0].estoque_reservado,2);
  await db.prepare('UPDATE produtos SET estoque=5 WHERE id=1').run();
  await app.reconcile.reconcilePedidosDivergentes(db);
  const recovered=await state(db);
  assert.equal(recovered.produtos[0].estoque,3);
  assert.equal(recovered.produtos[0].estoque_reservado,2);
  assert.ok(recovered.pedido.estoque_baixado_em);
  assert.deepEqual(recovered.pagamentos,s.pagamentos);
});

for(const both of [false,true]) test(`I/J: real admin regeneration keeps A reconcilable; both approved=${both}`,async t=>{
  const db=await fixture(t,{ledger:false});
  const session=await app.auth.createSession(db,1);
  let remoteId=200;
  t.mock.method(globalThis,'fetch',async (url, options)=>{
    if (options?.method === 'PUT') {
      const paymentId = Number(String(url).split('/').at(-1)) || 201;
      return Response.json({id: paymentId, status: 'cancelled'});
    }
    if (options?.method !== 'POST') {
      const paymentId = Number(String(url).split('/').at(-1)) || 201;
      return Response.json({id: paymentId, status: 'pending', date_of_expiration: '2099-01-01'});
    }
    return Response.json({id:++remoteId,status:'pending',date_of_expiration:'2099-01-01'});
  });
  // operationKey: contrato A1, obrigatório no endpoint. Uma key por chamada,
  // porque cada chamada aqui é uma intenção distinta (gerar, depois regenerar).
  let opSeq=0;
  const create=async substituiId=>{
    const operationKey=`b2-pix-${++opSeq}`;
    const r=await app.adminPix.onRequestPost({env:env(db),params:{id:'1'},request:new Request('https://local.test/api/admin/pedidos/1/pix',{
      method:'POST',headers:{Cookie:session.cookie.split(';')[0],Origin:'https://local.test'},
      body:JSON.stringify(substituiId?{substituiId,operationKey}:{operationKey}),
    })});
    assert.equal(r.status,201); return r.json();
  };
  const a=await create(); const b=await create(a.pagamentoId);
  const before=await state(db);
  assert.equal(before.pagamentos[0].status,'CANCELADO');
  assert.equal(before.pagamentos[1].substitui_pagamento_id,a.pagamentoId);
  // Cobre também um A histórico terminalizado operacionalmente: ter B não
  // bloqueia a autoridade do MP, nem altera a política de liberação B4.
  await db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=?").bind(a.pagamentoId).run();
  mp(t,'approved');
  if(both) assert.equal((await hook(db,b.mpPaymentId)).status,200);
  assert.equal((await hook(db,a.mpPaymentId)).status,200);
  const s=await state(db);
  assert.equal(s.pagamentos[0].status,'PAGO');
  assert.equal(s.pagamentos[1].status,both?'PAGO':'PENDENTE');
  assert.equal(await app.ledger.getPaidCentavos(db,1),both?20000:10000);
  assert.equal(s.produtos[0].estoque,8);
  assert.deepEqual(s.alocacoes,before.alocacoes);
  assert.equal(s.refunds.length,0);
});

for(const order of ['expire-between-read-and-write','approval-before-expire-write','parallel-handlers']) test(`L: ${order} converges without a third event`,async t=>{
  const db=await fixture(t);
  await expired(db);
  if(order==='parallel-handlers') {
    const gate=barrier(2);
    t.mock.method(globalThis,'fetch',async ()=>{await gate();return Response.json({id:101,status:'approved'});});
    await Promise.all([consultar(db),hook(db)]);
  } else {
    db.hook=async (s,op)=>{
      if(op==='run' && s[0].sql.includes('SET status = ?') &&
         s[0].args[0]===(order==='expire-between-read-and-write'?'PAGO':'EXPIRADO')) {
        db.hook=null;
        if(order==='expire-between-read-and-write') await app.sync.expireLocalPayment(db,1);
        else assert.equal((await hook(db)).status,200);
      }
    };
    if(order==='expire-between-read-and-write') assert.equal((await hook(db)).status,200);
    else await app.sync.expireLocalPayment(db,1);
  }
  const s=await state(db); paid(s);
  assert.equal(s.pagamentos.length,1);
});

test('authority: webhook payload approved, GET pending and old mp_status never promote expiration',async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  await db.prepare("UPDATE pedido_pagamentos SET mp_status='approved' WHERE id=1").run();
  await recover(db);
  assert.equal((await state(db)).pagamentos[0].status,'EXPIRADO');
  mp(t,'pending');
  assert.equal((await hook(db,101,'approved')).status,200);
  assert.equal((await state(db)).pagamentos[0].status,'EXPIRADO');
  await assert.rejects(app.sync.syncPaymentFromMp(db,1,{id:101,status:'approved'}),/NAO_VERIFICADA/);
  const verifiedPending=await app.sync.fetchMpPayment('fake','101');
  assert.equal(Object.isFrozen(verifiedPending),true);
  await assert.rejects(app.sync.syncPaymentFromMp(db,1,{...verifiedPending,status:'approved'}),/NAO_VERIFICADA/);
  await assert.rejects(app.sync.resolveWebhookPayment(db,{id:101,status:'approved'}),/NAO_VERIFICADA/);
  assert.equal((await hook(db,101,'approved',false)).status,401);
});

for(const status of ['CANCELADO','FALHOU','REEMBOLSADO']) test(`matrix: authoritative approval cannot rewrite ${status}`,async t=>{
  const db=await fixture(t);
  await db.prepare('UPDATE pedido_pagamentos SET status=? WHERE id=1').bind(status).run();
  assert.equal((await hook(db)).status,200);
  assert.equal((await state(db)).pagamentos[0].status,status);
});

for(const origin of ['SITE','ADMIN']) test(`identity: expired ${origin} without mp id is recovered via verified external reference`,async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL,origem=? WHERE id=1').bind(origin).run();
  mp(t,'approved',{external_reference:origin==='SITE'?'token':'pagamento-1'});
  assert.equal((await hook(db)).status,200);
  paid(await state(db));
});

for(const mode of ['duplicate-id','ambiguous-site','association-race','new-candidate-race','mismatched-response']) test(`identity: ${mode} cannot synchronize the wrong attempt`,async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  if(mode==='duplicate-id'||mode==='ambiguous-site') {
    if(mode==='ambiguous-site') await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
    await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key) VALUES(1,'PIX_MP','SITE',10000,'EXPIRADO',?,'second')")
      .bind(mode==='duplicate-id'?'101':null).run();
  }
  if(mode==='association-race'||mode==='new-candidate-race') {
    await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
    db.hook=async(s,op)=>{
      if(op==='run'&&s[0].sql.includes('SET mp_payment_id = ?')) {
        db.hook=null;
        if(mode==='association-race') await db.prepare("UPDATE pedido_pagamentos SET mp_payment_id='999' WHERE id=1").run();
        else await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'PIX_MP','SITE',10000,'PENDENTE','new-site')").run();
      }
    };
  }
  mp(t,'approved',{external_reference:'token',...(mode==='mismatched-response'?{id:999}:{})});
  const response=await hook(db);
  assert.equal(response.status,mode==='mismatched-response'?502:200);
  const s=await state(db);
  assert.equal(s.pagamentos.some(p=>p.status==='PAGO'),false);
  assert.equal(s.produtos[0].estoque,10);
});

for(const amount of [4000,10000]) test(`polling: aggregate ${amount===4000?'PARCIAL':'PAGO'} does not hide the SITE attempt`,async t=>{
  const db=await fixture(t);
  await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'DINHEIRO','ADMIN',?,'PAGO','manual')").bind(amount).run();
  await recover(db);
  await expired(db);
  assert.equal((await consultar(db)).body.statusPagamento,'PAGO');
  const s=await state(db); paid(s);
  assert.equal(s.pagamentos.length,2);
  assert.equal(await app.ledger.getPaidCentavos(db,1),10000+amount);
});

test('sweep: bounded, throttled, concurrent-safe and failing old expired candidates do not block later ones',async t=>{
  const db=await fixture(t);
  await app.sync.expireLocalPayment(db,1);
  await db.prepare("UPDATE pedido_pagamentos SET atualizado_em='2000-01-01' WHERE id=1").run();
  for(let i=2;i<=7;i++) await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key,atualizado_em) VALUES(1,'PIX_MP','ADMIN',10000,'EXPIRADO',?,?,'2000-01-01')").bind(String(100+i),`expired-${i}`).run();
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const id=Number(String(url).split('/').at(-1)); calls.push(id);
    if(id===101) return new Response('offline',{status:500});
    return Response.json({id,status:'approved'});
  });
  // GET da listagem nunca consulta o MP, mesmo com candidatos elegíveis.
  const antesDoGet=await state(db);
  await listarAdmin(db);
  assert.equal(calls.length,0,'GET /api/admin/pedidos é somente leitura');
  assert.deepEqual(await state(db),antesDoGet);

  await reconciliarAdmin(db);
  assert.equal(calls.length,4,'one admin reconciliation run is bounded to four MP calls');
  await Promise.all([reconciliarAdmin(db),reconciliarAdmin(db)]);
  assert.equal(new Set(calls).size,calls.length,'concurrent runs never query the same payment twice');
  await reconciliarAdmin(db);
  assert.equal(calls.length,7);
  await reconciliarAdmin(db);
  assert.equal(calls.length,7,'throttle: nothing left to query within the window');
  const s=await state(db);
  assert.equal(s.pagamentos[0].status,'EXPIRADO');
  assert.equal(s.pagamentos.filter(p=>p.status==='PAGO').length,6);
  assert.equal(s.produtos[0].estoque,8);
  await db.prepare("UPDATE pedido_pagamentos SET atualizado_em='1990-01-01' WHERE id=1").run();
  mp(t,'approved');
  await reconciliarAdmin(db);
  assert.equal((await state(db)).pagamentos[0].status,'PAGO','no age cutoff makes the old failed candidate irrecoverable');
});

test('polling: an ADMIN attempt inserted first cannot receive the SITE approval',async t=>{
  const db=await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN',mp_payment_id='202' WHERE id=1").run();
  await db.prepare("INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key) VALUES(1,'PIX_MP','SITE',10000,'PENDENTE','101','site-second')").run();
  const fetch=mp(t,'approved');
  assert.equal((await consultar(db)).body.statusPagamento,'PAGO');
  assert.equal(fetch.mock.calls[0].arguments[0],'https://api.mercadopago.com/v1/payments/101');
  const s=await state(db);
  assert.equal(s.pagamentos[0].status,'PENDENTE');
  assert.equal(s.pagamentos[1].status,'PAGO');
});

test('polling: pending MP snapshot cannot return EXPIRADO when concurrent webhook approved before local expiry',async t=>{
  const db=await fixture(t);
  await expired(db);
  mp(t,'pending');
  db.hook=async(s,op)=>{
    if(op==='run'&&s[0].sql.includes('SET status = ?')&&s[0].args[0]==='EXPIRADO') {
      db.hook=null;
      mp(t,'approved');
      assert.equal((await hook(db)).status,200);
    }
  };
  assert.equal((await consultar(db)).body.statusPagamento,'PAGO');
  paid(await state(db));
});

test('polling: GET failure before deadline keeps PENDENTE and active reservation',async t=>{
  const db=await fixture(t);
  t.mock.method(globalThis,'fetch',async()=>new Response('offline',{status:500}));
  assert.equal((await consultar(db)).body.statusPagamento,'PENDENTE');
  const s=await state(db);
  assert.equal(s.pedido.reserva_status,'ATIVA');
  assert.equal(s.pagamentos[0].cancelado_em,null);
});
