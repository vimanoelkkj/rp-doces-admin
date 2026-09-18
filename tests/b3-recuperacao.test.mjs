import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// B-3 — recuperação de operações cujo envio ao Mercado Pago ficou
// INCONCLUSIVO, por observação READ-ONLY da identidade já persistida pelo A1.
//
// Provedor simulado determinístico. O contrato da busca foi confirmado na
// documentação oficial antes da implementação:
//   GET /v1/payments/search?sort=&criteria=&external_reference=
//   -> { paging: {...}, results: [...] }, 200 com results vazio quando não há.
//
// INVARIANTE: a busca só PROPÕE um id. A autoridade financeira continua
// nascendo exclusivamente no GET verificado do B2.

const cookieDe = session => session.cookie.split(';')[0];
const uuid = n => `b3rec-${n}-4000-8000-000000000000`;
const silenciar = t => t.mock.method(console, 'error', () => {});

// Torna as operações elegíveis: o corte é de 60s desde `atualizado_em`.
const envelhecer = db =>
  db.prepare("UPDATE pedido_operacoes SET atualizado_em = datetime('now','-10 minutes')").run();

/**
 * Provedor simulado. `postar` decide o resultado do POST de criação;
 * `remoto` é o "banco" do Mercado Pago (external_reference -> [pagamentos]).
 * Registra todas as chamadas por tipo para provar ausência de segundo POST.
 */
function provedor(t, {postar, remoto = new Map()} = {}) {
  const chamadas = {post: 0, search: 0, get: 0};
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const alvo = String(url);
    if (options?.method === 'POST') {
      assert.equal(alvo, 'https://api.mercadopago.com/v1/payments');
      chamadas.post++;
      return postar(chamadas.post, options);
    }
    if (alvo.startsWith('https://api.mercadopago.com/v1/payments/search')) {
      chamadas.search++;
      const parsed = new URL(alvo);
      assert.equal(parsed.searchParams.get('sort'), 'date_created', 'sort é obrigatório');
      assert.equal(parsed.searchParams.get('criteria'), 'desc', 'criteria é obrigatório');
      const referencia = parsed.searchParams.get('external_reference');
      const encontrados = remoto.get(referencia) ?? [];
      return Response.json({
        paging: {total: encontrados.length, limit: 30, offset: 0},
        results: encontrados,
      });
    }
    // GET autoritativo /v1/payments/:id
    chamadas.get++;
    const id = alvo.split('/').at(-1);
    for (const lista of remoto.values()) {
      const achado = lista.find(p => String(p.id) === id);
      if (achado) return Response.json(achado);
    }
    return new Response('not found', {status: 404});
  });
  return {chamadas, mock, remoto};
}

const recuperar = db => app.sync.recuperarOperacoesInconclusivas({DB: db, MP_ACCESS_TOKEN: 'fake'});

/* ───────────────────────── bancadas SITE e ADMIN ───────────────────────── */

async function siteInconclusivo(t, {postar, remoto} = {}) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  // Reseta o AUTOINCREMENT para que o pedido criado pelo checkout volte a ser
  // o id 1 e o snapshot compartilhado `state(db)` continue válido.
  await db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_itens','pedido_pagamentos')").run();
  await db.prepare('UPDATE produtos SET estoque=10, estoque_reservado=0 WHERE id=1').run();
  const p = provedor(t, {postar: postar ?? (() => new Response('offline', {status: 500})), remoto});

  const resposta = await app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 2}],
        cliente: {nome: 'Teste', whatsapp: '11999999999'},
        operationKey: uuid('site'),
      }),
    }),
  });
  assert.equal(resposta.status, 502);
  assert.equal((await resposta.json()).code, 'MERCADO_PAGO_INDISPONIVEL');

  const operacao = (await db.prepare('SELECT * FROM pedido_operacoes').all()).results[0];
  assert.equal(operacao.fase, 'ENVIO_INCONCLUSIVO');
  const pedido = (await db.prepare('SELECT * FROM pedidos').all()).results[0];
  return {db, provedor: p, operacao, pedido, session: await app.auth.createSession(db, 1)};
}

async function adminInconclusivo(t, {postar, remoto} = {}) {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  const p = provedor(t, {postar: postar ?? (() => new Response('offline', {status: 503})), remoto});

  const resposta = await app.adminPix.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/pix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({valorCentavos: 10000, operationKey: uuid('admin')}),
    }),
  });
  assert.equal(resposta.status, 502);
  const operacao = (await db.prepare('SELECT * FROM pedido_operacoes').all()).results[0];
  assert.equal(operacao.fase, 'ENVIO_INCONCLUSIVO');
  return {db, provedor: p, operacao, session};
}

