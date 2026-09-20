import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

const cookieDe = session => session.cookie.split(';')[0];

const alterarArquivamento = (db, session, arquivado, extra = {}) =>
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
      body: JSON.stringify({arquivado, ...extra}),
    }),
  });

async function listar(db, session, status) {
  const response = await app.adminCreate.onRequestGet({
    env: {DB: db},
    request: new Request(`https://local.test/api/admin/pedidos?status=${status}&search=Teste`, {
      headers: {Cookie: cookieDe(session)},
    }),
    waitUntil() {},
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function snapshotDominio(db) {
  return {
    pedido: await db.prepare(`SELECT cliente_nome,cliente_whatsapp,valor_total_centavos,
      status_pagamento,status_pedido,status_comanda,reserva_status,estoque_baixado_em
      FROM pedidos WHERE id=1`).first(),
    produtos: (await db.prepare('SELECT * FROM produtos ORDER BY id').all()).results,
    itens: (await db.prepare('SELECT * FROM pedido_itens ORDER BY id').all()).results,
    pagamentos: (await db.prepare('SELECT * FROM pedido_pagamentos ORDER BY id').all()).results,
    alocacoes: (await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results,
    reembolsos: (await db.prepare('SELECT * FROM pedido_reembolsos ORDER BY id').all()).results,
    trocas: (await db.prepare('SELECT * FROM pedido_item_trocas ORDER BY id').all()).results,
    cancelamentos: (await db.prepare('SELECT * FROM pedido_item_cancelamentos ORDER BY id').all()).results,
  };
}

test('ENTREGUE arquiva sem tocar dominio, some da lista principal e pode ser restaurado', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);
  await db.prepare(
    "UPDATE pedidos SET status_pedido='ENTREGUE',status_pagamento='PAGO' WHERE id=1",
  ).run();
  const antes = await snapshotDominio(db);

  const response = await alterarArquivamento(db, session, true);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.arquivado, true);
  assert.ok(body.arquivadoEm);

  const estado = await db.prepare(
    'SELECT arquivado,arquivado_em FROM pedidos WHERE id=1',
  ).first();
  assert.equal(estado.arquivado, 1);
  assert.ok(estado.arquivado_em);
  assert.deepEqual(await snapshotDominio(db), antes);

  const principal = await listar(db, session, 'todos');
  assert.equal(principal.total, 0);
  assert.equal(principal.counts.todos, 0);
  assert.equal(principal.counts.entregues, 0);
  assert.equal(principal.counts.arquivados, 1);

  const arquivo = await listar(db, session, 'arquivados');
  assert.equal(arquivo.total, 1);
  assert.equal(arquivo.pedidos[0].id, 1);
  assert.equal(arquivo.pedidos[0].financeiro.status, 'PAGO');

  const detalhe = await app.adminOrder.onRequestGet({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      headers: {Cookie: cookieDe(session)},
    }),
  });
  assert.equal(detalhe.status, 200);
  assert.equal((await detalhe.json()).pedido.arquivado, 1);

  const replay = await alterarArquivamento(db, session, true);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
  assert.equal(
    (await db.prepare('SELECT arquivado_em FROM pedidos WHERE id=1').first()).arquivado_em,
    estado.arquivado_em,
  );

  const restaurar = await alterarArquivamento(db, session, false);
  assert.equal(restaurar.status, 200);
  assert.deepEqual(await restaurar.json(), {
    ok: true,
    arquivado: false,
    arquivadoEm: null,
  });
  assert.deepEqual(
    await db.prepare('SELECT arquivado,arquivado_em FROM pedidos WHERE id=1').first(),
    {arquivado: 0, arquivado_em: null},
  );
  assert.deepEqual(await snapshotDominio(db), antes);

  const restaurado = await listar(db, session, 'todos');
  assert.equal(restaurado.total, 1);
  assert.equal(restaurado.counts.arquivados, 0);
});

test('CANCELADO pode ser arquivado; estados nao terminais sao recusados', async t => {
  const db = await fixture(t, {ledger: false, reserve: 'LIBERADA'});
  const session = await app.auth.createSession(db, 1);

  for (const status of ['NOVO','PREPARANDO','PRONTO']) {
    await db.prepare('UPDATE pedidos SET status_pedido=? WHERE id=1').bind(status).run();
    const response = await alterarArquivamento(db, session, true);
    assert.equal(response.status, 409, status);
    assert.equal((await response.json()).code, 'PEDIDO_NAO_TERMINAL');
    assert.equal((await db.prepare('SELECT arquivado FROM pedidos WHERE id=1').first()).arquivado, 0);
  }

  await db.prepare("UPDATE pedidos SET status_pedido='CANCELADO' WHERE id=1").run();
  assert.equal((await alterarArquivamento(db, session, true)).status, 200);
  assert.equal((await db.prepare('SELECT arquivado FROM pedidos WHERE id=1').first()).arquivado, 1);

  const alterarStatus = await app.adminOrder.onRequestPatch({
    env: {DB: db},
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({statusPedido: 'NOVO'}),
    }),
  });
  assert.equal(alterarStatus.status, 409);
  assert.equal((await alterarStatus.json()).code, 'PEDIDO_ARQUIVADO');
  assert.equal((await db.prepare('SELECT status_pedido FROM pedidos WHERE id=1').first()).status_pedido,
    'CANCELADO');
});

test('arquivamento exige sessao, mesma origem e payload exclusivo valido', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  const session = await app.auth.createSession(db, 1);
  await db.prepare("UPDATE pedidos SET status_pedido='ENTREGUE' WHERE id=1").run();

  const semSessao = await app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH', headers: {'Content-Type': 'application/json', Origin: 'https://local.test'},
      body: JSON.stringify({arquivado: true}),
    }),
  });
  assert.equal(semSessao.status, 401);

  const outraOrigem = await app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://evil.test'},
      body: JSON.stringify({arquivado: true}),
    }),
  });
  assert.equal(outraOrigem.status, 403);

  for (const payload of [
    {arquivado: 'sim'},
    {arquivado: true, statusPedido: 'ENTREGUE'},
    {},
  ]) {
    const response = await app.adminOrder.onRequestPatch({
      env: {DB: db}, params: {id: '1'},
      request: new Request('https://local.test/api/admin/pedidos/1', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
        body: JSON.stringify(payload),
      }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal((await db.prepare('SELECT arquivado FROM pedidos WHERE id=1').first()).arquivado, 0);
});
