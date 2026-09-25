import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// Migration 0023 + extensao do outbox de refund PIX Mercado Pago para o
// caso "sem item pai": estornar o saldo restante de um PAGAMENTO inteiro
// para permitir a exclusao/anulacao de um pedido que ja recebeu dinheiro
// via Mercado Pago. Cobre os 12 cenarios do pedido original.

const cookieDe = session => session.cookie.split(';')[0];
const KEY = 'estorno-anul-1111-4111-8111-000000000001';

const anular = (db, session, body = {devolverEstoque: false, motivo: ''}) =>
  app.adminVoid.onRequestPost({
    env: {DB: db}, params: {id: '1'}, waitUntil() {},
    request: new Request('https://local.test/api/admin/pedidos/1/anulacao', {
      method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json',
        Cookie: cookieDe(session)}, body: JSON.stringify(body),
    }),
  });

const getEstorno = (db, session) => app.adminVoidEstorno.onRequestGet({
  env: {DB: db, MP_ACCESS_TOKEN: 'TEST_TOKEN'}, params: {id: '1'}, waitUntil() {},
  request: new Request('https://local.test/api/admin/pedidos/1/anulacao/estorno', {
    headers: {Cookie: cookieDe(session)},
  }),
});

const postEstorno = (db, session, body = {operationKey: KEY}, env = {MP_ACCESS_TOKEN: 'TEST_TOKEN'}) =>
  app.adminVoidEstorno.onRequestPost({
    env: {DB: db, ...env}, params: {id: '1'}, waitUntil() {},
    request: new Request('https://local.test/api/admin/pedidos/1/anulacao/estorno', {
      method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json',
        Cookie: cookieDe(session)}, body: JSON.stringify(body),
    }),
  });

async function corpo(response) { return {status: response.status, body: await response.json()}; }

// Pedido #1: PIX_MP PAGO R$100 (10000 centavos), manual/admin, comanda aberta
// — a mesma forma de "pedido #50" do enunciado (payments MP + historico).
async function pedidoComMp(t, overrides = {}) {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',
      status_pedido='NOVO' WHERE id=1`),
  ]);
  if (overrides.refundParcialCentavos) {
    await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,
        valor_centavos,status,mp_refund_id,mp_status,idempotency_key,motivo,devolveu_estoque,concluido_em)
      VALUES(1,1,'MERCADO_PAGO','PIX_MP',?,'REEMBOLSADO','refund-previo','approved','refund-previo-key',
        'Refund parcial Mercado Pago',0,CURRENT_TIMESTAMP)`)
      .bind(overrides.refundParcialCentavos).run();
  }
  const session = await app.auth.createSession(db, 1);
  return {db, session};
}

function mockRefundAprovado(t, {refundId = 9001, amount} = {}) {
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).endsWith('/refunds')) {
      const body = init.body ? JSON.parse(init.body) : {};
      return Response.json({id: refundId, payment_id: 101,
        amount: amount ?? body.amount, status: 'approved'}, {status: 201});
    }
    throw new Error(`chamada MP inesperada: ${url}`);
  });
}

function mockRefundRecusado(t, {status = 400} = {}) {
  return t.mock.method(globalThis, 'fetch', async () =>
    Response.json({message: 'refund recusado'}, {status}));
}

// 1) pedido MP com valor integral ainda reembolsavel
test('1: GET reporta o valor integral ainda reembolsavel quando nenhum refund existe', async t => {
  const {db, session} = await pedidoComMp(t);
  const {status, body} = await corpo(await getEstorno(db, session));
  assert.equal(status, 200);
  assert.equal(body.restanteTotalCentavos, 10000);
  assert.deepEqual(body.pernas, [{pagamentoId: 1, valorCentavos: 10000, restanteCentavos: 10000, intencao: null}]);
});