/** external_reference que o A1 persistiu no snapshot do POST. */
function referenciaPersistida(operacao) {
  const referencia = JSON.parse(operacao.mp_request).external_reference;
  assert.ok(referencia, 'A1 persiste external_reference antes do envio');
  return referencia;
}

/* ─────────────────────────────── cenários ─────────────────────────────── */

test('1. POST timeout, MP criou e aprovou: busca encontra, GET verifica, sistema converge', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {
    postar: () => { throw new Error('transport timeout'); },
    remoto,
  });
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [{id: 9001, status: 'approved', external_reference: referencia}]);

  const postsAntes = p.chamadas.post;
  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, 'nenhuma tentativa nova');
  assert.equal(s.pagamentos[0].mp_payment_id, '9001', 'identidade remota associada');
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.ok(s.itens[0].estoque_baixado_em, 'baixa física uma única vez');
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.operacoes.length, 1, 'nenhuma operação nova');
  assert.equal(s.operacoes[0].mp_payment_id, '9001');
  assert.equal(p.chamadas.post, postsAntes, 'nenhum segundo POST lógico');
  assert.equal(p.chamadas.search, 1);
  assert.equal(p.chamadas.get, 1, 'autoridade vem do GET verificado');
});

test('2. POST 5xx, recurso remoto PENDENTE: associa o ID sem inventar PAGO', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [{id: 9002, status: 'pending', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos[0].mp_payment_id, '9002');
  assert.equal(s.pagamentos[0].status, 'PENDENTE', 'pending não inventa aprovação');
  assert.equal(s.pedido.status_pagamento, 'PENDENTE');
  assert.equal(s.pedido.reserva_status, 'ATIVA', 'reserva intacta');
  assert.equal(s.produtos[0].estoque_reservado, 2);
  assert.equal(s.operacoes[0].fase, 'REMOTO_CONHECIDO');
  assert.equal(p.chamadas.post, 1);
});

test('3. busca com zero resultados: permanece inconclusivo, sem POST, key e reserva intactas', async t => {
  silenciar(t);
  const {db, provedor: p, operacao} = await siteInconclusivo(t);
  const antes = await state(db);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos[0].status, 'PENDENTE', 'zero resultados não prova rejeição');
  assert.equal(s.pagamentos[0].mp_payment_id, null);
  assert.equal(s.pedido.reserva_status, 'ATIVA', 'reserva NÃO é liberada por não encontrar');
  assert.equal(s.produtos[0].estoque_reservado, antes.produtos[0].estoque_reservado);
  assert.equal(s.operacoes.length, 1, 'nenhuma nova operação/key');
  assert.equal(s.operacoes[0].operation_key, operacao.operation_key, 'mesma identidade A1');
  assert.equal(s.operacoes[0].fase, 'ENVIO_INCONCLUSIVO', 'continua inconclusiva');
  assert.equal(s.operacoes[0].erro, 'BUSCA:NENHUM', 'diagnóstico visível');
  assert.equal(p.chamadas.post, 1, 'nenhum reenvio');
  assert.equal(p.chamadas.get, 0, 'sem candidato, sem GET');
});

test('4. busca com múltiplos candidatos: nenhuma escolha arbitrária, caso fica visível', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao, session} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [
    {id: 9101, status: 'approved', external_reference: referencia},
    {id: 9102, status: 'pending', external_reference: referencia},
  ]);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos[0].mp_payment_id, null, 'nenhum id escolhido arbitrariamente');
  assert.equal(s.pagamentos[0].status, 'PENDENTE', 'nenhum fato financeiro inventado');
  assert.equal(s.pedido.status_pagamento, 'PENDENTE');
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.operacoes[0].fase, 'ENVIO_INCONCLUSIVO');
  assert.equal(s.operacoes[0].erro, 'BUSCA:AMBIGUO:2');
  assert.equal(p.chamadas.get, 0, 'nem GET é feito sem candidato único');

  // Visível operacionalmente no detalhe administrativo.
  const detalhe = await app.adminOrder.onRequestGet({
    env: {DB: db}, params: {id: String(s.pedido.id)},
    request: new Request('https://local.test/api/admin/pedidos/1', {headers: {Cookie: cookieDe(session)}}),
  });
  const corpo = await detalhe.json();
  assert.equal(corpo.operacoesInconclusivas.length, 1);
  assert.equal(corpo.operacoesInconclusivas[0].diagnostico, 'BUSCA:AMBIGUO:2');
});

