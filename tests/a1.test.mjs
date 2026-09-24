import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, barrier} from './helpers/b3.mjs';

// A1 — regressões de identidade lógica/idempotência.
//
// A investigação (docs/investigacoes/A1-IDEMPOTENCIA.md) já PROVOU a
// vulnerabilidade com 38 cenários. Esta suíte não a repete: ela prova a
// CORREÇÃO, com o código real de produção, D1 local descartável criado pelas
// migrations (constraints e rollback de verdade) e Mercado Pago simulado.
//
// Onde concorrência importa de verdade, as duas chamadas são forçadas a
// concluir suas leituras antes de qualquer escrita, via barreira
// determinística no hook do D1 — nunca dois `Promise.all` sem controle de
// ordem.

const KEY = '11111111-1111-4111-8111-111111111111';
const KEY2 = '22222222-2222-4222-8222-222222222222';
const cookieDe = session => session.cookie.split(';')[0];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const silenciarLogs = t => t.mock.method(console, 'error', () => {});

function endpoint(modulo, db, {id = '1', body, session, env: extra = {}} = {}) {
  return app[modulo].onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake', ...extra},
    params: {id},
    request: new Request('https://local.test/api/x', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: 'https://local.test', ...(session ? {Cookie: cookieDe(session)} : {})},
      body: JSON.stringify(body),
    }),
  });
}

async function corpo(response) {
  return {status: response.status, body: await response.json()};
}

// As duas requisições precisam estar EM VOO antes de qualquer await, senão a
// barreira determinística nunca é atingida (a primeira ficaria esperando uma
// segunda que nem começou).
function ambas(a, b) {
  return Promise.all([a, b].map(async promessa => corpo(await promessa)));
}

/* ─────────────────────────── PAGAMENTO MANUAL ─────────────────────────── */

async function comandaAberta(t) {
  const db = await fixture(t, {ledger: false});
  return {db, session: await app.auth.createSession(db, 1)};
}

const pagar = (db, session, body) =>
  endpoint('adminPayment', db, {session, body: {metodo: 'DINHEIRO', valorCentavos: 3000, ...body}});

test('pagamento: mesma key + mesmo payload => mesmo pagamento, um único fato', async t => {
  const {db, session} = await comandaAberta(t);
  const primeira = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(primeira.status, 201);
  assert.equal(primeira.body.ok, true);

  // Retry cego (resposta HTTP anterior perdida do ponto de vista do cliente).
  const retry = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.pagamentoId, primeira.body.pagamentoId);
  assert.equal(retry.body.replay, true);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, 'nenhum segundo fato financeiro');
  assert.equal(s.pagamentos[0].valor_centavos, 3000);
  assert.equal(s.alocacoes.length, 1);
  assert.equal(s.alocacoes[0].valor_centavos, 3000);
  assert.equal(s.pedido.status_pagamento, 'PARCIAL');
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.operacoes[0].tipo, 'PAGAMENTO_ADMIN');
  assert.equal(s.operacoes[0].fase, 'CONCLUIDA');
  assert.equal(s.operacoes[0].pagamento_id, primeira.body.pagamentoId);
});

test('pagamento: mesma key concorrente => exatamente um pagamento; o perdedor recupera o vencedor', async t => {
  const {db, session} = await comandaAberta(t);
  const escritas = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('INSERT INTO pedido_pagamentos'))) await escritas();
  };
  const resultados = await ambas(
    pagar(db, session, {operationKey: KEY}),
    pagar(db, session, {operationKey: KEY}),
  );
  db.hook = null;

  assert.ok(resultados.every(r => r.status === 201), 'ambas respondem sucesso lógico');
  assert.equal(resultados[0].body.pagamentoId, resultados[1].body.pagamentoId, 'um único id financeiro');
  assert.equal(resultados.filter(r => r.body.replay === true).length, 1, 'exatamente um replay');

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.alocacoes.length, 1);
});

test('pagamento: mesma key + payload incompatível => conflito estável, sem nova escrita', async t => {
  const {db, session} = await comandaAberta(t);
  const primeira = await corpo(await pagar(db, session, {operationKey: KEY}));
  const antes = await state(db);

  for (const divergente of [
    {valorCentavos: 4000},
    {metodo: 'CARTAO'},
    {observacao: 'outro'},
  ]) {
    const conflito = await corpo(await pagar(db, session, {operationKey: KEY, ...divergente}));
    assert.equal(conflito.status, 409);
    assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_PAYLOAD');
  }
  // Estável: repetir com o payload original volta a recuperar o mesmo fato.
  const replay = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(replay.body.pagamentoId, primeira.body.pagamentoId);
  assert.deepEqual(await state(db), antes, 'nenhuma escrita de domínio no conflito');
});

test('pagamento: a mesma key usada em outro tipo de operação é conflito', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('rede nunca deve ser usada'); });
  await pagar(db, session, {operationKey: KEY});

  // Mesma key num endpoint de outro tipo (Pix ADMIN): conflito de tipo, e
  // nenhuma chamada ao provedor.
  const tipo = await corpo(await endpoint('adminPix', db, {session, body: {valorCentavos: 4000, operationKey: KEY}}));
  assert.equal(tipo.status, 409);
  assert.equal(tipo.body.code, 'OPERACAO_CONFLITO_TIPO');
  assert.equal(fetch.mock.callCount(), 0);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.operacoes.length, 1);
});