// 2) pedido com refund parcial anterior
test('2: GET desconta um refund MP parcial ja confirmado', async t => {
  const {db, session} = await pedidoComMp(t, {refundParcialCentavos: 3000});
  const {body} = await corpo(await getEstorno(db, session));
  assert.equal(body.restanteTotalCentavos, 7000);
  assert.equal(body.pernas[0].restanteCentavos, 7000);
});

// 3) valor restante calculado corretamente (espelha o exemplo do enunciado:
// recebido 0,03, refund confirmado 0,01, restante 0,02)
test('3: restante = recebido - refunds MP confirmados, nunca refaz refund ja pago', async t => {
  const {db, session} = await pedidoComMp(t);
  await db.batch([
    db.prepare(`UPDATE pedido_pagamentos SET valor_centavos=3 WHERE id=1`),
    db.prepare(`UPDATE pedido_pagamento_alocacoes SET valor_centavos=3 WHERE id=1`),
    db.prepare(`UPDATE pedidos SET valor_total_centavos=3 WHERE id=1`),
  ]);
  await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,
      status,mp_refund_id,mp_status,idempotency_key,motivo,devolveu_estoque,concluido_em)
    VALUES(1,1,'MERCADO_PAGO','PIX_MP',1,'REEMBOLSADO','r-1','approved','r-1-key','x',0,CURRENT_TIMESTAMP)`).run();
  const pendentes = await app.orderVoid.listarPagamentosMpReembolsaveis(db, 1);
  assert.deepEqual(pendentes, [{pagamentoId: 1, valorCentavos: 3, restanteCentavos: 2}]);
});

// 4) clique duplo nao gera dois refunds
test('4: duas requests POST concorrentes com a mesma operationKey nao duplicam o refund', async t => {
  const {db, session} = await pedidoComMp(t);
  mockRefundAprovado(t);
  const [a, b] = await Promise.all([postEstorno(db, session), postEstorno(db, session)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 200]);
  const refunds = (await state(db)).refunds;
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].valor_centavos, 10000);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n, 1);
});

const reconciliarPedido = (db, session) => app.adminOrderReconciliar.onRequestPost({
  env: {DB: db, MP_ACCESS_TOKEN: 'TEST_TOKEN'}, params: {id: '1'}, waitUntil() {},
  request: new Request('https://local.test/api/admin/pedidos/1/reconciliar', {
    method: 'POST', headers: {Origin: 'https://local.test', Cookie: cookieDe(session)},
  }),
});

const intencaoAnulacao = db => db.prepare(`SELECT status,tentativas,mp_refund_id,atualizado_em
  FROM pedido_reembolso_pix_mp_intencoes`).first();

// 5) reload durante PROCESSANDO recupera estado — agora por POST explícito
test('5: intencao presa em PROCESSANDO: GET so le; POST /reconciliar recupera', async t => {
  const {db, session} = await pedidoComMp(t);
  // Primeira tentativa: o Mercado Pago responde "in_process" (real estado
  // pendente do provedor) -- a intencao fica PROCESSANDO com mp_refund_id
  // ja conhecido, exatamente como um envio que nao terminou de convergir.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({id: 9001, payment_id: 101, amount: 100, status: 'in_process'}, {status: 201}));
  const primeira = await corpo(await postEstorno(db, session));
  assert.equal(primeira.body.pernas[0].intencao.status, 'PROCESSANDO');
  // Sem novo clique do admin, o prazo de recuperacao passa (>60s) e o
  // provedor ja tem o resultado definitivo.
  await db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes
    SET atualizado_em=datetime('now','-2 minutes')`).run();
  // GET: somente leitura, mesmo com a intencao elegivel para recuperacao.
  let rede = 0;
  t.mock.method(globalThis, 'fetch', async () => { rede++; throw new Error('GET nao pode chamar a rede'); });
  const escritas = [];
  db.hook = async statements => {
    for (const s of statements) if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s.sql)) escritas.push(s.sql);
    return statements;
  };
  const antes = await intencaoAnulacao(db);
  const leitura = await corpo(await getEstorno(db, session));
  assert.equal(leitura.status, 200);
  assert.equal(leitura.body.pernas[0].intencao.status, 'PROCESSANDO');
  assert.equal(leitura.body.restanteTotalCentavos, 10000);
  assert.equal(rede, 0, 'GET nao chama o Mercado Pago');
  assert.deepEqual(escritas, [], 'GET nao escreve no D1');
  assert.deepEqual(await intencaoAnulacao(db), antes);
  db.hook = null;

  // POST /reconciliar: o gatilho explicito conclui o refund sem novo clique.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({id: 9001, payment_id: 101, amount: 100, status: 'approved'}, {status: 200}));
  assert.equal((await reconciliarPedido(db, session)).status, 200);
  const {body} = await corpo(await getEstorno(db, session));
  assert.equal(body.restanteTotalCentavos, 0, 'a recuperacao explicita confirmou o refund sem novo clique');
  assert.equal(body.pernas.length, 0);
});