test('5. webhook chega antes da recuperação: associação única e recuperação posterior converge', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao, pedido} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [{id: 9200, status: 'approved', external_reference: referencia}]);
  assert.equal(referencia, pedido.token_publico, 'SITE usa token_publico');

  // Webhook assinado resolve pelo fallback de external_reference.
  const secret = 'b3-local-only';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const assinatura = Buffer.from(await crypto.subtle.sign('HMAC', chave,
    new TextEncoder().encode('id:9200;request-id:b3r;ts:1;'))).toString('hex');
  const webhook = await app.webhook.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake', MP_WEBHOOK_SECRET: secret},
    request: new Request('https://local.test/api/webhooks/mercadopago?data.id=9200&type=payment', {
      method: 'POST',
      headers: {'x-signature': `ts=1,v1=${assinatura}`, 'x-request-id': 'b3r'},
      body: JSON.stringify({data: {id: 9200}}),
    }),
  });
  assert.equal(webhook.status, 200);
  const aposWebhook = await state(db);
  assert.equal(aposWebhook.pagamentos[0].mp_payment_id, '9200');
  assert.equal(aposWebhook.pagamentos[0].status, 'PAGO');

  // A recuperação nem seleciona mais o caso (já tem ID) e nada duplica.
  const buscasAntes = p.chamadas.search;
  await envelhecer(db);
  await recuperar(db);
  const s = await state(db);
  assert.equal(p.chamadas.search, buscasAntes, 'operação já associada sai da fila');
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.produtos[0].estoque, 8, 'baixa física única');
  assert.equal(p.chamadas.post, 1);
});

test('6. recuperação vence antes do webhook: webhook posterior converge sem duplicar', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [{id: 9300, status: 'approved', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);
  const aposRecuperacao = await state(db);
  assert.equal(aposRecuperacao.pagamentos[0].mp_payment_id, '9300');
  assert.equal(aposRecuperacao.pagamentos[0].status, 'PAGO');

  const secret = 'b3-local-only';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const assinatura = Buffer.from(await crypto.subtle.sign('HMAC', chave,
    new TextEncoder().encode('id:9300;request-id:b3w;ts:1;'))).toString('hex');
  const webhook = await app.webhook.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake', MP_WEBHOOK_SECRET: secret},
    request: new Request('https://local.test/api/webhooks/mercadopago?data.id=9300&type=payment', {
      method: 'POST',
      headers: {'x-signature': `ts=1,v1=${assinatura}`, 'x-request-id': 'b3w'},
      body: JSON.stringify({data: {id: 9300}}),
    }),
  });
  assert.equal(webhook.status, 200);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos.filter(x => x.status === 'PAGO').length, 1, 'um único fato confirmado');
  assert.equal(s.produtos[0].estoque, 8, 'nenhuma segunda baixa');
  assert.equal(p.chamadas.post, 1);
});

test('8. ADMIN: recuperação usa a idempotency_key da tentativa como referência', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await adminInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  const tentativa = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results[0];
  assert.equal(referencia, tentativa.idempotency_key, 'ADMIN usa a key da tentativa');
  remoto.set(referencia, [{id: 9400, status: 'approved', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, 'nenhuma segunda tentativa Pix');
  assert.equal(s.pagamentos[0].mp_payment_id, '9400');
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(p.chamadas.post, 1, 'nenhum segundo POST lógico');
});

test('9. Pix ADMIN substituído: recuperação do sucessor não mexe no original', async t => {
  silenciar(t);
  const remoto = new Map();
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  let posts = 0;
  const p = provedor(t, {
    postar: () => {
      posts++;
      // Primeiro Pix nasce normal; a regeneração fica inconclusiva.
      return posts === 1
        ? Response.json({
            id: 9500, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
            point_of_interaction: {transaction_data: {qr_code: 'qr'}},
          })
        : new Response('offline', {status: 500});
    },
    remoto,
  });
  const gerar = body => app.adminPix.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/pix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify(body),
    }),
  });

  const original = await (await gerar({valorCentavos: 10000, operationKey: uuid('orig')})).json();
  const regen = await gerar({substituiId: original.pagamentoId, operationKey: uuid('regen')});
  assert.equal(regen.status, 502);

  const sucessor = (await db.prepare(
    'SELECT * FROM pedido_pagamentos WHERE substitui_pagamento_id = ?').bind(original.pagamentoId).all()
  ).results[0];
  const opRegen = (await db.prepare(
    'SELECT * FROM pedido_operacoes WHERE tipo = ?').bind('PIX_ADMIN_REGENERACAO').all()).results[0];
  remoto.set(referenciaPersistida(opRegen), [
    {id: 9501, status: 'pending', external_reference: referenciaPersistida(opRegen)},
  ]);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 2, 'nenhuma terceira tentativa');
  const orig = s.pagamentos.find(x => x.id === original.pagamentoId);
  const suc = s.pagamentos.find(x => x.id === sucessor.id);
  assert.equal(orig.mp_payment_id, '9500', 'original intocado');
  assert.equal(orig.status, 'PENDENTE', 'substituído continua reconciliável');
  assert.equal(suc.mp_payment_id, '9501', 'sucessor associado');
  assert.equal(suc.status, 'PENDENTE');
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(p.chamadas.post, 2, 'um POST por intenção legítima');
});

