import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

const cookieDe = session => session.cookie.split(';')[0];

async function prepararPedidoPronto(t) {
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.prepare(`UPDATE pedidos
    SET origem_pedido='MANUAL', status_comanda='ABERTA', status_pedido='PRONTO',
        status_pagamento='PENDENTE'
    WHERE id=1`).run();
  return {db, session: await app.auth.createSession(db, 1)};
}

const registrar = (db, session, {metodo = 'DINHEIRO', valorCentavos, operationKey}) =>
  app.adminPayment.onRequestPost({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/pagamentos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieDe(session),
        Origin: 'https://local.test',
      },
      body: JSON.stringify({metodo, valorCentavos, operationKey}),
    }),
  });

test('pedido PRONTO com comanda aberta recebe pagamento integral e baixa estoque', async t => {
  const {db, session} = await prepararPedidoPronto(t);
  const response = await registrar(db, session, {
    valorCentavos: 10000,
    operationKey: 'ready-full-payment-01',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true,
    pagamentoId: 1,
    statusFinanceiro: 'PAGO',
    saldoCentavos: 0,
  });

  const pedido = await db.prepare(
    'SELECT status_pedido, status_pagamento FROM pedidos WHERE id=1',
  ).first();
  assert.deepEqual(pedido, {status_pedido: 'PRONTO', status_pagamento: 'PAGO'});
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM pedido_pagamentos
      WHERE pedido_id=1 AND status='PAGO'`).first()).n,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT estoque_estado FROM pedido_itens WHERE id=1').first()).estoque_estado,
    'BAIXADO',
  );
  assert.deepEqual(
    await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first(),
    {estoque: 8, estoque_reservado: 0},
  );
});

test('pagamento parcial seguido do restante converge sem duplicar baixa', async t => {
  const {db, session} = await prepararPedidoPronto(t);
  const parcial = await registrar(db, session, {
    metodo: 'PIX_EXTERNO',
    valorCentavos: 4000,
    operationKey: 'ready-partial-payment-01',
  });
  assert.equal(parcial.status, 201);
  assert.equal((await parcial.json()).statusFinanceiro, 'PARCIAL');
  assert.deepEqual(
    await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first(),
    {estoque: 10, estoque_reservado: 2},
    'pagamento parcial nao baixa estoque',
  );

  const restante = await registrar(db, session, {
    metodo: 'CARTAO',
    valorCentavos: 6000,
    operationKey: 'ready-remaining-payment-01',
  });
  assert.equal(restante.status, 201);
  assert.equal((await restante.json()).statusFinanceiro, 'PAGO');
  assert.equal(
    (await db.prepare(`SELECT SUM(valor_centavos) AS total, COUNT(*) AS n
      FROM pedido_pagamentos WHERE pedido_id=1 AND status='PAGO'`).first()).total,
    10000,
  );
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM pedido_pagamentos
      WHERE pedido_id=1 AND status='PAGO'`).first()).n,
    2,
  );
  assert.deepEqual(
    await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first(),
    {estoque: 8, estoque_reservado: 0},
  );

  const retry = await registrar(db, session, {
    metodo: 'CARTAO',
    valorCentavos: 6000,
    operationKey: 'ready-remaining-payment-01',
  });
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).replay, true);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM pedido_pagamentos WHERE pedido_id=1').first()).n,
    2,
    'retry conserva exatamente dois fatos financeiros',
  );
  assert.deepEqual(
    await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first(),
    {estoque: 8, estoque_reservado: 0},
    'retry nao repete a baixa',
  );
});