test('5b: GET com intencao INCONCLUSIVO sem refund remoto nunca reenvia o POST de refund', async t => {
  const {db, session} = await pedidoComMp(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('connection lost'); });
  const primeira = await corpo(await postEstorno(db, session));
  assert.equal(primeira.body.pernas[0].intencao.status, 'INCONCLUSIVO');
  const antes = await intencaoAnulacao(db);
  assert.equal(antes.mp_refund_id, null, 'estado em que a recuperacao faria POST de refund');

  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    chamadas.push(`${init?.method ?? 'GET'} ${url}`);
    throw new Error('GET nao pode chamar a rede');
  });
  const r = await corpo(await getEstorno(db, session));
  assert.equal(r.status, 200);
  assert.deepEqual(chamadas, [], 'nenhum POST /refunds a partir do GET');
  assert.deepEqual(await intencaoAnulacao(db), antes);
});

// 6) CONFIRMADO libera exclusao
test('6: apos o refund confirmado, a exclusao do pedido passa a ser aceita', async t => {
  const {db, session} = await pedidoComMp(t);
  mockRefundAprovado(t);
  const {status} = await corpo(await postEstorno(db, session));
  assert.equal(status, 200);
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 200);
});

// 7) RECUSADO mantem exclusao bloqueada
test('7: refund recusado pelo Mercado Pago mantem a exclusao bloqueada', async t => {
  const {db, session} = await pedidoComMp(t);
  mockRefundRecusado(t);
  const posted = await corpo(await postEstorno(db, session));
  assert.equal(posted.body.pernas[0].intencao.status, 'RECUSADO');
  assert.equal(posted.body.restanteTotalCentavos, 10000, 'recusa nunca move dinheiro');
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 409);
  assert.equal(exclusao.body.code, 'ANULACAO_MP_RECEBIDO');
});

// 8) INCONCLUSIVO mantem exclusao bloqueada
test('8: resposta ambigua do Mercado Pago mantem a exclusao bloqueada', async t => {
  const {db, session} = await pedidoComMp(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout de rede'); });
  const posted = await corpo(await postEstorno(db, session));
  assert.equal(posted.body.pernas[0].intencao.status, 'INCONCLUSIVO');
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 409);
  assert.ok(['ANULACAO_MP_RECEBIDO', 'ANULACAO_REFUND_PENDENTE'].includes(exclusao.body.code));
});

// 9) refund ja confirmado nao e repetido
test('9: reenviar a mesma operationKey depois de CONFIRMADO e um replay, sem nova chamada remota', async t => {
  const {db, session} = await pedidoComMp(t);
  const calls = mockRefundAprovado(t);
  await postEstorno(db, session);
  const antes = calls.mock.callCount();
  const replay = await corpo(await postEstorno(db, session));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.restanteTotalCentavos, 0);
  assert.equal(calls.mock.callCount(), antes, 'nenhuma nova chamada ao Mercado Pago');
  assert.equal((await state(db)).refunds.length, 1);
});