test('pagamento: keys diferentes continuam sendo operações aditivas independentes', async t => {
  const {db, session} = await comandaAberta(t);
  const a = await corpo(await pagar(db, session, {operationKey: KEY}));
  const b = await corpo(await pagar(db, session, {operationKey: KEY2}));
  assert.notEqual(a.body.pagamentoId, b.body.pagamentoId);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 2, 'duas intenções legítimas com payload idêntico');
  assert.equal(s.operacoes.length, 2);
  assert.equal(s.pedido.status_pagamento, 'PARCIAL');

  // Os guards financeiros do domínio continuam valendo para a key nova.
  const excesso = await corpo(await pagar(db, session, {operationKey: '33333333-3333-4333-8333-333333333333', valorCentavos: 99999}));
  assert.equal(excesso.status, 409);
  assert.equal((await state(db)).pagamentos.length, 2);
});

test('pagamento: retry depois de o pedido ficar PAGO recupera o pagamento original', async t => {
  const {db, session} = await comandaAberta(t);
  const primeira = await corpo(await pagar(db, session, {operationKey: KEY}));
  // Quita o restante com OUTRA intenção: o pedido muda de estado.
  await pagar(db, session, {operationKey: KEY2, valorCentavos: 7000});
  const pago = await state(db);
  assert.equal(pago.pedido.status_pagamento, 'PAGO');

  // O lookup por key acontece ANTES dos guards de estado: o retry não é
  // reinterpretado como uma nova tentativa contra o estado novo (que
  // recusaria por saldo) nem cria um terceiro fato.
  const retry = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.pagamentoId, primeira.body.pagamentoId);
  assert.equal(retry.body.replay, true);
  assert.equal((await state(db)).pagamentos.length, 2);
});

test('pagamento: falha antes do commit não deixa claim órfão e permite retry da mesma key', async t => {
  const {db, session} = await comandaAberta(t);
  silenciarLogs(t);
  db.hook = (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('INSERT INTO pedido_pagamentos'))) {
      db.hook = null;
      throw new Error('injected pre-commit failure');
    }
  };
  const falha = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(falha.status, 409);
  const s = await state(db);
  assert.equal(s.pagamentos.length, 0);
  assert.equal(s.operacoes.length, 0, 'claim e fato são atômicos: nenhum sobrevive sozinho');

  const depois = await corpo(await pagar(db, session, {operationKey: KEY}));
  assert.equal(depois.status, 201);
  assert.equal((await state(db)).pagamentos.length, 1);
});

/* ────────────────────────────── REFUND ──────────────────────────────── */

async function pedidoComPagamentoManual(t) {
  const db = await fixture(t, {paid: true});
  await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO',origem='ADMIN',mp_payment_id=NULL WHERE id=1").run();
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  return {db, session: await app.auth.createSession(db, 1)};
}

const estornar = (db, session, body) =>
  endpoint('adminRefund', db, {session, body: {pagamentoId: 1, valorCentavos: 3000, ...body}});

test('refund: mesma key + mesmo payload => um único refund, retry recupera', async t => {
  const {db, session} = await pedidoComPagamentoManual(t);
  const primeira = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(primeira.status, 201);

  const retry = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.reembolsoId, primeira.body.reembolsoId);
  assert.equal(retry.body.replay, true);

  const s = await state(db);
  assert.equal(s.refunds.length, 1, 'nenhuma segunda devolução registrada');
  assert.equal(s.refunds[0].valor_centavos, 3000);
  assert.equal(s.operacoes.length, 1);
  assert.equal(s.operacoes[0].tipo, 'REFUND_ADMIN');
});

test('refund: mesma key concorrente => exatamente um refund', async t => {
  const {db, session} = await pedidoComPagamentoManual(t);
  const escritas = barrier(2);
  db.hook = async (s, op) => {
    if (s.some(x => x.sql.includes('INSERT INTO pedido_reembolsos'))) await escritas();
  };
  const resultados = await ambas(
    estornar(db, session, {operationKey: KEY}),
    estornar(db, session, {operationKey: KEY}),
  );
  db.hook = null;

  assert.ok(resultados.every(r => r.status === 201));
  assert.equal(resultados[0].body.reembolsoId, resultados[1].body.reembolsoId);
  assert.equal((await state(db)).refunds.length, 1);
});

test('refund: mesma key + payload diferente => conflito; keys diferentes => refunds distintos', async t => {
  const {db, session} = await pedidoComPagamentoManual(t);
  await estornar(db, session, {operationKey: KEY});
  const antes = await state(db);

  const conflito = await corpo(await estornar(db, session, {operationKey: KEY, valorCentavos: 5000}));
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_PAYLOAD');
  assert.deepEqual(await state(db), antes);

  const segunda = await corpo(await estornar(db, session, {operationKey: KEY2}));
  assert.equal(segunda.status, 201);
  assert.equal((await state(db)).refunds.length, 2, 'devoluções parciais legítimas continuam possíveis');
});

