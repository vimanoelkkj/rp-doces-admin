import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state } from './helpers/b3.mjs';

// Auditoria Comanda Viva — correções A1 e M2.
//
// A1: o refund manual genérico (`/admin/pedidos/:id/reembolsos`) nunca grava
// nas tabelas de alocação por item (`pedido_reembolso_alocacoes` /
// `pedido_item_troca_reembolso_alocacoes`). Numa comanda MANUAL ainda ABERTA
// isso travava `COBERTURA_INDETERMINADA` pra sempre em qualquer cancelamento
// ou troca futuro do pedido. A correção recusa o endpoint genérico nesse
// caso específico, preservando-o fora dele.
//
// M2: `reconcileExchangeCharges` (troca AGUARDANDO_COBRANCA -> CONCLUIDA)
// só era chamado pelo GET do detalhe administrativo. A correção reutiliza a
// mesma função a partir de `reconcilePedidoAfterFinancialChange`, o gatilho
// central de qualquer mudança financeira (pagamento admin, refund admin,
// sync de webhook MP, reconciliação de divergentes) — sem duplicar lógica.

const cookieDe = session => session.cookie.split(';')[0];

async function setup(t, {
  itemState = 'RESERVADO',
  paid = 0,
  method = 'DINHEIRO',
  value = 1500,
  origemPedido = 'MANUAL',
  statusComanda = 'ABERTA',
  statusPedido = 'NOVO',
} = {}) {
  const db = await fixture(t, { ledger: false, reserve: 'ATIVA' });
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido=?,status_pedido=?,status_comanda=?,
      valor_total_centavos=?,status_pagamento=? WHERE id=1`)
      .bind(origemPedido, statusPedido, statusComanda, value, paid ? 'PAGO' : 'PENDENTE'),
    db.prepare(`UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=?,
      valor_total_centavos=?,status_item='ATIVO',estoque_estado=?,
      estoque_baixado_em=CASE WHEN ?='BAIXADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
      estoque_reservado_em=CASE WHEN ?='RESERVADO' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=1`)
      .bind(value, value, itemState, itemState, itemState),
    db.prepare(`UPDATE produtos SET nome='A',preco_centavos=?,estoque=10,estoque_reservado=? WHERE id=1`)
      .bind(value, itemState === 'RESERVADO' ? 1 : 0),
  ]);
  if (paid) {
    await db.batch([
      db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
        VALUES(1,1,?,'ADMIN',?,'PAGO','paid-1',CURRENT_TIMESTAMP)`).bind(method, paid),
      db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,?)`).bind(paid),
    ]);
  }
  return { db, session: await app.auth.createSession(db, 1) };
}

async function addB(db, price = 2000, stock = 10) {
  await db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
    VALUES(2,'B','BOLO',?,?,0,1,1)`).bind(price, stock).run();
}

async function cancel(db, { action = 'LIBERAR_RESERVA', key = 'cancel-op-01' } = {}) {
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const result = await app.itemCancellation.createItemCancellation(db, {
    pedidoId: 1, itemId: 1, usuarioId: 1, operationKey: key,
    motivo: 'cliente pediu', estoqueAcao: action, previewFingerprint: preview.previewFingerprint,
  });
  return { preview, result };
}

async function exchange(db, { price = 2000, action = 'LIBERAR_RESERVA', key = 'exchange-op-01' } = {}) {
  const input = { pedidoId: 1, itemId: 1, produtoDestinoId: 2, quantidadeDestino: 1, precoEsperadoCentavos: price, estoqueAcaoOrigem: action };
  const preview = await app.itemExchange.getItemExchangePreview(db, input);
  const result = await app.itemExchange.createItemExchange(db, {
    ...input, usuarioId: 1, operationKey: key, motivo: 'troca', previewFingerprint: preview.previewFingerprint,
  });
  return { preview, result };
}

const estornar = (db, session, body) =>
  app.adminRefund.onRequestPost({
    env: { DB: db }, params: { id: '1' },
    request: new Request('https://local.test/api/admin/pedidos/1/reembolsos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test' },
      body: JSON.stringify(body),
    }),
  });

const abrirDetalhe = (db, session) =>
  app.adminOrder.onRequestGet({
    env: { DB: db }, params: { id: '1' },
    request: new Request('https://local.test/api/admin/pedidos/1', { headers: { Cookie: cookieDe(session) } }),
  });

// ==================================================
// A1 — bloquear refund genérico em comanda viva
// ==================================================

test('A1 (1,2,3): refund genérico é recusado numa comanda MANUAL aberta, sem efeito', async t => {
  const { db, session } = await setup(t, { paid: 1500 });
  const antes = await state(db);

  const response = await estornar(db, session, { pagamentoId: 1, valorCentavos: 500, operationKey: 'refund-a1-01' });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'REFUND_REQUER_FLUXO_COMANDA');
  assert.match(body.error, /cancelamento ou troca do item/i);

  const depois = await state(db);
  assert.equal(depois.refunds.length, 0, 'nenhum pedido_reembolso criado');
  assert.equal(depois.operacoes.length, 0, 'nenhum claim de operação criado');
  assert.deepEqual(depois.pedido, antes.pedido, 'nenhum valor financeiro alterado');
  assert.deepEqual(depois.pagamentos, antes.pagamentos, 'pagamento original intocado');
  assert.deepEqual(depois.alocacoes, antes.alocacoes, 'alocações originais intocadas');
});