// 10) pedido com linhagem A -> B -> C continua correto
test('10: refund de anulacao nao mexe em alocacoes nem linhagem de trocas existentes', async t => {
  const {db, session} = await pedidoComMp(t);
  // Historico de troca (A->B) simulando linhagem previa, preservado a parte.
  await db.batch([
    db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO' WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
        valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(2,1,1,'Destino B',2,5000,10000,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,produto_destino_id,
        quantidade_destino,preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,
        diferenca_centavos,tipo_diferenca,estoque_acao_origem,status,snapshot_financeiro)
      VALUES(1,1,1,2,1,2,5000,10000,10000,0,'ZERO','NAO_REPOR','CONCLUIDA','{}')`),
  ]);
  const alocacoesAntes = (await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results;
  const trocaAntes = await db.prepare('SELECT * FROM pedido_item_trocas WHERE id=1').first();
  mockRefundAprovado(t);
  const {status} = await corpo(await postEstorno(db, session));
  assert.equal(status, 200);
  assert.deepEqual((await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results, alocacoesAntes);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_item_trocas WHERE id=1').first(), trocaAntes);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_reembolso_alocacoes').first()).n, 0,
    'refund de anulacao nunca insere alocacao por item');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_item_troca_reembolso_alocacoes').first()).n, 0);
  const refund = (await state(db)).refunds[0];
  assert.equal(refund.motivo, 'Anulação de pedido');
});

// 11) frontend nao envia valor financeiro confiavel
test('11: o valor enviado pelo cliente no corpo do POST e ignorado; o servidor sempre calcula', async t => {
  const {db, session} = await pedidoComMp(t, {refundParcialCentavos: 3000});
  const calls = mockRefundAprovado(t);
  const {status} = await corpo(await postEstorno(db, session,
    {operationKey: KEY, valorCentavos: 1, restanteTotalCentavos: 999999}));
  assert.equal(status, 200);
  const [, init] = calls.mock.calls[0].arguments;
  assert.deepEqual(JSON.parse(init.body), {amount: 70}, 'estornou o restante real (R$70), nao o valor do corpo');
  const refunds = (await state(db)).refunds;
  assert.equal(refunds.length, 2, 'o refund parcial previo permanece, mais o novo refund da anulacao');
  assert.equal(refunds.find(r => r.idempotency_key !== 'refund-previo-key').valor_centavos, 7000);
});

// 12) nenhuma regressao em cancelamento/troca/refund existente + trava operacional
test('12a: intencao por item CONFIRMADA (historica) nao bloqueia intencao de anulacao (migration 0024)', async t => {
  const {db, session} = await pedidoComMp(t);
  await db.batch([
    db.prepare(`UPDATE pedidos SET valor_total_centavos=5000 WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=5000,valor_total_centavos=5000 WHERE id=1`),
    // Pagamento de 6000 com 5000 alocados ao item cancelado: sobra capacidade
    // real (1000) para a intenção de anulação. Com o pagamento inteiro já
    // reembolsado pelo item, a intenção extra seria recusada pela capacidade
    // (migration 0031), o que não é o que este teste investiga.
    db.prepare(`UPDATE pedido_pagamentos SET valor_centavos=6000 WHERE id=1`),
    db.prepare(`UPDATE pedido_pagamento_alocacoes SET valor_centavos=5000 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
        valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(2,1,1,'Segundo item',1,5000,5000,'ATIVO','BAIXADO')`),
    db.prepare(`UPDATE produtos SET estoque_reservado=0 WHERE id=1`),
  ]);
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const cancelamento = await app.itemCancellation.createItemCancellation(db, {
    pedidoId: 1, itemId: 1, usuarioId: 1, operationKey: 'cancel-item-mutex-01', motivo: '',
    estoqueAcao: 'NAO_REPOR', previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(cancelamento.ok, true);
  const leg = cancelamento.cancelamento.pernasPendentes[0];
  mockRefundAprovado(t);
  const confirmado = await app.itemCancellation.confirmCancellationRefund(db, {
    pedidoId: 1, cancellationId: cancelamento.cancelamento.id, usuarioId: 1,
    operationKey: 'refund-item-mutex-01', pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId, valorCentavos: leg.valorCentavos,
    confirmacao: true, mpAccessToken: 'TEST_TOKEN',
  });
  assert.equal(confirmado.ok, true);
  assert.equal(confirmado.refundStatus, 'CONFIRMADO');
  // Migration 0024: a exclusao mutua e assimetrica. Uma intencao por item
  // CONFIRMADA e historica -- seu valor ja foi descontado por
  // listarPagamentosMpReembolsaveis -- e NAO bloqueia mais uma intencao de
  // anulacao para o restante do mesmo pagamento (bug real de producao
  // corrigido pela 0024; a 0023 sozinha recusava esta chamada).
  mockRefundAprovado(t, {refundId: 9002});
  const anulacao = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
    pedidoId: 1, pagamentoId: leg.pagamentoId, usuarioId: 1, operationKey: 'anul-mutex-01',
    fingerprint: 'fp-anul-mutex-01', valorCentavos: 1, accessToken: 'TEST_TOKEN',
  });
  assert.equal(anulacao.ok, true);
});

test('12b: trava operacional bloqueia pagamento, pix, cancelamento, troca e adicao de item enquanto o refund de anulacao esta ativo', async t => {
  const {db, session} = await pedidoComMp(t);
  mockRefundAprovado(t);
  const {status} = await corpo(await postEstorno(db, session));
  assert.equal(status, 200, 'refund confirmado; pedido ainda nao foi anulado');
  assert.equal(await app.orderVoid.temEstornoAnulacaoAtivo(db, 1), true);

  const post = (url, body, params = {id: '1'}) => ({
    env: {DB: db, MP_ACCESS_TOKEN: 'TEST_TOKEN'}, params, waitUntil() {},
    request: new Request(`https://local.test${url}`, {
      method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json',
        Cookie: cookieDe(session)}, body: JSON.stringify(body)}),
  });

  const pagamento = await app.adminPayment.onRequestPost(
    post('/api/admin/pedidos/1/pagamentos', {metodo: 'DINHEIRO', valorCentavos: 100, operationKey: 'lock-pag-01'}));
  assert.equal(pagamento.status, 409);
  assert.equal((await pagamento.json()).code, 'ESTORNO_ANULACAO_ATIVO');

  const pix = await app.adminPix.onRequestPost(
    post('/api/admin/pedidos/1/pix', {valorCentavos: 100, operationKey: 'lock-pix-01'}));
  assert.equal(pix.status, 409);
  assert.equal((await pix.json()).code, 'ESTORNO_ANULACAO_ATIVO');

  const item = await app.adminItems.onRequestPost(
    post('/api/admin/pedidos/1/itens', {produtoId: 1, quantidade: 1, precoEsperadoCentavos: 5000, operationKey: 'lock-item-01'}));
  assert.equal(item.status, 409);
  assert.equal((await item.json()).code, 'ESTORNO_ANULACAO_ATIVO');

  const cancelamento = await app.adminItemCancellation.onRequestPost(
    post('/api/admin/pedidos/1/itens/1/cancelamentos',
      {motivo: '', estoqueAcao: 'NAO_REPOR', previewFingerprint: 'qualquer', operationKey: 'lock-cancel-01'},
      {id: '1', itemId: '1'}));
  assert.equal(cancelamento.status, 409);
  assert.equal((await cancelamento.json()).code, 'ESTORNO_ANULACAO_ATIVO');

  const troca = await app.adminItemExchange.onRequestPost(
    post('/api/admin/pedidos/1/itens/1/trocas',
      {produtoDestinoId: 1, quantidadeDestino: 1, precoEsperadoCentavos: 5000,
        estoqueAcaoOrigem: 'NAO_REPOR', previewFingerprint: 'qualquer', operationKey: 'lock-troca-01'},
      {id: '1', itemId: '1'}));
  assert.equal(troca.status, 409);
  assert.equal((await troca.json()).code, 'ESTORNO_ANULACAO_ATIVO');

  // A propria exclusao continua permitida: e a unica saida dessa janela.
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 200);
  assert.equal(await app.orderVoid.temEstornoAnulacaoAtivo(db, 1), true, 'a intencao confirmada permanece no historico');
});