test('refund: mudança posterior do saldo reembolsável não transforma retry em nova devolução', async t => {
  const {db, session} = await pedidoComPagamentoManual(t);
  const primeira = await corpo(await estornar(db, session, {operationKey: KEY}));
  // Consome TODO o saldo reembolsável restante com outra intenção.
  const resto = await corpo(await estornar(db, session, {operationKey: KEY2, valorCentavos: 7000}));
  assert.equal(resto.status, 201);

  const retry = await corpo(await estornar(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201, 'recupera o refund original em vez de recusar por saldo');
  assert.equal(retry.body.reembolsoId, primeira.body.reembolsoId);
  const s = await state(db);
  assert.equal(s.refunds.length, 2);
  assert.equal(s.refunds.reduce((total, r) => total + r.valor_centavos, 0), 10000);
});

/* ───────────────────────────── PEDIDO ADMIN ──────────────────────────── */

async function balcao(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=10, estoque_reservado=0 WHERE id=1').run();
  return {db, session: await app.auth.createSession(db, 1)};
}

const criarPedido = (db, session, body) =>
  app.adminCreate.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/pedidos', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({
        itens: [{produtoId: 1, quantidade: 2}],
        clienteNome: 'Balcao',
        clienteWhatsapp: '11999999999',
        metodoPagamento: 'DINHEIRO',
        statusPagamento: 'PAGO',
        ...body,
      }),
    }),
  });

test('pedido ADMIN PAGO: mesma key => mesmo pedido e UMA única baixa física', async t => {
  const {db, session} = await balcao(t);
  const primeira = await corpo(await criarPedido(db, session, {operationKey: KEY}));
  assert.equal(primeira.status, 201);
  assert.equal(primeira.body.estoqueBaixado, true);

  const retry = await corpo(await criarPedido(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.pedidoId, primeira.body.pedidoId);
  assert.equal(retry.body.tokenPublico, primeira.body.tokenPublico);
  assert.equal(retry.body.replay, true);

  const pedidos = (await db.prepare('SELECT * FROM pedidos').all()).results;
  assert.equal(pedidos.length, 1, 'nenhum segundo pedido já pago');
  const produto = await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first();
  assert.equal(produto.estoque, 8, 'baixa física aconteceu exatamente uma vez');
  assert.equal(produto.estoque_reservado, 0);
  const itens = (await db.prepare('SELECT * FROM pedido_itens').all()).results;
  assert.equal(itens.length, 1);
  const pagamentos = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results;
  assert.equal(pagamentos.length, 1);
  assert.equal(pagamentos[0].status, 'PAGO');
});

test('pedido ADMIN: mesma key concorrente => exatamente um pedido', async t => {
  const {db, session} = await balcao(t);
  const escritas = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('INSERT INTO pedidos'))) await escritas();
  };
  const resultados = await ambas(
    criarPedido(db, session, {operationKey: KEY}),
    criarPedido(db, session, {operationKey: KEY}),
  );
  db.hook = null;

  assert.ok(resultados.every(r => r.status === 201));
  assert.equal(resultados[0].body.pedidoId, resultados[1].body.pedidoId);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT estoque FROM produtos WHERE id=1').first()).estoque, 8);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_operacoes').first()).n, 1);
});

test('pedido ADMIN: payload incompatível com a mesma key é conflito', async t => {
  const {db, session} = await balcao(t);
  await criarPedido(db, session, {operationKey: KEY});
  const conflito = await corpo(await criarPedido(db, session, {
    operationKey: KEY, itens: [{produtoId: 1, quantidade: 3}],
  }));
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_PAYLOAD');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT estoque FROM produtos WHERE id=1').first()).estoque, 8);
});

test('pedido ADMIN: retry recupera o pedido mesmo sem estoque para criar um igual agora', async t => {
  const {db, session} = await balcao(t);
  const primeira = await corpo(await criarPedido(db, session, {operationKey: KEY}));
  await db.prepare('UPDATE produtos SET estoque=0 WHERE id=1').run();

  const retry = await corpo(await criarPedido(db, session, {operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.pedidoId, primeira.body.pedidoId);
});

/* ───────────────────────────── CHECKOUT SITE ─────────────────────────── */

function mpPost(t, {responder} = {}) {
  let id = 500;
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.mercadopago\.com\/v1\/payments/);
    if (options?.method === 'PUT') {
      const paymentId = Number(String(url).split('/').at(-1)) || 101;
      return Response.json({id: paymentId, status: 'cancelled'});
    }
    if (options?.method !== 'POST') {
      const paymentId = Number(String(url).split('/').at(-1)) || 101;
      return Response.json({id: paymentId, status: paymentId === 101 ? 'approved' : 'pending'});
    }
    const key = options.headers['X-Idempotency-Key'];
    if (responder) {
      const resposta = await responder({key, body: JSON.parse(options.body)});
      if (resposta) return resposta;
    }
    return Response.json({
      id: ++id, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {transaction_data: {qr_code: `qr-${id}`}},
    });
  });
}

async function siteLimpo(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=10, estoque_reservado=0 WHERE id=1').run();
  return db;
}

const checkout = (db, body) =>
  app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 2}],
        cliente: {nome: 'Teste', whatsapp: '11999999999'},
        ...body,
      }),
    }),
  });

