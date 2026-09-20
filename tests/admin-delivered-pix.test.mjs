import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, barrier} from './helpers/b3.mjs';

const env = db => ({DB: db, MP_ACCESS_TOKEN: 'test'});

async function prepararEntregue(t, {reserve = 'ATIVA'} = {}) {
  const db = await fixture(t, {ledger: false, reserve});
  await db.batch([
    db.prepare(`UPDATE pedidos
      SET origem_pedido='MANUAL', status_comanda='ABERTA', status_pedido='NOVO',
          status_pagamento='PENDENTE', valor_total_centavos=4000
      WHERE id=1`),
    db.prepare(`UPDATE pedido_itens
      SET quantidade=2, valor_unitario_centavos=2000, valor_total_centavos=4000
      WHERE id=1`),
  ]);
  await db.prepare(`UPDATE pedidos SET status_pedido='ENTREGUE' WHERE id=1`).run();
  assert.deepEqual(
    await db.prepare(
      `SELECT status_pedido, status_comanda FROM pedidos WHERE id=1`,
    ).first(),
    {status_pedido: 'ENTREGUE', status_comanda: 'ENCERRADA'},
  );
  return db;
}

function mockPix(t) {
  let id = 800;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push({body: JSON.parse(init.body), headers: init.headers});
    id += 1;
    return Response.json({
      id,
      status: 'pending',
      date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {
        transaction_data: {
          qr_code: `pix-${id}`,
          qr_code_base64: 'cXI=',
        },
      },
    });
  });
  return requests;
}

async function pagarManual(db, valorCentavos, operationKey) {
  return app.ledger.registerAdminPayment(db, {
    pedidoId: 1,
    metodo: 'DINHEIRO',
    valorCentavos,
    usuarioId: 1,
    operationKey,
  });
}

async function criarPix(db, valorCentavos, operationKey) {
  return app.pix.createAdminPixCharge(env(db), {
    pedidoId: 1,
    valorCentavos,
    usuarioId: 1,
    operationKey,
  });
}

test('ENTREGUE sem pagamento permite Pix do saldo integral e retry nao duplica', async t => {
  const db = await prepararEntregue(t);
  const requests = mockPix(t);

  const primeiro = await criarPix(db, 4000, 'delivered-full-pix-01');
  assert.equal(primeiro.ok, true);
  assert.equal(primeiro.valorCentavos, 4000);
  assert.equal(requests[0].body.transaction_amount, 40);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);

  const retry = await criarPix(db, 4000, 'delivered-full-pix-01');
  assert.equal(retry.ok, true);
  assert.equal(retry.replay, true);
  assert.equal(retry.pagamentoId, primeiro.pagamentoId);
  assert.equal(requests.length, 1, 'duplo envio logico reutiliza a mesma operacao remota');
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM pedido_pagamentos
      WHERE pedido_id=1 AND metodo='PIX_MP'`).first()).n,
    1,
  );
  assert.equal(
    (await db.prepare(`SELECT estoque_estado FROM pedido_itens WHERE id=1`).first()).estoque_estado,
    'RESERVADO',
    'criar a cobranca depois da entrega nao altera estoque',
  );
});

test('ENTREGUE parcial permite somente Pix do restante e confirmacao preserva ENTREGUE', async t => {
  const db = await prepararEntregue(t);
  const requests = mockPix(t);
  const manual = await pagarManual(db, 3500, 'delivered-manual-35-01');
  assert.equal(manual.ok, true);
  assert.equal(manual.statusFinanceiro, 'PARCIAL');
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 500);

  const pix = await criarPix(db, 500, 'delivered-balance-pix-01');
  assert.equal(pix.ok, true);
  assert.equal(requests[0].body.transaction_amount, 5);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);

  const excesso = await criarPix(db, 500, 'delivered-extra-pix-01');
  assert.equal(excesso.ok, false);
  assert.equal(excesso.erro, 'CAPACIDADE_INSUFICIENTE');
  assert.equal(requests.length, 1, 'Pix pendente consome toda a capacidade restante');

  await db.prepare(`UPDATE pedido_pagamentos
    SET status='PAGO', pago_em=CURRENT_TIMESTAMP WHERE id=?`).bind(pix.pagamentoId).run();
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const financeiro = await app.ledger.getFinanceiroPedido(db, 1);
  assert.deepEqual(
    {
      status: financeiro.status,
      bruto: financeiro.brutoPagoCentavos,
      liquido: financeiro.liquidoCentavos,
      saldo: financeiro.saldoCentavos,
    },
    {status: 'PAGO', bruto: 4000, liquido: 4000, saldo: 0},
  );
  assert.deepEqual(
    await db.prepare(`SELECT status_pedido, status_comanda FROM pedidos WHERE id=1`).first(),
    {status_pedido: 'ENTREGUE', status_comanda: 'ENCERRADA'},
  );
  assert.equal(
    (await db.prepare(`SELECT estoque_estado FROM pedido_itens WHERE id=1`).first()).estoque_estado,
    'BAIXADO',
  );
});

test('duas abas em ENTREGUE nao podem cobrar duas vezes o mesmo saldo', async t => {
  const db = await prepararEntregue(t);
  await pagarManual(db, 3500, 'delivered-tabs-manual-01');
  const requests = mockPix(t);
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (
      operation === 'batch' &&
      statements.some(statement => statement.sql.includes('INSERT INTO pedido_pagamentos'))
    ) {
      await gate();
    }
    return statements;
  };

  const resultados = await Promise.all([
    criarPix(db, 500, 'delivered-tab-pix-one'),
    criarPix(db, 500, 'delivered-tab-pix-two'),
  ]);
  db.hook = null;
  assert.equal(resultados.filter(resultado => resultado.ok).length, 1);
  assert.equal(requests.length, 1);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM pedido_pagamentos
      WHERE pedido_id=1 AND metodo='PIX_MP'`).first()).n,
    1,
  );
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);
});

test('CANCELADO continua proibido de criar Pix', async t => {
  const db = await prepararEntregue(t);
  await db.prepare(`UPDATE pedidos SET status_pedido='CANCELADO' WHERE id=1`).run();
  const requests = mockPix(t);
  const resultado = await criarPix(db, 4000, 'cancelled-pix-blocked-01');
  assert.equal(resultado.ok, false);
  assert.equal(resultado.erro, 'COMANDA_ENCERRADA');
  assert.equal(requests.length, 0);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM pedido_pagamentos WHERE pedido_id=1`).first()).n,
    0,
  );
});

test('ENTREGUE com refund cobra somente o saldo reaberto pelo liquido', async t => {
  const db = await prepararEntregue(t, {reserve: 'CONVERTIDA'});
  await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(
      id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em
    ) VALUES(1,1,'DINHEIRO','ADMIN',4000,'PAGO','delivered-gross-40',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
      id,pagamento_id,pedido_item_id,valor_centavos
    ) VALUES(1,1,1,4000)`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(
      id,pedido_id,pedido_item_id,status,valor_item_centavos,
      valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro
    ) VALUES(90,1,1,'FALHOU',4000,4000,500,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(
      id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,
      idempotency_key,concluido_em
    ) VALUES(1,1,1,'MANUAL','DINHEIRO',500,'REEMBOLSADO','delivered-refund-5',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
      reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos
    ) VALUES(1,1,90,500)`),
  ]);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 500);
  const requests = mockPix(t);

  const pix = await criarPix(db, 500, 'delivered-refund-balance-pix-01');
  assert.equal(pix.ok, true);
  assert.equal(requests[0].body.transaction_amount, 5);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);
});