test('12c: dois pagamentos PIX_MP no mesmo pedido sao tratados como pernas independentes', async t => {
  const {db, session} = await pedidoComMp(t);
  await db.batch([
    db.prepare(`UPDATE pedidos SET valor_total_centavos=20000 WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET valor_unitario_centavos=10000,valor_total_centavos=20000 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
        mp_payment_id,idempotency_key,pago_em) VALUES(2,1,'PIX_MP','ADMIN',10000,'PAGO','202','pagamento-2',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(pagamento_id,pedido_item_id,valor_centavos) VALUES(2,1,10000)`),
  ]);
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const paymentId = String(url).match(/payments\/(\d+)\/refunds/)?.[1];
    if (paymentId === '101') return Response.json({id: 1, payment_id: 101, amount: 100, status: 'approved'}, {status: 201});
    if (paymentId === '202') throw new Error('falha de rede no segundo pagamento');
    throw new Error(`chamada inesperada ${url}`);
  });
  const {body} = await corpo(await postEstorno(db, session));
  assert.equal(body.restanteTotalCentavos, 10000, 'a perna 101 confirmou; a 202 ficou pendente');
  const pernaConfirmada = body.pernas.find(p => p.pagamentoId === 1);
  assert.equal(pernaConfirmada, undefined, 'pagamento 101 ja nao aparece: totalmente coberto');
  const pernaPendente = body.pernas.find(p => p.pagamentoId === 2);
  assert.equal(pernaPendente.intencao.status, 'INCONCLUSIVO');
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 409, 'uma perna ainda pendente mantem a exclusao bloqueada');
});