test('checkout: mesma key => um pedido, uma reserva, uma tentativa, uma identidade MP', async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);

  const primeira = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(primeira.status, 200);

  const retry = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, primeira.body, 'mesmo resultado lógico, inclusive o QR');

  const chavesMp = mp.mock.calls
    .filter(c => c.arguments[1]?.method === 'POST')
    .map(c => c.arguments[1].headers['X-Idempotency-Key']);
  assert.equal(chavesMp.length, 1, 'nenhum segundo POST lógico');
  assert.equal(new Set(chavesMp).size, 1);

  const pedidos = (await db.prepare('SELECT * FROM pedidos').all()).results;
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].reserva_status, 'ATIVA');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_itens').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_pagamentos').first()).n, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);
});

test('checkout: mesma key concorrente => uma operação; o perdedor não reserva nem faz POST', async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);
  const escritas = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('INSERT INTO pedidos'))) await escritas();
  };
  const resultados = await ambas(
    checkout(db, {operationKey: KEY}),
    checkout(db, {operationKey: KEY}),
  );
  db.hook = null;

  // Uma operação lógica vence e o perdedor recupera a vencedora. Ele pode
  // legitimamente ver DOIS desfechos, conforme releia antes ou depois de a
  // vencedora concluir o POST:
  //   * antes  -> 409 OPERACAO_EM_PROCESSAMENTO (resultado remoto desconhecido);
  //   * depois -> 200 apontando para o MESMO pedido.
  // Nenhum dos dois inventa sucesso ou rejeição, e nenhum cria uma segunda
  // operação — é isso que a corrida precisa provar. Fixar um dos desfechos
  // seria assumir um timing, não uma invariante.
  const vencedoras = resultados.filter(r => r.status === 200);
  assert.ok(vencedoras.length >= 1, 'ao menos uma conclui');
  for (const r of resultados) {
    if (r.status !== 200) {
      assert.equal(r.status, 409);
      assert.equal(r.body.code, 'OPERACAO_EM_PROCESSAMENTO');
    }
    assert.equal(r.body.pedidoId, vencedoras[0].body.pedidoId,
      'sucesso ou "em processamento", sempre o MESMO pedido');
  }

  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_pagamentos').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_operacoes').first()).n, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);

  // E um retry posterior da mesma key já recupera o sucesso persistido.
  const depois = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(depois.status, 200);
  assert.equal(depois.body.pedidoId, vencedoras[0].body.pedidoId);
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, 1);
});

test('checkout: payload incompatível é conflito; key nova é uma intenção nova', async t => {
  const db = await siteLimpo(t);
  mpPost(t);
  const primeira = await corpo(await checkout(db, {operationKey: KEY}));

  const conflito = await corpo(await checkout(db, {operationKey: KEY, items: [{id: 1, quantity: 1}]}));
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_PAYLOAD');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);

  // Nova finalização explícita: pedido novo, sujeito aos guards de estoque.
  const nova = await corpo(await checkout(db, {operationKey: KEY2}));
  assert.equal(nova.status, 200);
  assert.notEqual(nova.body.pedidoId, primeira.body.pedidoId);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 2);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 4);
});

test('checkout: key inválida/ausente é recusada antes de qualquer escrita', async t => {
  const db = await siteLimpo(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('rede nunca deve ser usada'); });
  for (const operationKey of [undefined, '', 'curta', 'com espaco aqui', 123, null]) {
    const r = await corpo(await checkout(db, {operationKey}));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'OPERATION_KEY_INVALIDA');
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 0);
});

/* ───────────── CHECKOUT: FALHAS DO ENVIO AO MERCADO PAGO ─────────────── */

for (const [nome, resposta] of [
  ['timeout/transporte', null],
  ['HTTP 500', new Response('offline', {status: 500})],
  ['HTTP 502', new Response('bad gateway', {status: 502})],
  ['HTTP 429', new Response('slow down', {status: 429})],
  ['2xx sem id utilizável', Response.json({status: 'pending'})],
]) {
  test(`checkout: resultado ambíguo (${nome}) mantém a operação inconclusiva e a reserva`, async t => {
    const db = await siteLimpo(t);
    silenciarLogs(t);
    mpPost(t, {responder: async () => {
      if (resposta === null) throw new Error('transport failure');
      return resposta.clone();
    }});

    const r = await corpo(await checkout(db, {operationKey: KEY}));
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'MERCADO_PAGO_INDISPONIVEL');

    const s = await state(db);
    const pedido = (await db.prepare('SELECT * FROM pedidos').all()).results[0];
    const pagamento = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results[0];
    assert.equal(pagamento.status, 'PENDENTE', 'nunca FALHOU: rejeição não foi provada');
    assert.equal(pedido.reserva_status, 'ATIVA', 'reserva do PEDIDO preservada (B4)');
    assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);
    assert.equal(s.operacoes.length, 1);
    assert.equal(s.operacoes[0].fase, 'ENVIO_INCONCLUSIVO');
    assert.ok(s.operacoes[0].mp_idempotency_key, 'key MP preservada para a mesma operação');
    assert.ok(s.operacoes[0].mp_request, 'conteúdo original do POST preservado');
  });
}

test('checkout: retry depois de ambíguo não gera nova key, novo pedido nem novo POST', async t => {
  const db = await siteLimpo(t);
  silenciarLogs(t);
  const mp = mpPost(t, {responder: async () => new Response('offline', {status: 500})});
  await checkout(db, {operationKey: KEY});
  const postsAmbiguos = mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length;

  const retry = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'OPERACAO_EM_PROCESSAMENTO');
  assert.ok(retry.body.tokenPublico, 'devolve o pedido que já existe para acompanhamento');

  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, postsAmbiguos,
    'nenhum reenvio automático');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT reserva_status FROM pedidos').first()).reserva_status, 'ATIVA');
});