test('10. EXPIRADO -> PAGO continua exigindo autoridade do GET verificado (B2)', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  // A tentativa expira operacionalmente antes da recuperação.
  const pagamento = (await db.prepare('SELECT id FROM pedido_pagamentos').all()).results[0];
  await app.sync.expireLocalPayment(db, pagamento.id);
  assert.equal((await state(db)).pagamentos[0].status, 'EXPIRADO');

  // A busca propõe o id; o GET verificado é quem autoriza EXPIRADO -> PAGO.
  remoto.set(referencia, [{id: 9600, status: 'approved', external_reference: referencia}]);
  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO', 'recuperado por GET autoritativo');
  assert.equal(s.pagamentos[0].mp_payment_id, '9600');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  // A reserva já havia sido liberada pela expiração operacional; a baixa
  // reclama o estoque físico uma única vez e marca a conversão (Passo 7/B2).
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.ok(s.pedido.estoque_baixado_em);
  assert.equal(s.produtos[0].estoque, 8, 'baixa física única após reclamação');
  assert.equal(s.produtos[0].estoque_reservado, 0);

  // Um snapshot fabricado (não vindo do GET) não tem autoridade nenhuma.
  await assert.rejects(
    app.sync.syncPaymentFromMp(db, s.pagamentos[0].id, {id: 9600, status: 'approved'}),
    /RESPOSTA_MP_NAO_VERIFICADA/,
  );
});

test('11/12. busca indisponível: não inventa rejeição, mantém identidade e é repetível', async t => {
  silenciar(t);
  const {db, provedor: p, operacao} = await siteInconclusivo(t);
  // Busca falha por transporte.
  p.mock.mock.restore();
  let buscas = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') throw new Error('nenhum POST deve ocorrer');
    buscas++;
    throw new Error('search transport failure');
  });

  await envelhecer(db);
  await recuperar(db);
  let s = await state(db);
  assert.equal(buscas, 1);
  assert.equal(s.pagamentos[0].status, 'PENDENTE', 'falha de observação não é rejeição');
  assert.equal(s.pagamentos[0].mp_payment_id, null);
  assert.equal(s.pedido.reserva_status, 'ATIVA', 'nenhuma liberação genérica de reserva');
  assert.equal(s.operacoes[0].operation_key, operacao.operation_key, 'identidade preservada');
  assert.match(s.operacoes[0].erro, /^BUSCA:INDISPONIVEL:/);

  // Repetível: o throttle impede rajada, mas depois do prazo tenta de novo.
  await recuperar(db);
  assert.equal(buscas, 1, 'throttle respeitado dentro do prazo');
  await envelhecer(db);
  await recuperar(db);
  assert.equal(buscas, 2, 'nova tentativa após o prazo');
  s = await state(db);
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.pagamentos.length, 1);
});