/* ───────────── M3: corrida refund manual × estorno de anulação ───────────── */
// Regressão da corrida confirmada: um refund manual PIX_MP e o estorno remoto
// de anulação do MESMO pagamento chegavam a 13000 sobre 10000 pagos. A
// migration 0031 garante a capacidade no banco, em qualquer ordem.

const deferredM3 = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

const reembolsoManual = (db, session, body) => app.adminRefund.onRequestPost({
  env: {DB: db}, params: {id: '1'}, waitUntil() {},
  request: new Request('https://local.test/api/admin/pedidos/1/reembolsos', {
    method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json',
      Cookie: cookieDe(session)}, body: JSON.stringify(body),
  }),
});

test('M3: refund manual e estorno de anulação concorrentes nunca devolvem mais que o pago', async t => {
  // Pedido SITE/NOVO (elegível aos dois caminhos), 1 PIX_MP PAGO de 10000, sem devolução prévia.
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);

  const manualLeuSemIntencao = deferredM3();
  const manualPausado = deferredM3();
  const liberarManual = deferredM3();
  const mpRecebeuPost = deferredM3();
  const liberarMp = deferredM3();

  // Hook determinístico no D1: observa a leitura de "intenção ativa" do
  // refund manual e pausa o manual imediatamente ANTES do batch que insere
  // em pedido_reembolsos.
  db.hook = async (statements, op) => {
    if (statements.some(s => s.sql.includes('FROM pedido_reembolso_pix_mp_intencoes')
        && s.sql.includes("status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO') LIMIT 1"))) {
      manualLeuSemIntencao.resolve();
    }
    if (op === 'batch' && statements.some(s => s.sql.includes('INSERT INTO pedido_reembolsos')
        && s.sql.includes("'MANUAL'"))) {
      manualPausado.resolve();
      await liberarManual.promise;
    }
    return statements;
  };

  // Mercado Pago determinístico: o POST de refund só responde (aprovado,
  // valor integral) quando o teste liberar.
  const postsRefund = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/refunds') && init.method === 'POST') {
      postsRefund.push(JSON.parse(init.body));
      mpRecebeuPost.resolve();
      await liberarMp.promise;
      return Response.json({id: 9301, payment_id: 101, amount: 100, status: 'approved'}, {status: 201});
    }
    throw new Error(`chamada MP inesperada: ${init.method ?? 'GET'} ${url}`);
  });

  // 1-2) manual lê "sem intenção ativa" e para antes do INSERT.
  const manual = reembolsoManual(db, session,
    {pagamentoId: 1, valorCentavos: 3000, motivo: 'devolvido por fora', operationKey: 'm3-manual-0001'});
  await manualLeuSemIntencao.promise;
  await manualPausado.promise;

  // 3) anulação cria a intenção integral e chega ao POST no MP, sem concluir.
  const anulacao = postEstorno(db, session, {operationKey: 'm3-anulacao-0001'});
  await mpRecebeuPost.promise;
  const intencaoEmVoo = await db.prepare(
    `SELECT status,valor_centavos FROM pedido_reembolso_pix_mp_intencoes`).first();

  // 4) manual segue e tenta registrar 3000.
  liberarManual.resolve();
  const rManual = await corpo(await manual);

  // 5) MP aprova o refund integral de 10000.
  liberarMp.resolve();
  const rAnulacao = await corpo(await anulacao);
  db.hook = null;

  const refunds = (await db.prepare(
    `SELECT origem,valor_centavos,status FROM pedido_reembolsos WHERE pagamento_id=1 ORDER BY id`).all()).results;
  const soma = refunds.reduce((s, r) => s + Number(r.valor_centavos), 0);
  const intencoes = (await db.prepare(`SELECT status,valor_centavos FROM pedido_reembolso_pix_mp_intencoes`).all()).results;
  const opsManuais = (await db.prepare(`SELECT COUNT(*) n FROM pedido_operacoes
    WHERE operation_key='m3-manual-0001'`).first()).n;

  const observado = {
    intencaoEmVooQuandoManualInseriu: intencaoEmVoo,
    respostaManual: {status: rManual.status, code: rManual.body.code ?? null},
    respostaAnulacao: rAnulacao.status,
    refunds, soma, intencoes, opsManuais, postsRefundMp: postsRefund.length, corposPost: postsRefund,
  };
  const ctx = JSON.stringify(observado);

  // A intenção de 10000 já estava em voo quando o manual tentou inserir.
  assert.deepEqual(intencaoEmVoo, {status: 'PROCESSANDO', valor_centavos: 10000}, ctx);
  // Manual recusado pelo banco (Guarda 2) como conflito de domínio, não 500.
  assert.equal(rManual.status, 409, ctx);
  assert.equal(rManual.body.code, 'REFUND_PIX_MP_REMOTO_EM_ANDAMENTO', ctx);
  assert.equal(opsManuais, 0, 'o claim do manual foi revertido junto com o INSERT');
  // Só o refund remoto existe, e a soma nunca passa do pago.
  assert.deepEqual(refunds.map(r => [r.origem, Number(r.valor_centavos), r.status]),
    [['MERCADO_PAGO', 10000, 'REEMBOLSADO']], ctx);
  assert.equal(soma, 10000, ctx);
  assert.deepEqual(intencoes.map(i => [i.status, Number(i.valor_centavos)]), [['CONFIRMADO', 10000]], ctx);
  assert.deepEqual(postsRefund, [{amount: 100}], 'exatamente 1 POST ao Mercado Pago');
  assert.equal(rAnulacao.status, 200, ctx);
  assert.equal(rAnulacao.body.restanteTotalCentavos, 0, ctx);
});