test('checkout: recusa comprovada libera reserva e o retry devolve a MESMA recusa sem novo POST', async t => {
  const db = await siteLimpo(t);
  silenciarLogs(t);
  const mp = mpPost(t, {responder: async () => Response.json({message: 'invalid'}, {status: 400})});

  const r = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'MERCADO_PAGO_RECUSOU');
  const pagamento = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results[0];
  assert.equal(pagamento.status, 'FALHOU');
  assert.equal((await db.prepare('SELECT reserva_status FROM pedidos').first()).reserva_status, 'LIBERADA');

  const posts = mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length;
  const retry = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(retry.status, 502);
  assert.equal(retry.body.code, 'MERCADO_PAGO_RECUSOU');
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, posts);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
});

test('checkout: recurso MP conhecido + falha no batch de persistência permanece LOCAL_CRIADA e recupera pelo B3', async t => {
  const db = await siteLimpo(t);
  silenciarLogs(t);
  const mp = mpPost(t);
  // Falha na gravação dos detalhes locais, DEPOIS do sucesso remoto. O batch
  // agora inclui a transição para REMOTO_CONHECIDO, então a falha reverte
  // TUDO junto: pedido_pagamentos.mp_payment_id continua NULL e a operação
  // permanece LOCAL_CRIADA — a janela que antes deixava a operação
  // REMOTO_CONHECIDO com a tentativa órfã de identidade remota não existe mais.
  db.hook = (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('SET mp_payment_id = ?'))) {
      db.hook = null;
      throw new Error('injected local persistence failure');
    }
  };
  // O endpoint converte a falha inesperada em 500 — nunca afirma sucesso
  // com o estado local quebrado.
  const falha = await checkout(db, {operationKey: KEY});
  assert.equal(falha.status, 500);

  const operacao = (await db.prepare('SELECT * FROM pedido_operacoes').all()).results[0];
  assert.equal(operacao.fase, 'LOCAL_CRIADA', 'fase não avança para REMOTO_CONHECIDO sem a persistência');
  assert.equal(operacao.mp_payment_id, null, 'identidade remota só nasce junto com a tentativa');
  const tentativa = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results[0];
  assert.equal(tentativa.mp_payment_id, null, 'tentativa sem identidade remota após o rollback');

  // O retry com a MESMA key NÃO faz novo POST nem inventa sucesso: devolve a
  // operação ainda inconclusiva e recuperável pelo B3 (mp_payment_id NULL +
  // LOCAL_CRIADA entram na seleção de operações inconclusivas).
  const posts = mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length;
  const retry = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'OPERACAO_EM_PROCESSAMENTO');
  assert.ok(retry.body.tokenPublico, 'devolve o pedido que já existe para acompanhamento');
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, posts,
    'nenhum reenvio automático');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT reserva_status FROM pedidos').first()).reserva_status, 'ATIVA');
});

test('checkout: fluxo feliz grava identidade remota e fase CONCLUIDA no mesmo batch', async t => {
  const db = await siteLimpo(t);
  mpPost(t);
  const r = await corpo(await checkout(db, {operationKey: KEY}));
  assert.equal(r.status, 200);

  const pedido = await db.prepare('SELECT mp_payment_id FROM pedidos').first();
  const pagamento = await db.prepare('SELECT mp_payment_id FROM pedido_pagamentos').first();
  const operacao = await db.prepare('SELECT fase, mp_payment_id, resultado FROM pedido_operacoes').first();
  assert.ok(pedido.mp_payment_id, 'pedidos.mp_payment_id gravado');
  assert.ok(pagamento.mp_payment_id, 'pedido_pagamentos.mp_payment_id gravado');
  assert.equal(pedido.mp_payment_id, pagamento.mp_payment_id, 'mesma identidade remota nos dois alvos');
  assert.equal(operacao.fase, 'CONCLUIDA');
  assert.equal(operacao.mp_payment_id, pagamento.mp_payment_id, 'identidade remota também na operação');
  assert.ok(operacao.resultado, 'snapshot persistido junto');
});

test('checkout: última unidade em disputa entre keys distintas faz rollback completo do perdedor', async t => {
  const db = await siteLimpo(t);
  silenciarLogs(t);
  await db.prepare('UPDATE produtos SET estoque=3 WHERE id=1').run();
  const mp = mpPost(t);
  const leituras = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'all' && s[0].sql.includes('FROM produtos WHERE id IN')) await leituras();
  };
  const resultados = await ambas(
    checkout(db, {operationKey: KEY}),
    checkout(db, {operationKey: KEY2}),
  );
  db.hook = null;

  assert.equal(resultados.filter(r => r.status === 200).length, 1);
  assert.equal(resultados.filter(r => r.status === 409).length, 1);
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, 1,
    'o perdedor não chega a enviar nada ao provedor');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedidos').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_operacoes').first()).n, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);
});

/* ────────────────────────────── PIX ADMIN ───────────────────────────── */

const gerarPix = (db, session, body) =>
  endpoint('adminPix', db, {session, body});

