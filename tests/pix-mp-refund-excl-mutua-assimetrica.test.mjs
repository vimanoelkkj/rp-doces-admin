import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// Migration 0024 — bug real de produção: o trigger de exclusão mútua da
// 0023 bloqueava uma intenção de anulação sempre que existisse QUALQUER
// intenção por item não RECUSADA sobre o mesmo pagamento, inclusive uma já
// CONFIRMADA (histórica, cujo valor já foi descontado). A correção torna a
// exclusão mútua assimétrica: anulação só é bloqueada por intenção por item
// em estado remoto ainda não resolvido (PENDENTE/PROCESSANDO/INCONCLUSIVO);
// intenção por item continua bloqueada por qualquer anulação não RECUSADA,
// inclusive CONFIRMADA (janela real entre dinheiro devolvido e pedido
// anulado).

// Pagamento PIX_MP de 2000 sobre um item de 500: a cancelamento do item
// nunca consome o pagamento inteiro, deixando 1500 de saldo — o mesmo
// desenho do "pedido #50" do bug relatado (refund por item parcial +
// restante ainda reembolsável pela anulação).
async function cenario(t, {payment = 2000, item = 500} = {}) {
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',
      valor_total_centavos=?,status_pagamento='PAGO' WHERE id=1`).bind(item),
    db.prepare(`UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=?,valor_total_centavos=? WHERE id=1`).bind(item, item),
    db.prepare(`UPDATE produtos SET estoque_reservado=1 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key,pago_em) VALUES(1,1,'PIX_MP','ADMIN',?,'PAGO','9001','pix-paid',CURRENT_TIMESTAMP)`).bind(payment),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(1,1,1,?)`).bind(item),
  ]);
  return db;
}

async function criarCancelamentoAguardando(db, {pedidoId = 1, itemId = 1, key} = {}) {
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, pedidoId, itemId);
  const created = await app.itemCancellation.createItemCancellation(db, {
    pedidoId, itemId, usuarioId: 1, motivo: '', estoqueAcao: 'LIBERAR_RESERVA',
    operationKey: key ?? `create-cancel-${Math.random().toString(36).slice(2)}`,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.cancelamento;
}

// `postRefundMp` recusa a resposta como "ilegível" (vira AMBIGUO) se o
// `amount` devolvido nao bater com o que foi pedido -- os mocks precisam
// ecoar o valor do corpo da requisicao, nunca um numero fixo. `mp_refund_id`
// e UNIQUE na tabela, entao cada chamada tambem precisa de um id distinto
// (duas intencoes -- por item e de anulacao -- podem confirmar no mesmo teste).
let proximoRefundId = 1;
function mockAprovado() {
  return async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    return Response.json({id: proximoRefundId++, payment_id: 9001, amount: body.amount, status: 'approved'}, {status: 201});
  };
}
function mockEmProcesso() {
  return async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    return Response.json({id: proximoRefundId++, payment_id: 9001, amount: body.amount, status: 'in_process'}, {status: 201});
  };
}
function mockRecusado() {
  return async () => Response.json({message: 'recusado'}, {status: 400});
}
function mockIndisponivel() {
  return async () => { throw new Error('rede indisponivel'); };
}

// Cria (ou tenta criar) uma intenção POR ITEM no status pedido, retornando
// a intenção resultante quando possível. `PENDENTE` exige derrubar o batch
// entre o INSERT e a chamada remota (mesma técnica já usada nas suítes de
// recuperação B-2/B-3 desta base).
async function intencaoPorItem(t, db, status) {
  const cancelamento = await criarCancelamentoAguardando(db);
  const leg = cancelamento.pernasPendentes[0];
  const params = {
    pedidoId: 1, pagamentoId: leg.pagamentoId, pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    cancellationId: cancelamento.id, usuarioId: 1,
    operationKey: `item-${status}-${Math.random().toString(36).slice(2)}`,
    fingerprint: `fp-item-${status}`, valorCentavos: leg.valorCentavos, accessToken: 'TEST_TOKEN',
  };
  if (status === 'PENDENTE') {
    t.mock.method(globalThis, 'fetch', mockAprovado());
    let travou = false;
    db.hook = async statements => {
      if (!travou && statements.some(s => s.sql.includes("SET status='PROCESSANDO'"))) {
        travou = true;
        throw new Error('crash antes da rede');
      }
      return statements;
    };
    await assert.rejects(app.mpRefundIntent.reconcilePixMpRefundIntent(db, params));
    db.hook = null;
    return {leg, status: 'PENDENTE'};
  }
  t.mock.method(globalThis, 'fetch',
    status === 'CONFIRMADO' ? mockAprovado()
      : status === 'RECUSADO' ? mockRecusado()
        : status === 'PROCESSANDO' ? mockEmProcesso()
          : mockIndisponivel());
  const result = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.intencao.status, status);
  return {leg, status};
}