test('M3 inversa: intenção calculada antes de um refund manual é recusada pela capacidade', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);

  const anulacaoPausada = deferredM3();
  const liberarAnulacao = deferredM3();

  // Pausa a anulação imediatamente ANTES do batch que cria
  // pedido_operacoes + pedido_reembolso_pix_mp_intencoes (valor já calculado).
  let batchesIntencao = 0;
  db.hook = async (statements, op) => {
    if (op === 'batch' && statements.some(s => s.sql.includes('INSERT INTO pedido_reembolso_pix_mp_intencoes'))) {
      batchesIntencao++;
      if (batchesIntencao === 1) {
        anulacaoPausada.resolve();
        await liberarAnulacao.promise;
      }
    }
    return statements;
  };

  const chamadasMp = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    chamadasMp.push(`${init.method ?? 'GET'} ${url}`);
    if (String(url).endsWith('/refunds') && init.method === 'POST') {
      const {amount} = JSON.parse(init.body);
      return Response.json({id: 9401, payment_id: 101, amount, status: 'approved'}, {status: 201});
    }
    throw new Error(`chamada MP inesperada: ${init.method ?? 'GET'} ${url}`);
  });

  // 1-2) anulação calcula 10000 reembolsáveis e para antes de criar a intenção.
  const anulacao = postEstorno(db, session, {operationKey: 'm3-inversa-anul-01'});
  await anulacaoPausada.promise;

  // 3) refund manual de 3000 conclui (ainda não há intenção).
  const rManual = await corpo(await reembolsoManual(db, session,
    {pagamentoId: 1, valorCentavos: 3000, motivo: 'devolvido por fora', operationKey: 'm3-inversa-manual-01'}));
  assert.equal(rManual.status, 201);

  // 4) a tentativa antiga de 10000 segue e bate na Guarda 1.
  liberarAnulacao.resolve();
  const rAntiga = await corpo(await anulacao);
  db.hook = null;

  assert.notEqual(rAntiga.status, 500, JSON.stringify(rAntiga.body));
  assert.equal(rAntiga.body.restanteTotalCentavos, 7000, 'restante recomputado desconta o manual');
  assert.deepEqual(chamadasMp, [], 'nenhum POST de 10000 ao Mercado Pago');
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n, 0);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_operacoes
    WHERE mp_idempotency_key IS NOT NULL`).first()).n, 0, 'batch revertido: nenhuma pedido_operacoes órfã');
  assert.equal((await db.prepare(`SELECT SUM(valor_centavos) s FROM pedido_reembolsos`).first()).s, 3000);

  // 5) nova tentativa normal: usa o restante real.
  const rNova = await corpo(await postEstorno(db, session, {operationKey: 'm3-inversa-anul-02'}));
  assert.equal(rNova.status, 200);
  assert.equal(rNova.body.restanteTotalCentavos, 0);
  assert.equal(chamadasMp.length, 1);
  assert.match(chamadasMp[0], /^POST .*\/refunds$/);
  const refunds = (await db.prepare(`SELECT origem,valor_centavos FROM pedido_reembolsos ORDER BY id`).all()).results;
  assert.deepEqual(refunds.map(r => [r.origem, Number(r.valor_centavos)]), [['MANUAL', 3000], ['MERCADO_PAGO', 7000]]);
  assert.equal((await db.prepare(`SELECT SUM(valor_centavos) s FROM pedido_reembolsos`).first()).s, 10000);
  const intencoes = (await db.prepare(`SELECT status,valor_centavos FROM pedido_reembolso_pix_mp_intencoes`).all()).results;
  assert.deepEqual(intencoes.map(i => [i.status, Number(i.valor_centavos)]), [['CONFIRMADO', 7000]]);

  // O pagamento está neutralizado (manual + MP): a anulação passa a ser possível.
  const exclusao = await corpo(await anular(db, session));
  assert.equal(exclusao.status, 200, JSON.stringify(exclusao.body));
});