test('pix ADMIN: retry da mesma key => mesma tentativa, mesma identidade MP, mesma reserva', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  const mp = mpPost(t);

  const primeira = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(primeira.status, 201);

  const retry = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.pagamentoId, primeira.body.pagamentoId);
  assert.equal(retry.body.mpPaymentId, primeira.body.mpPaymentId);
  assert.equal(retry.body.replay, true);

  const chaves = mp.mock.calls
    .filter(c => c.arguments[1]?.method === 'POST')
    .map(c => c.arguments[1].headers['X-Idempotency-Key']);
  assert.equal(chaves.length, 1, 'nenhum segundo POST lógico com outra identidade');

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.produtos[0].estoque_reservado, 2, 'reserva do pedido, nunca por tentativa');
});

test('pix ADMIN: mesma key concorrente => uma tentativa; keys distintas => Pix aditivos legítimos', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  mpPost(t);
  const escritas = barrier(2);
  db.hook = async (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('INSERT INTO pedido_pagamentos'))) await escritas();
  };
  const mesma = await ambas(
    gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY}),
    gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY}),
  );
  db.hook = null;
  // Uma operação lógica vence e o perdedor recupera a vencedora. O perdedor
  // pode legitimamente ver DOIS desfechos, conforme ele releia antes ou
  // depois de a vencedora concluir o POST:
  //   * antes  -> 409 OPERACAO_EM_PROCESSAMENTO (resultado remoto desconhecido);
  //   * depois -> 201 com `replay`, apontando para a MESMA tentativa.
  // Os dois são corretos; fixar um deles seria assumir um timing. O que a
  // corrida precisa provar é o invariante: nunca uma segunda tentativa Pix.
  assert.ok(mesma.some(r => r.status === 201), 'ao menos uma conclui');
  for (const r of mesma) {
    if (r.status === 201) {
      assert.equal(r.body.pagamentoId, mesma.find(x => x.status === 201).body.pagamentoId,
        'todo sucesso aponta para a MESMA tentativa');
    } else {
      assert.equal(r.body.code, 'OPERACAO_EM_PROCESSAMENTO');
    }
  }
  assert.equal((await state(db)).pagamentos.length, 1, 'uma única tentativa Pix');
  assert.equal((await state(db)).operacoes.length, 1, 'uma única operação lógica');

  // Retry posterior da mesma key recupera a tentativa já concluída.
  const retry = await corpo(await gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY}));
  assert.equal(retry.status, 201);
  assert.equal(retry.body.replay, true);
  assert.equal((await state(db)).pagamentos.length, 1);

  const aditivo = await corpo(await gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY2}));
  assert.equal(aditivo.status, 201);
  assert.equal((await state(db)).pagamentos.length, 2, 'Pix parciais aditivos continuam possíveis');
});

test('pix ADMIN: regeneração com a mesma key => mesmo sucessor, mesmo depois de ele expirar', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  const mp = mpPost(t);

  const original = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  const regenKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sucessor = await corpo(await gerarPix(db, session, {substituiId: original.body.pagamentoId, operationKey: regenKey}));
  assert.equal(sucessor.status, 201);

  const retry = await corpo(await gerarPix(db, session, {substituiId: original.body.pagamentoId, operationKey: regenKey}));
  assert.equal(retry.body.pagamentoId, sucessor.body.pagamentoId);
  assert.equal(retry.body.replay, true);

  // O sucessor morre depois. O retry da regeneração ANTIGA continua sendo a
  // mesma operação: não vira uma nova regeneração.
  await db.prepare('UPDATE pedido_pagamentos SET status=? WHERE id=?')
    .bind('EXPIRADO', sucessor.body.pagamentoId).run();
  const depois = await corpo(await gerarPix(db, session, {substituiId: original.body.pagamentoId, operationKey: regenKey}));
  assert.equal(depois.body.pagamentoId, sucessor.body.pagamentoId);
  assert.equal((await state(db)).pagamentos.length, 2, 'nenhum terceiro Pix');

  // Uma nova tentativa legítima, explicitamente iniciada, usa key nova.
  const nova = await corpo(await gerarPix(db, session, {
    valorCentavos: 5000, operationKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }));
  assert.equal(nova.status, 201);
  assert.notEqual(nova.body.pagamentoId, sucessor.body.pagamentoId);
  assert.equal((await state(db)).pagamentos.length, 3);

  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, 3,
    'um POST por intenção legítima, nunca por retry');
});

test('pix ADMIN: geração e regeneração são tipos de operação distintos para a mesma key', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  mpPost(t);
  const original = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  const conflito = await corpo(await gerarPix(db, session, {substituiId: original.body.pagamentoId, operationKey: KEY}));
  assert.equal(conflito.status, 409);
  assert.equal(conflito.body.code, 'OPERACAO_CONFLITO_TIPO');
  assert.equal((await state(db)).pagamentos.length, 1);
});

test('pix ADMIN: 5xx do POST não inventa FALHOU nem libera a reserva; retry recupera a mesma operação', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  silenciarLogs(t);
  const mp = mpPost(t, {responder: async () => new Response('offline', {status: 503})});

  const r = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'MERCADO_PAGO_INDISPONIVEL');
  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PENDENTE');
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.produtos[0].estoque_reservado, 2);
  assert.equal(s.operacoes[0].fase, 'ENVIO_INCONCLUSIVO');

  const posts = mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length;
  const retry = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(retry.body.code, 'OPERACAO_EM_PROCESSAMENTO');
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, posts);
  assert.equal((await state(db)).pagamentos.length, 1);
});