test('A1 (4): endpoint específico de refund de cancelamento continua funcionando em comanda MANUAL aberta', async t => {
  const { db } = await setup(t, { paid: 1500 });
  const { result: created } = await cancel(db);
  assert.equal(created.cancelamento.status, 'AGUARDANDO_REEMBOLSO');

  const leg = created.cancelamento.pernasPendentes[0];
  const refunded = await app.itemCancellation.confirmCancellationRefund(db, {
    pedidoId: 1, cancellationId: created.cancelamento.id, usuarioId: 1,
    operationKey: 'a1-cancel-refund-01', pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId, valorCentavos: leg.valorCentavos, confirmacao: true,
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.cancelamento.status, 'CONCLUIDO');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_reembolsos').first()).n, 1);
});

test('A1 (5): endpoint específico de refund de troca continua funcionando em comanda MANUAL aberta', async t => {
  const { db } = await setup(t, { paid: 1500 });
  await addB(db, 1200);
  const { result } = await exchange(db, { price: 1200 });
  assert.equal(result.troca.status, 'AGUARDANDO_REEMBOLSO');

  const leg = result.troca.refundsPendentes[0];
  const refunded = await app.itemExchange.confirmExchangeRefund(db, {
    pedidoId: 1, exchangeId: result.troca.id, usuarioId: 1, operationKey: 'a1-exchange-refund-01',
    pagamentoId: leg.pagamentoId, pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos, confirmacao: true,
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.troca.status, 'CONCLUIDA');
});

test('A1 (6): comportamento anterior preservado fora de MANUAL+ABERTA — pedido SITE', async t => {
  const { db, session } = await setup(t, { paid: 1500, origemPedido: 'SITE' });
  const response = await estornar(db, session, { pagamentoId: 1, valorCentavos: 500, operationKey: 'refund-a1-site-01' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal((await state(db)).refunds.length, 1);
});

test('A1 (6): comportamento anterior preservado fora de MANUAL+ABERTA — comanda ENCERRADA', async t => {
  const { db, session } = await setup(t, { paid: 1500, statusComanda: 'ENCERRADA' });
  const response = await estornar(db, session, { pagamentoId: 1, valorCentavos: 500, operationKey: 'refund-a1-encerrada-01' });
  assert.equal(response.status, 201);
  assert.equal((await state(db)).refunds.length, 1);
});

// ==================================================
// M2 — reconciliar troca após pagamento
// ==================================================

test('M2 (7): troca mais cara fica AGUARDANDO_COBRANCA', async t => {
  const { db } = await setup(t, { paid: 1500 });
  await addB(db, 2000);
  const { result } = await exchange(db);
  assert.equal(result.ok, true);
  assert.equal(result.troca.status, 'AGUARDANDO_COBRANCA');
});

test('M2 (8,9): pagamento da diferença conclui a troca sem abrir o GET do detalhe', async t => {
  const { db } = await setup(t, { paid: 1500 });
  await addB(db, 2000);
  const { result } = await exchange(db);
  assert.equal(result.troca.status, 'AGUARDANDO_COBRANCA');

  const pagamento = await app.ledger.registerAdminPayment(db, {
    pedidoId: 1, metodo: 'DINHEIRO', valorCentavos: 500, usuarioId: 1, operationKey: 'm2-pagamento-01',
  });
  assert.equal(pagamento.ok, true);
  assert.equal(pagamento.statusFinanceiro, 'PAGO');

  const troca = await db.prepare('SELECT status FROM pedido_item_trocas WHERE id=?').bind(result.troca.id).first();
  assert.equal(troca.status, 'CONCLUIDA', 'reconciliação disparada pelo próprio pagamento, não pelo GET');
});

test('M2 (10,11,12): reconciliação repetida é no-op — financeiro e estoque estáveis', async t => {
  const { db } = await setup(t, { paid: 1500 });
  await addB(db, 2000);
  const { result } = await exchange(db);
  await app.ledger.registerAdminPayment(db, {
    pedidoId: 1, metodo: 'DINHEIRO', valorCentavos: 500, usuarioId: 1, operationKey: 'm2-pagamento-02',
  });

  const depois1 = await state(db);
  const concluidoEm1 = (await db.prepare('SELECT concluido_em FROM pedido_item_trocas WHERE id=?')
    .bind(result.troca.id).first()).concluido_em;

  for (let i = 0; i < 5; i++) await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);

  const depois2 = await state(db);
  assert.deepEqual(depois2.pedido, depois1.pedido, 'estado financeiro idêntico após chamadas repetidas');
  assert.deepEqual(depois2.produtos, depois1.produtos, 'estoque não é alterado de novo (nenhuma baixa duplicada)');

  const trocaFinal = await db.prepare('SELECT status,concluido_em FROM pedido_item_trocas WHERE id=?')
    .bind(result.troca.id).first();
  assert.equal(trocaFinal.status, 'CONCLUIDA');
  assert.equal(trocaFinal.concluido_em, concluidoEm1, 'concluido_em não é regravado em chamadas repetidas');
});

test('M2: GET do detalhe do pedido permanece como fallback idempotente', async t => {
  const { db, session } = await setup(t, { paid: 1500 });
  await addB(db, 2000);
  const { result } = await exchange(db);

  // Sem pagamento adicional, o GET sozinho não deve concluir a troca.
  await abrirDetalhe(db, session);
  let troca = await db.prepare('SELECT status FROM pedido_item_trocas WHERE id=?').bind(result.troca.id).first();
  assert.equal(troca.status, 'AGUARDANDO_COBRANCA');

  await app.ledger.registerAdminPayment(db, {
    pedidoId: 1, metodo: 'DINHEIRO', valorCentavos: 500, usuarioId: 1, operationKey: 'm2-fallback-pagamento',
  });
  // O fallback do GET continua funcionando e é idempotente mesmo repetido.
  await abrirDetalhe(db, session);
  await abrirDetalhe(db, session);
  troca = await db.prepare('SELECT status FROM pedido_item_trocas WHERE id=?').bind(result.troca.id).first();
  assert.equal(troca.status, 'CONCLUIDA');
});