test('13/15. recuperação repetida é idempotente: mesmo mp_payment_id e mesmos fatos', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  remoto.set(referencia, [{id: 9700, status: 'approved', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);
  const primeira = await state(db);

  // Repetir a recuperação: a operação já tem ID, sai da fila, nada muda.
  for (let i = 0; i < 3; i++) {
    await envelhecer(db);
    await recuperar(db);
  }
  const depois = await state(db);
  assert.equal(depois.pagamentos.length, 1);
  assert.equal(depois.pagamentos[0].mp_payment_id, '9700');
  assert.equal(depois.pagamentos[0].status, 'PAGO');
  assert.equal(depois.refunds.length, 0);
  assert.equal(depois.operacoes.length, 1);
  assert.equal(depois.produtos[0].estoque, primeira.produtos[0].estoque);
  assert.equal(depois.itens[0].estoque_baixado_em, primeira.itens[0].estoque_baixado_em);
  assert.equal(p.chamadas.post, 1);

  // E o retry da MESMA operationKey do A1 devolve a operação recuperada.
  const retry = await app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 2}],
        cliente: {nome: 'Teste', whatsapp: '11999999999'},
        operationKey: uuid('site'),
      }),
    }),
  });
  assert.equal(retry.status, 200, 'mesma operationKey, mesma operação');
  const corpo = await retry.json();
  assert.equal(String(corpo.paymentId), '9700');
  assert.equal(corpo.pedidoId, depois.pedido.id);
  assert.equal(p.chamadas.post, 1, 'nenhum segundo POST lógico');
});

test('operação recém-criada não é disputada pela recuperação (corte por idade)', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {remoto});
  remoto.set(referenciaPersistida(operacao), [
    {id: 9800, status: 'approved', external_reference: referenciaPersistida(operacao)},
  ]);

  // Sem envelhecer: o POST pode ainda estar em voo em outra requisição.
  await recuperar(db);
  assert.equal(p.chamadas.search, 0, 'não observa antes do prazo');
  assert.equal((await state(db)).pagamentos[0].mp_payment_id, null);
});

test('recuperação não roda sem access token e nunca toca o banco nesse caso', async t => {
  silenciar(t);
  const {db} = await siteInconclusivo(t);
  const antes = await state(db);
  await app.sync.recuperarOperacoesInconclusivas({DB: db});
  assert.deepEqual(await state(db), antes);
});

/* ───────── correlação: o recurso resolvido é da PRÓPRIA operação? ─────────
 *
 * `resolveWebhookPayment` responde "de quem é este recurso remoto?", que é a
 * pergunta certa para o webhook. A recuperação precisa de uma pergunta mais
 * estreita: "este recurso é da tentativa que ESTA operação registrou?".
 * A divergência é forçada aqui pelo caminho realista: o provedor ecoa, para a
 * referência da operação, um id que JÁ pertence a outra linha do banco
 * (histórico não auditado, Pix substituído). */

/** Insere uma segunda tentativa Pix do pedido já associada a `mpId`. */
const tentativaAlheia = (db, origem, mpId) =>
  db.prepare(`INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,
    mp_payment_id,idempotency_key) VALUES(1,'PIX_MP',?,10000,'PENDENTE',?,?)`)
    .bind(origem, mpId, `alheia-${mpId}`).run();

for (const escopo of ['SITE', 'ADMIN']) {
  test(`correlação ${escopo}: id que pertence a outra tentativa nunca é adotado`, async t => {
    silenciar(t);
    const remoto = new Map();
    const bancada = escopo === 'SITE'
      ? await siteInconclusivo(t, {remoto})
      : await adminInconclusivo(t, {remoto});
    const {db, provedor: p, operacao} = bancada;
    const referencia = referenciaPersistida(operacao);
    // O id devolvido para a NOSSA referência já é de outra linha do pedido.
    await tentativaAlheia(db, escopo, '9900');
    remoto.set(referencia, [{id: 9900, status: 'approved', external_reference: referencia}]);
    const antes = await state(db);

    await envelhecer(db);
    await recuperar(db);

    const depois = await state(db);
    assert.deepEqual(
      depois.pagamentos.map(x => [x.id, x.status, x.mp_payment_id]),
      antes.pagamentos.map(x => [x.id, x.status, x.mp_payment_id]),
      'nenhuma sincronização: nem na tentativa da operação, nem na alheia',
    );
    assert.equal(depois.pedido.status_pagamento, 'PENDENTE', 'nenhum estado financeiro promovido');
    assert.deepEqual(depois.produtos, antes.produtos, 'estoque e reserva intactos');
    assert.equal(depois.pedido.reserva_status, antes.pedido.reserva_status);
    assert.equal(depois.refunds.length, 0);
    assert.equal(p.chamadas.post, 1, 'nenhum POST, nenhuma tentativa nova');

    const op = (await db.prepare('SELECT * FROM pedido_operacoes WHERE operation_key = ?')
      .bind(operacao.operation_key).all()).results[0];
    assert.equal(op.erro, 'BUSCA:ASSOCIACAO_DIVERGENTE', 'diagnóstico persistido');
    assert.equal(op.fase, 'ENVIO_INCONCLUSIVO', 'não vira REMOTO_CONHECIDO com id alheio');
    assert.equal(op.mp_payment_id, null, 'identidade da operação não é contaminada');
    // Continua visível para intervenção.
    const visiveis = await app.operacoes.listarOperacoesInconclusivasDoPedido(db, 1);
    assert.equal(visiveis.length, 1);
  });
}