test('pix ADMIN: recurso MP conhecido + falha no batch de persistência permanece LOCAL_CRIADA', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  silenciarLogs(t);
  const mp = mpPost(t);
  // Falha injetada no batch que persiste mp_payment_id/QR — agora também a
  // transição REMOTO_CONHECIDO. O rollback reverte tudo junto: a tentativa
  // fica sem identidade remota E a operação permanece LOCAL_CRIADA (estado
  // recuperável pelo B3, nunca o órfão REMOTO_CONHECIDO+NULL de antes).
  db.hook = (s, op) => {
    if (op === 'batch' && s.some(x => x.sql.includes('SET mp_payment_id = ?'))) {
      db.hook = null;
      throw new Error('injected local persistence failure');
    }
  };
  const falha = await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY});
  assert.equal(falha.status, 500);

  const operacao = (await db.prepare('SELECT * FROM pedido_operacoes').all()).results[0];
  assert.equal(operacao.fase, 'LOCAL_CRIADA');
  assert.equal(operacao.mp_payment_id, null);
  const tentativa = (await db.prepare('SELECT * FROM pedido_pagamentos').all()).results[0];
  assert.equal(tentativa.mp_payment_id, null);

  const posts = mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length;
  const retry = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'OPERACAO_EM_PROCESSAMENTO');
  assert.equal(mp.mock.calls.filter(c => c.arguments[1]?.method === 'POST').length, posts,
    'nenhum reenvio automático');
  assert.equal((await state(db)).pagamentos.length, 1);
});

test('pix ADMIN: fluxo feliz grava identidade remota e fase CONCLUIDA no mesmo batch', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  mpPost(t);
  const r = await corpo(await gerarPix(db, session, {valorCentavos: 5000, operationKey: KEY}));
  assert.equal(r.status, 201);

  const pagamento = await db.prepare('SELECT mp_payment_id FROM pedido_pagamentos WHERE id = ?')
    .bind(r.body.pagamentoId).first();
  const operacao = await db.prepare('SELECT fase, mp_payment_id, resultado FROM pedido_operacoes').first();
  assert.ok(pagamento.mp_payment_id, 'pedido_pagamentos.mp_payment_id gravado');
  assert.equal(operacao.fase, 'CONCLUIDA');
  assert.equal(operacao.mp_payment_id, pagamento.mp_payment_id, 'identidade remota também na operação');
  assert.ok(operacao.resultado, 'snapshot persistido junto');
});

test('fase terminal é guarda: write tardio de REMOTO_CONHECIDO não reabre CONCLUIDA', async t => {
  const db = await siteLimpo(t);
  mpPost(t);
  await corpo(await checkout(db, {operationKey: KEY}));
  const antes = await db.prepare('SELECT fase, mp_payment_id FROM pedido_operacoes').first();
  assert.equal(antes.fase, 'CONCLUIDA');

  // Resposta tardia do provedor não pode reabrir a operação terminal nem
  // sobrescrever a identidade já gravada — a guarda é preservada pela
  // primitiva batchable e pelo invólucro standalone.
  await app.operacoes.registrarFase(db, KEY, {fase: 'REMOTO_CONHECIDO', mpPaymentId: '9999'});
  const depois = await db.prepare('SELECT fase, mp_payment_id FROM pedido_operacoes').first();
  assert.equal(depois.fase, 'CONCLUIDA', 'guarda terminal preservada');
  assert.equal(depois.mp_payment_id, antes.mp_payment_id, 'identidade não é sobrescrita');

  await db.batch([
    app.operacoes.prepareRegistrarFase(db, KEY, {fase: 'REMOTO_CONHECIDO', mpPaymentId: '9999'}),
  ]);
  const final = await db.prepare('SELECT fase, mp_payment_id FROM pedido_operacoes').first();
  assert.equal(final.fase, 'CONCLUIDA');
  assert.equal(final.mp_payment_id, antes.mp_payment_id);
});

/* ──────────────── UNIDADE: CONTRATO DA OPERATION KEY ───────────────── */

test('contrato: fingerprint canônico é estável por conteúdo e versionado', () => {
  const {fingerprint, FINGERPRINT_VERSAO, parseOperationKey} = app.operacoes;
  assert.equal(
    fingerprint({b: 1, a: [2, {d: 4, c: 3}]}),
    fingerprint({a: [2, {c: 3, d: 4}], b: 1}),
    'ordem das chaves não muda a identidade do conteúdo',
  );
  assert.notEqual(
    fingerprint({itens: [[1, 2], [3, 4]]}),
    fingerprint({itens: [[3, 4], [1, 2]]}),
    'ordem de ARRAY é significativa — por isso os writers ordenam os itens antes',
  );
  assert.notEqual(fingerprint({valor: 1}), fingerprint({valor: 2}));
  assert.ok(fingerprint({}).startsWith(`${FINGERPRINT_VERSAO}:`), 'fingerprint é versionado');
  // Campos ausentes e explicitamente `undefined` são o mesmo conteúdo.
  assert.equal(fingerprint({a: 1}), fingerprint({a: 1, b: undefined}));
  // Uma versão diferente nunca é comparada como "payload igual".
  assert.ok(parseOperationKey('11111111-1111-4111-8111-111111111111').ok);
  assert.equal(parseOperationKey('short').ok, false);
  assert.equal(parseOperationKey(42).ok, false);
});