// Cria (ou tenta criar) uma intenção DE ANULAÇÃO (sem item pai) no status
// pedido, sobre `pagamentoId`.
async function intencaoAnulacao(t, db, status, {pagamentoId = 1, valorCentavos = 100} = {}) {
  const params = {
    pedidoId: 1, pagamentoId, usuarioId: 1,
    operationKey: `anul-${status}-${Math.random().toString(36).slice(2)}`,
    fingerprint: `fp-anul-${status}`, valorCentavos, accessToken: 'TEST_TOKEN',
  };
  if (status === 'PENDENTE') {
    t.mock.method(globalThis, 'fetch', mockAprovado());
    let travou = false;
    db.hook = async statements => {
      if (!travou && statements.some(s => s.sql.includes("SET status='PROCESSANDO'"))) {
        travou = true;
        throw new Error('crash antes da rede');
      }
      return statements;
    };
    await assert.rejects(app.mpRefundIntent.reconcilePixMpRefundIntent(db, params));
    db.hook = null;
    return {status: 'PENDENTE'};
  }
  t.mock.method(globalThis, 'fetch',
    status === 'CONFIRMADO' ? mockAprovado()
      : status === 'RECUSADO' ? mockRecusado()
        : status === 'PROCESSANDO' ? mockEmProcesso()
          : mockIndisponivel());
  const result = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, params);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.intencao.status, status);
  return {status};
}

// 1) intencao por item CONFIRMADA + saldo restante: anulacao PERMITIDA
test('1: intencao por item CONFIRMADA nao bloqueia a anulacao do restante', async t => {
  const db = await cenario(t);
  const {leg} = await intencaoPorItem(t, db, 'CONFIRMADO');
  const restante = await intencaoAnulacao(t, db, 'CONFIRMADO', {
    pagamentoId: leg.pagamentoId, valorCentavos: 1500,
  });
  assert.equal(restante.status, 'CONFIRMADO');
});

// 2) intencao por item RECUSADA: anulacao PERMITIDA
test('2: intencao por item RECUSADA nao bloqueia a anulacao', async t => {
  const db = await cenario(t);
  const {leg} = await intencaoPorItem(t, db, 'RECUSADO');
  const resultado = await intencaoAnulacao(t, db, 'CONFIRMADO', {
    pagamentoId: leg.pagamentoId, valorCentavos: 2000,
  });
  assert.equal(resultado.status, 'CONFIRMADO');
});

// 3/4/5) intencao por item PENDENTE/PROCESSANDO/INCONCLUSIVO: anulacao BLOQUEADA
for (const status of ['PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO']) {
  test(`3/4/5: intencao por item ${status} bloqueia a anulacao`, async t => {
    const db = await cenario(t);
    const {leg} = await intencaoPorItem(t, db, status);
    await assert.rejects(app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
      pedidoId: 1, pagamentoId: leg.pagamentoId, usuarioId: 1,
      operationKey: `anul-blocked-${status}`, fingerprint: `fp-anul-blocked-${status}`,
      valorCentavos: 1500, accessToken: 'TEST_TOKEN',
    }), /pix_mp_refund_intencao_conflito_item_anulacao/);
  });
}

