import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state } from './helpers/b3.mjs';

const env = (db) => ({ DB: db, MP_ACCESS_TOKEN: 'fake_mp_token' });

const context = (db, session, body = { devolverEstoque: true, motivo: 'Cancelado pelo cliente' }) => ({
  env: env(db),
  params: { id: '1' },
  waitUntil() {},
  request: new Request('https://local.test/api/admin/pedidos/1/anulacao', {
    method: 'POST',
    headers: {
      Origin: 'https://local.test',
      'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie.split(';')[0] } : {}),
    },
    body: JSON.stringify(body),
  }),
});

const anular = (db, session, devolverEstoque = true) =>
  app.adminVoid.onRequestPost(context(db, session, { devolverEstoque, motivo: 'Cancelado pelo cliente' }));

// A. sem Pix -> anulação normal
test('A. sem Pix -> anulação normal', async (t) => {
  const db = await fixture(t, { ledger: false });
  // Limpa mp_payment_id residual do seed legado para representar pedido puramente sem Pix
  await db.prepare('UPDATE pedidos SET mp_payment_id = NULL WHERE id = 1').run();
  const session = await app.auth.createSession(db, 1);
  const response = await anular(db, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.anulacao.pedido_id, 1);

  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

// B. Pix PENDENTE -> MP cancelled -> local CANCELADO -> anulação funciona
test('B. Pix PENDENTE -> MP cancelled -> local CANCELADO -> anulação funciona', async (t) => {
  const db = await fixture(t); // possui Pix PENDENTE com mp_payment_id '101'
  const session = await app.auth.createSession(db, 1);

  let putCalled = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const urlStr = String(url);
    if (options?.method === 'PUT') {
      putCalled = true;
      assert.equal(JSON.parse(options.body).status, 'cancelled');
      return Response.json({ id: 101, status: 'cancelled' });
    }
    if (urlStr.includes('/v1/payments/101')) {
      return Response.json({
        id: 101,
        status: putCalled ? 'cancelled' : 'pending',
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(putCalled, true);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'CANCELADO');
  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

// C. Pix EXPIRADO local -> MP cancelled -> local converge -> anulação funciona
test('C. Pix EXPIRADO local -> MP cancelled -> local converge -> anulação funciona', async (t) => {
  const db = await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET status = 'EXPIRADO' WHERE id = 1").run();
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/payments/101')) {
      return Response.json({ id: 101, status: 'cancelled', status_detail: 'expired' });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'CANCELADO');
  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

// D. Pix approved durante consulta -> sincroniza PAGO -> anulação recusada
test('D. Pix approved durante consulta -> sincroniza PAGO -> anulação recusada', async (t) => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, 'fetch', async (url) => {
    return Response.json({
      id: 101,
      status: 'approved',
      date_approved: '2026-09-23T16:00:00Z',
    });
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'PIX_JA_PAGO');
  assert.match(body.error, /recebimento Mercado Pago/i);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  const anulacoesCount = await db.prepare('SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1').first('n');
  assert.equal(anulacoesCount, 0);
});

// E. PUT timeout + GET cancelled -> converge -> anulação funciona
test('E. PUT timeout + GET cancelled -> converge -> anulação funciona', async (t) => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  let initialGet = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'PUT') {
      const err = new Error('Gateway Timeout');
      err.name = 'AbortError';
      throw err;
    }
    if (initialGet) {
      initialGet = false;
      return Response.json({ id: 101, status: 'pending' });
    }
    return Response.json({ id: 101, status: 'cancelled' });
  });

  const response = await anular(db, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'CANCELADO');
  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

// F. PUT timeout + GET pending -> fail closed -> pedido não anulado
test('F. PUT timeout + GET pending -> fail closed -> pedido não anulado', async (t) => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'PUT') {
      const err = new Error('Gateway Timeout');
      err.name = 'AbortError';
      throw err;
    }
    return Response.json({ id: 101, status: 'pending' });
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'MERCADO_PAGO_INDISPONIVEL');

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PENDENTE');
  const anulacoesCount = await db.prepare('SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1').first('n');
  assert.equal(anulacoesCount, 0);
});

// G. múltiplos Pix: todos cancelados vs um cancelado e outro inconclusivo
test('G. múltiplos Pix: todos cancelados -> anula', async (t) => {
  const db = await fixture(t);
  await db.prepare(`
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, idempotency_key)
    VALUES(2, 1, 'PIX_MP', 'ADMIN', 5000, 'EXPIRADO', '102', 'pag-extra-2')
  `).run();

  const session = await app.auth.createSession(db, 1);

  let put101 = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const urlStr = String(url);
    if (options?.method === 'PUT') {
      put101 = true;
      return Response.json({ id: 101, status: 'cancelled' });
    }
    if (urlStr.includes('/v1/payments/101')) {
      return Response.json({ id: 101, status: put101 ? 'cancelled' : 'pending' });
    }
    if (urlStr.includes('/v1/payments/102')) {
      return Response.json({ id: 102, status: 'cancelled', status_detail: 'expired' });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 200);

  const s = await state(db);
  assert.equal(s.pagamentos.find(p => p.id === 1).status, 'CANCELADO');
  assert.equal(s.pagamentos.find(p => p.id === 2).status, 'CANCELADO');
  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

test('G. múltiplos Pix: um cancelado e outro inconclusivo -> NÃO anula', async (t) => {
  const db = await fixture(t);
  await db.prepare(`
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, idempotency_key)
    VALUES(2, 1, 'PIX_MP', 'ADMIN', 5000, 'PENDENTE', '102', 'pag-extra-2')
  `).run();

  const session = await app.auth.createSession(db, 1);

  let put101 = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/payments/101')) {
      if (options?.method === 'PUT') {
        put101 = true;
        return Response.json({ id: 101, status: 'cancelled' });
      }
      return Response.json({ id: 101, status: put101 ? 'cancelled' : 'pending' });
    }
    if (urlStr.includes('/v1/payments/102')) {
      if (options?.method === 'PUT') {
        const err = new Error('Connection timeout');
        err.name = 'AbortError';
        throw err;
      }
      return Response.json({ id: 102, status: 'pending' });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'MERCADO_PAGO_INDISPONIVEL');

  const s = await state(db);
  // Progresso parcial preservado: Pix 1 foi cancelado e persiste CANCELADO
  assert.equal(s.pagamentos.find(p => p.id === 1).status, 'CANCELADO');
  // Pix 2 continua protegido como PENDENTE
  assert.equal(s.pagamentos.find(p => p.id === 2).status, 'PENDENTE');
  // Pedido NÃO foi anulado
  const anulacoesCount = await db.prepare('SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1').first('n');
  assert.equal(anulacoesCount, 0);
});

// H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO sem payment local completo
test('H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery encontra payment approved -> NÃO anula', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db.prepare(`
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-approved', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'ENVIO_INCONCLUSIVO', 1, 'mp-key-appr',
           '{"external_reference":"token"}', 1)
  `).run();

  await db.prepare(`
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
    VALUES(1, 1, 'PIX_MP', 'SITE', 10000, 'PENDENTE', 'a1:op-inc-approved:pag')
  `).run();

  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/payments/search')) {
      return Response.json({
        paging: { total: 1, limit: 30, offset: 0 },
        results: [{ id: 999, external_reference: 'token', status: 'approved' }],
      });
    }
    if (urlStr.includes('/v1/payments/999')) {
      return Response.json({
        id: 999,
        status: 'approved',
        date_approved: '2026-09-23T16:00:00Z',
        external_reference: 'token',
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PIX_JA_PAGO');

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO');
  const anulacoesCount = await db.prepare('SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1').first('n');
  assert.equal(anulacoesCount, 0);
});

test('H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery encontra payment pending -> resolve/cancela antes -> anula', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db.prepare(`
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-pending', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'LOCAL_CRIADA', 1, 'mp-key-pend',
           '{"external_reference":"token"}', 1)
  `).run();

  await db.prepare(`
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
    VALUES(1, 1, 'PIX_MP', 'SITE', 10000, 'PENDENTE', 'a1:op-inc-pending:pag')
  `).run();

  const session = await app.auth.createSession(db, 1);

  let putCancelled = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('/payments/search')) {
      return Response.json({
        paging: { total: 1, limit: 30, offset: 0 },
        results: [{ id: 888, external_reference: 'token', status: 'pending' }],
      });
    }
    if (urlStr.includes('/v1/payments/888')) {
      if (options?.method === 'PUT') {
        putCancelled = true;
        return Response.json({ id: 888, status: 'cancelled' });
      }
      return Response.json({
        id: 888,
        status: putCancelled ? 'cancelled' : 'pending',
        external_reference: 'token',
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 200);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'CANCELADO');
  const anulacao = await db.prepare('SELECT * FROM pedido_anulacoes WHERE pedido_id = 1').first();
  assert.ok(anulacao);
});

test('H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery continua inconclusiva -> NÃO anula', async (t) => {
  const db = await fixture(t, { ledger: false });
  await db.prepare(`
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-stuck', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'ENVIO_INCONCLUSIVO', 1, 'mp-key-stuck',
           '{"external_reference":"token"}', 1)
  `).run();

  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/payments/search')) {
      return Response.json({
        paging: { total: 0, limit: 30, offset: 0 },
        results: [],
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'OPERACAO_INCONCLUSIVA');

  const anulacoesCount = await db.prepare('SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1').first('n');
  assert.equal(anulacoesCount, 0);
});

// I. após resolução de todos os Pix: confirmar que a própria trigger existente permite pedido_anulacoes
test('I. após resolução de todos os Pix: trigger existente permite pedido_anulacoes', async (t) => {
  const db = await fixture(t);

  // 1. Se o pagamento estiver PENDENTE ou EXPIRADO, a trigger original DEVE abortar
  await db.prepare("UPDATE pedido_pagamentos SET status = 'EXPIRADO' WHERE id = 1").run();
  await assert.rejects(
    async () => {
      await db.prepare(`
        INSERT INTO pedido_anulacoes (
          pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
          total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
          liquido_original_centavos, estoque_snapshot
        ) VALUES (1, 'Teste direto', 'MANTER', 1, 'Teste', 10000, 0, 0, 0, '[]')
      `).run();
    },
    /ANULACAO_MP_PENDENTE/,
  );

  // 2. Com status CANCELADO (após resolução), a trigger permite a inserção normalmente
  await db.prepare("UPDATE pedido_pagamentos SET status = 'CANCELADO' WHERE id = 1").run();
  await assert.doesNotReject(async () => {
    await db.prepare(`
      INSERT INTO pedido_anulacoes (
        pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
        total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
        liquido_original_centavos, estoque_snapshot
      ) VALUES (1, 'Teste direto', 'MANTER', 1, 'Teste', 10000, 0, 0, 0, '[]')
    `).run();
  });
});

// J. Pix PAGO continua bloqueando anulação direta e exige tratamento financeiro
test('J. Pix PAGO continua bloqueando anulação direta e exige tratamento financeiro', async (t) => {
  const db = await fixture(t, { paid: true }); // status é PAGO
  const session = await app.auth.createSession(db, 1);

  // Bloqueio na API
  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ANULACAO_MP_RECEBIDO');

  // Bloqueio direto na trigger D1 (ANULACAO_MP_RECEBIDO)
  await assert.rejects(
    async () => {
      await db.prepare(`
        INSERT INTO pedido_anulacoes (
          pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
          total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
          liquido_original_centavos, estoque_snapshot
        ) VALUES (1, 'Tentativa bypass', 'MANTER', 1, 'Teste', 10000, 10000, 0, 10000, '[]')
      `).run();
    },
    /ANULACAO_MP_RECEBIDO/,
  );
});