test('contrato: escopo/ator divergente na mesma key é conflito', () => {
  const {conflitoOperacao, fingerprint, FINGERPRINT_VERSAO} = app.operacoes;
  const base = {
    tipo: 'PAGAMENTO_ADMIN', escopo: 'ADMIN', ator_usuario_id: 1,
    fingerprint_versao: FINGERPRINT_VERSAO, fingerprint: fingerprint({x: 1}),
  };
  const esperado = {tipo: 'PAGAMENTO_ADMIN', escopo: 'ADMIN', atorUsuarioId: 1, fingerprint: base.fingerprint};
  assert.equal(conflitoOperacao(base, esperado), null);
  assert.equal(conflitoOperacao({...base, ator_usuario_id: 2}, esperado), 'OPERACAO_CONFLITO_ESCOPO');
  assert.equal(conflitoOperacao({...base, escopo: 'SITE'}, esperado), 'OPERACAO_CONFLITO_ESCOPO');
  assert.equal(conflitoOperacao({...base, tipo: 'PIX_ADMIN'}, esperado), 'OPERACAO_CONFLITO_TIPO');
  assert.equal(conflitoOperacao({...base, fingerprint_versao: 99}, esperado), 'OPERACAO_CONFLITO_PAYLOAD');
  assert.equal(conflitoOperacao({...base, fingerprint: 'outro'}, esperado), 'OPERACAO_CONFLITO_PAYLOAD');
});

test('contrato: classificação do POST MP separa recusa comprovada de resultado ambíguo', async t => {
  const {postPagamentoMp} = app.mpPost;
  const casos = [
    [new Response('rejected', {status: 400}), 'RECUSA_DEFINITIVA'],
    [new Response('unauthorized', {status: 401}), 'RECUSA_DEFINITIVA'],
    [new Response('not found', {status: 404}), 'RECUSA_DEFINITIVA'],
    [new Response('timeout', {status: 408}), 'AMBIGUO'],
    [new Response('slow', {status: 429}), 'AMBIGUO'],
    [new Response('boom', {status: 500}), 'AMBIGUO'],
    [new Response('gateway', {status: 503}), 'AMBIGUO'],
    [Response.json({status: 'pending'}), 'AMBIGUO'],
    [Response.json({id: 7, status: 'pending'}), 'SUCESSO'],
  ];
  for (const [resposta, esperado] of casos) {
    t.mock.method(globalThis, 'fetch', async () => resposta.clone());
    const r = await postPagamentoMp('fake', 'k', {});
    assert.equal(r.resultado, esperado, `HTTP ${resposta.status}`);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal((await postPagamentoMp('fake', 'k', {})).resultado, 'AMBIGUO');
});

/* ──────────────────── REGRESSÕES B1 / B2 / B3 / B4 ──────────────────── */

test('B1 continua bloqueado: A1 não reabriu a edição destrutiva de itens', async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const antes = await state(db);
  const r = await app.adminItems.onRequestPut({
    env: {DB: db}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({itens: [{produtoId: 1, quantidade: 5}], operationKey: KEY}),
    }),
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'EDICAO_ITENS_BLOQUEADA');
  assert.deepEqual(await state(db), antes);
});

test('B2 continua recuperando pagamento verificado; replay A1 não inventa aprovação', async t => {
  const db = await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET status='EXPIRADO' WHERE id=1").run();
  const verificado = await app.sync.fetchMpPayment('fake', '101');
  const r = await app.sync.syncPaymentFromMp(db, 1, verificado);
  assert.equal(r.transicionou, true);
  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.ok(s.itens[0].estoque_baixado_em, 'baixa física acontece uma vez');
  assert.equal(s.produtos[0].estoque, 8);
});

test('B3 continua convergente depois de um replay A1', async t => {
  const {db, session} = await comandaAberta(t);
  await pagar(db, session, {operationKey: KEY, valorCentavos: 10000});
  await pagar(db, session, {operationKey: KEY, valorCentavos: 10000});
  for (let i = 0; i < 5; i++) await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, 'retry idempotente não cria novo fato financeiro');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA');
  assert.equal(s.produtos[0].estoque, 8);
});

test('B4 continua protegendo a reserva por pedido durante operações A1', async t => {
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  mpPost(t);
  await gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY});
  await gerarPix(db, session, {valorCentavos: 4000, operationKey: KEY2});
  const [a] = (await db.prepare('SELECT id FROM pedido_pagamentos ORDER BY id').all()).results;

  // Terminalizar UMA tentativa não libera a reserva do pedido enquanto
  // outro PIX_MP/PENDENTE existir.
  await db.prepare("UPDATE pedido_pagamentos SET status='CANCELADO' WHERE id=?").bind(a.id).run();
  await app.stock.liberarReservaPedido(db, 1);
  const s = await state(db);
  assert.equal(s.pedido.reserva_status, 'ATIVA');
  assert.equal(s.produtos[0].estoque_reservado, 2);
});