// 6/7) intencao de anulacao CONFIRMADA/PENDENTE/PROCESSANDO/INCONCLUSIVO:
// nova intencao por item continua BLOQUEADA.
// O cancelamento (pedido_item_cancelamentos) precisa nascer ANTES da
// intencao de anulacao: a trava operacional (ponto 4 da 0023) ja impede
// `createItemCancellation` de criar um cancelamento novo enquanto a
// anulacao estiver ativa -- o alvo deste teste e o trigger de exclusao
// mutua sobre a INTENCAO DE REFUND em si, nao essa trava de mais alto nivel.
for (const status of ['CONFIRMADO', 'PENDENTE', 'PROCESSANDO', 'INCONCLUSIVO']) {
  test(`6/7: intencao de anulacao ${status} continua bloqueando intencao por item`, async t => {
    const db = await cenario(t);
    const cancelamento = await criarCancelamentoAguardando(db);
    const leg = cancelamento.pernasPendentes[0];
    await intencaoAnulacao(t, db, status, {pagamentoId: leg.pagamentoId, valorCentavos: 1500});
    await assert.rejects(app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
      pedidoId: 1, pagamentoId: leg.pagamentoId, pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
      cancellationId: cancelamento.id, usuarioId: 1, operationKey: `item-blocked-${status}`,
      fingerprint: `fp-item-blocked-${status}`, valorCentavos: leg.valorCentavos, accessToken: 'TEST_TOKEN',
    }), /pix_mp_refund_intencao_conflito_item_anulacao/);
  });
}

// 8) intencao de anulacao RECUSADA: nova intencao por item e PERMITIDA
test('8: intencao de anulacao RECUSADA nao bloqueia intencao por item', async t => {
  const db = await cenario(t);
  await intencaoAnulacao(t, db, 'RECUSADO');
  const cancelamento = await criarCancelamentoAguardando(db);
  const leg = cancelamento.pernasPendentes[0];
  t.mock.method(globalThis, 'fetch', mockAprovado());
  const result = await app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
    pedidoId: 1, pagamentoId: leg.pagamentoId, pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    cancellationId: cancelamento.id, usuarioId: 1, operationKey: 'item-after-anul-recusado',
    fingerprint: 'fp-item-after-anul-recusado', valorCentavos: leg.valorCentavos, accessToken: 'TEST_TOKEN',
  });
  assert.equal(result.ok, true);
  assert.equal(result.intencao.status, 'CONFIRMADO');
});

// 9) cenario equivalente ao pedido #50: refund por item parcial CONFIRMADO,
// listarPagamentosMpReembolsaveis reporta so o restante, a anulacao estorna
// exatamente esse restante e nao duplica o refund historico.
test('9: pagamento com refund por item confirmado permite anulacao do restante sem duplicar', async t => {
  const db = await cenario(t, {payment: 2000, item: 500});
  const {leg} = await intencaoPorItem(t, db, 'CONFIRMADO');
  assert.equal(leg.valorCentavos, 500);

  const pendentes = await app.orderVoid.listarPagamentosMpReembolsaveis(db, 1);
  assert.deepEqual(pendentes, [{pagamentoId: 1, valorCentavos: 2000, restanteCentavos: 1500}]);

  const anulacao = await intencaoAnulacao(t, db, 'CONFIRMADO', {
    pagamentoId: 1, valorCentavos: pendentes[0].restanteCentavos,
  });
  assert.equal(anulacao.status, 'CONFIRMADO');

  const restanteFinal = await app.orderVoid.listarPagamentosMpReembolsaveis(db, 1);
  assert.deepEqual(restanteFinal, [], 'pagamento integralmente coberto: refund por item + refund de anulacao');

  const refunds = (await state(db)).refunds;
  assert.equal(refunds.length, 2, 'o refund historico por item permanece, mais o novo refund da anulacao');
  assert.equal(refunds.filter(r => r.origem === 'MERCADO_PAGO').length, 2);
  assert.deepEqual(refunds.map(r => r.valor_centavos).sort((a, b) => a - b), [500, 1500]);
  const anulado = refunds.find(r => r.valor_centavos === 1500);
  assert.equal(anulado.motivo, 'Anulação de pedido');
  const porItem = refunds.find(r => r.valor_centavos === 500);
  assert.equal(porItem.motivo, 'Refund parcial Mercado Pago');
});

// 10) 0016..0024 aplicadas em D1/Miniflare real (via b3.mjs, que le e aplica
// todos os arquivos de migrations/ em ordem) preservam a integridade
// referencial contra um cenario populado nas tabelas tocadas pela 0023/0024.
test('10: migrations ate 0024 aplicadas em D1 real preservam foreign_key_check vazio', async t => {
  const db = await cenario(t, {payment: 2000, item: 500});
  await intencaoPorItem(t, db, 'CONFIRMADO');
  const pendentes = await app.orderVoid.listarPagamentosMpReembolsaveis(db, 1);
  await intencaoAnulacao(t, db, 'CONFIRMADO', {pagamentoId: 1, valorCentavos: pendentes[0].restanteCentavos});
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_pix_mp_intencoes`).first()).n, 2);
});
