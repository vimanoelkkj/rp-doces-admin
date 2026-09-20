import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

const cookieDe = session => session.cookie.split(';')[0];

const patchNome = (db, session, clienteNome, extra = {}) =>
  app.adminOrder.onRequestPatch({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieDe(session),
        Origin: 'https://local.test',
      },
      body: JSON.stringify({clienteNome, ...extra}),
    }),
  });

test('edicao do nome aplica trim e nao altera financeiro, status, itens ou WhatsApp', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);
  const antes = {
    pedido: await db.prepare(`SELECT cliente_whatsapp, valor_total_centavos, status_pagamento,
      status_pedido, status_comanda, reserva_status, estoque_baixado_em
      FROM pedidos WHERE id=1`).first(),
    pagamentos: (await db.prepare('SELECT * FROM pedido_pagamentos ORDER BY id').all()).results,
    alocacoes: (await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results,
    itens: (await db.prepare('SELECT * FROM pedido_itens ORDER BY id').all()).results,
  };

  const response = await patchNome(db, session, '  Vitória  ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true, clienteNome: 'Vitória'});
  assert.equal(
    (await db.prepare('SELECT cliente_nome FROM pedidos WHERE id=1').first()).cliente_nome,
    'Vitória',
  );

  const depois = {
    pedido: await db.prepare(`SELECT cliente_whatsapp, valor_total_centavos, status_pagamento,
      status_pedido, status_comanda, reserva_status, estoque_baixado_em
      FROM pedidos WHERE id=1`).first(),
    pagamentos: (await db.prepare('SELECT * FROM pedido_pagamentos ORDER BY id').all()).results,
    alocacoes: (await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results,
    itens: (await db.prepare('SELECT * FROM pedido_itens ORDER BY id').all()).results,
  };
  assert.deepEqual(depois, antes);
});

test('edicao do nome rejeita vazio, tamanho excessivo e payload misto', async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  for (const [clienteNome, extra] of [
    ['   ', {}],
    ['x'.repeat(201), {}],
    ['Outro nome', {statusPedido: 'PRONTO'}],
  ]) {
    const response = await patchNome(db, session, clienteNome, extra);
    assert.equal(response.status, 400);
  }

  const pedido = await db.prepare(
    'SELECT cliente_nome, status_pedido FROM pedidos WHERE id=1',
  ).first();
  assert.equal(pedido.cliente_nome, 'Teste');
  assert.equal(pedido.status_pedido, 'NOVO');
});