test('correlação: convergente segue o fluxo normal (mesma bancada, id próprio)', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  await tentativaAlheia(db, 'ADMIN', '9900'); // coexiste, mas não é a nossa
  remoto.set(referencia, [{id: 9901, status: 'approved', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);

  const s = await state(db);
  const nossa = s.pagamentos.find(x => x.id === operacao.pagamento_id);
  assert.equal(nossa.mp_payment_id, '9901', 'a tentativa da operação é a associada');
  assert.equal(nossa.status, 'PAGO');
  assert.equal(s.pagamentos.find(x => x.mp_payment_id === '9900').status, 'PENDENTE', 'alheia intocada');
  const op = (await db.prepare('SELECT * FROM pedido_operacoes WHERE operation_key = ?')
    .bind(operacao.operation_key).all()).results[0];
  assert.equal(op.mp_payment_id, '9901');
});

test('correlação: retry após divergência continua seguro e sem tentativa nova', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, provedor: p, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  await tentativaAlheia(db, 'SITE', '9902');
  remoto.set(referencia, [{id: 9902, status: 'approved', external_reference: referencia}]);

  await envelhecer(db);
  await recuperar(db);
  const aposPrimeira = await state(db);
  await envelhecer(db);
  await recuperar(db);

  // `pedido_operacoes.atualizado_em` avança de propósito a cada observação —
  // é o registro de que a recuperação rodou de novo, e o throttle depende
  // dele. O invariante é que NADA de domínio muda: nem fato financeiro, nem
  // tentativa, nem reserva, nem estoque, nem a fase/diagnóstico da operação.
  const semCarimbo = s => ({...s, operacoes: s.operacoes.map(({atualizado_em, ...o}) => o)});
  assert.deepEqual(semCarimbo(await state(db)), semCarimbo(aposPrimeira),
    'repetir a divergência é inerte para o domínio');
  assert.equal(p.chamadas.post, 1, 'nenhuma tentativa nova em nenhum ciclo');
  assert.equal(p.chamadas.search, 2, 'observação repetível, decisão continua recusada');
  const op = (await db.prepare('SELECT * FROM pedido_operacoes WHERE operation_key = ?')
    .bind(operacao.operation_key).all()).results[0];
  assert.equal(op.erro, 'BUSCA:ASSOCIACAO_DIVERGENTE');
  assert.equal(op.fase, 'ENVIO_INCONCLUSIVO', 'a fase não avança por observação repetida');
});

test('correlação: webhook legítimo posterior ainda converge normalmente', async t => {
  silenciar(t);
  const remoto = new Map();
  const {db, operacao} = await siteInconclusivo(t, {remoto});
  const referencia = referenciaPersistida(operacao);
  await tentativaAlheia(db, 'ADMIN', '9903');
  remoto.set(referencia, [{id: 9903, status: 'approved', external_reference: referencia}]);
  await envelhecer(db);
  await recuperar(db);
  assert.equal((await state(db)).pedido.status_pagamento, 'PENDENTE');

  // O recurso REAL da nossa tentativa aparece pelo caminho autoritativo.
  remoto.set(referencia, [{id: 9904, status: 'approved', external_reference: referencia}]);
  const payment = await app.sync.fetchMpPayment('fake', '9904');
  const resolvido = await app.sync.resolveWebhookPayment(db, payment);
  assert.equal(resolvido.kind, 'found');
  assert.equal(resolvido.pagamentoId, operacao.pagamento_id);
  await app.sync.syncPaymentFromMp(db, resolvido.pagamentoId, payment);

  const s = await state(db);
  assert.equal(s.pagamentos.find(x => x.id === operacao.pagamento_id).status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.produtos[0].estoque, 8, 'baixa física uma única vez');
});
