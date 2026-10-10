import { mpResponse } from "./helpers/mp-orders.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state, approvedMp } from "./helpers/b3.mjs";

const env = db => ({ DB: db, MP_ACCESS_TOKEN: "fake_mp_token" });

const context = (
  db,
  session,
  body = { devolverEstoque: true, motivo: "Cancelado pelo cliente" }
) => ({
  env: env(db),
  params: { id: "1" },
  waitUntil() {},
  request: new Request("https://local.test/api/admin/pedidos/1/anulacao", {
    method: "POST",
    headers: {
      Origin: "https://local.test",
      "Content-Type": "application/json",
      ...(session ? { Cookie: session.cookie.split(";")[0] } : {})
    },
    body: JSON.stringify(body)
  })
});

const anular = async (db, session, devolverEstoque = true) => {
  const before = await state(db);
  const calls = globalThis.fetch.mock?.callCount() ?? 0;
  const response = await app.adminVoid.onRequestPost(
    context(db, session, { devolverEstoque, motivo: "Cancelado pelo cliente" })
  );
  if (
    response.status === 409 &&
    (await response.clone().json()).code === "ANULACAO_EXPOSICAO_PIX_REMOTA"
  ) {
    assert.deepEqual(
      await state(db),
      before,
      "contained void must not reconcile, cancel or release stock"
    );
    assert.equal(
      globalThis.fetch.mock?.callCount() ?? 0,
      calls,
      "no remote request before refusal"
    );
  }
  return response;
};

// A. sem Pix -> anulação normal
test("A. sem Pix -> anulação normal", async t => {
  const db = await fixture(t, { ledger: false });
  // Limpa mp_payment_id residual do seed legado para representar pedido puramente sem Pix
  await db.prepare("UPDATE pedidos SET mp_payment_id = NULL WHERE id = 1").run();
  const session = await app.auth.createSession(db, 1);
  const response = await anular(db, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.anulacao.pedido_id, 1);

  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.ok(anulacao);
});

// B. A new void cannot dispatch a remote cancellation.
test("B. pending Pix: void refuses before remote cancellation", async t => {
  const db = await fixture(t); // possui Pix PENDENTE com mp_payment_id '101'
  const session = await app.auth.createSession(db, 1);

  let putCalled = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const urlStr = String(url);
    if (String(url).endsWith("/cancel")) {
      putCalled = true;
      assert.equal(options.body, undefined);
      return mpResponse({ id: 101, status: "cancelled" });
    }
    if (urlStr.includes("/v1/orders/ORD101")) {
      return mpResponse({
        id: 101,
        status: putCalled ? "cancelled" : "pending"
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  assert.equal(putCalled, false);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.equal(anulacao, null);
});

// C. Local expiry does not remove remote exposure.
test("C. expired Pix: void refuses without remote observation", async t => {
  const db = await fixture(t);
  await db.prepare("UPDATE pedido_pagamentos SET status = 'EXPIRADO' WHERE id = 1").run();
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, "fetch", async url => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders/ORD101")) {
      return mpResponse({ id: 101, status: "cancelled", status_detail: "expired" });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "EXPIRADO");
  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.equal(anulacao, null);
});

// D. Discovery belongs to synchronization, not the suspended void path.
test("D. remotely approved Pix: void refuses before synchronization", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, "fetch", async () => {
    return mpResponse(
      approvedMp({
        date_approved: "2026-09-23T16:00:00Z"
      })
    );
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  assert.match(body.error, /suspensa por segurança/i);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacoesCount = await db
    .prepare("SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1")
    .first("n");
  assert.equal(anulacoesCount, 0);
});

// E. PUT timeout + GET cancelled -> converge -> anulação funciona
test("E. PUT timeout + GET cancelled -> converge -> anulação funciona", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  let initialGet = true;
  t.mock.method(globalThis, "fetch", async (url, _options) => {
    if (String(url).endsWith("/cancel")) {
      const err = new Error("Gateway Timeout");
      err.name = "AbortError";
      throw err;
    }
    if (initialGet) {
      initialGet = false;
      return mpResponse({ id: 101, status: "pending" });
    }
    return mpResponse({ id: 101, status: "cancelled" });
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.equal(anulacao, null);
});

// F. PUT timeout + GET pending -> fail closed -> pedido não anulado
test("F. PUT timeout + GET pending -> fail closed -> pedido não anulado", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, "fetch", async (url, _options) => {
    if (String(url).endsWith("/cancel")) {
      const err = new Error("Gateway Timeout");
      err.name = "AbortError";
      throw err;
    }
    return mpResponse({ id: 101, status: "pending" });
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacoesCount = await db
    .prepare("SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1")
    .first("n");
  assert.equal(anulacoesCount, 0);
});

// G. múltiplos Pix: todos cancelados vs um cancelado e outro inconclusivo
test("G. múltiplos Pix: todos cancelados remotamente -> recusa sem GET", async t => {
  const db = await fixture(t);
  await db
    .prepare(
      `
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id, idempotency_key)
    VALUES(2, 1, 'PIX_MP', 'ADMIN', 5000, 'EXPIRADO', 'PAY102','ORD102', 'pag-extra-2')
  `
    )
    .run();

  const session = await app.auth.createSession(db, 1);

  let put101 = false;
  t.mock.method(globalThis, "fetch", async (url, _options) => {
    const urlStr = String(url);
    if (String(url).endsWith("/cancel")) {
      put101 = true;
      return mpResponse({ id: 101, status: "cancelled" });
    }
    if (urlStr.includes("/v1/orders/ORD101")) {
      return mpResponse({ id: 101, status: put101 ? "cancelled" : "pending" });
    }
    if (urlStr.includes("/v1/orders/ORD102")) {
      return mpResponse({ id: 102, status: "cancelled", status_detail: "expired" });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);

  const s = await state(db);
  assert.equal(s.pagamentos.find(p => p.id === 1).status, "PENDENTE");
  assert.equal(s.pagamentos.find(p => p.id === 2).status, "EXPIRADO");
  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.equal(anulacao, null);
});

test("G. múltiplos Pix: um cancelado e outro inconclusivo -> NÃO anula", async t => {
  const db = await fixture(t);
  await db
    .prepare(
      `
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, mp_payment_id, mp_order_id, idempotency_key)
    VALUES(2, 1, 'PIX_MP', 'ADMIN', 5000, 'PENDENTE', 'PAY102','ORD102', 'pag-extra-2')
  `
    )
    .run();

  const session = await app.auth.createSession(db, 1);

  let put101 = false;
  t.mock.method(globalThis, "fetch", async (url, _options) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders/ORD101")) {
      if (String(url).endsWith("/cancel")) {
        put101 = true;
        return mpResponse({ id: 101, status: "cancelled" });
      }
      return mpResponse({ id: 101, status: put101 ? "cancelled" : "pending" });
    }
    if (urlStr.includes("/v1/orders/ORD102")) {
      if (String(url).endsWith("/cancel")) {
        const err = new Error("Connection timeout");
        err.name = "AbortError";
        throw err;
      }
      return mpResponse({ id: 102, status: "pending" });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const s = await state(db);
  // No partial cancellation: both payments retain their initial states.
  assert.equal(s.pagamentos.find(p => p.id === 1).status, "PENDENTE");
  // Pix 2 continua protegido como PENDENTE
  assert.equal(s.pagamentos.find(p => p.id === 2).status, "PENDENTE");
  // Pedido NÃO foi anulado
  const anulacoesCount = await db
    .prepare("SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1")
    .first("n");
  assert.equal(anulacoesCount, 0);
});

// H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO sem payment local completo
test("H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery encontra payment approved -> NÃO anula", async t => {
  const db = await fixture(t, { ledger: false });
  await db
    .prepare(
      `
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-approved', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'ENVIO_INCONCLUSIVO', 1, 'mp-key-appr',
           '{"external_reference":"token"}', 1)
  `
    )
    .run();

  await db
    .prepare(
      `
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
    VALUES(1, 1, 'PIX_MP', 'SITE', 10000, 'PENDENTE', 'a1:op-inc-approved:pag')
  `
    )
    .run();

  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, "fetch", async url => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders?")) {
      return mpResponse({
        paging: { total: 1, limit: 30, offset: 0 },
        results: [{ id: 999, external_reference: "token", status: "approved" }]
      });
    }
    if (urlStr.includes("/v1/orders/ORD999")) {
      return mpResponse(
        approvedMp({
          id: 999,
          date_approved: "2026-09-23T16:00:00Z",
          external_reference: "token"
        })
      );
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacoesCount = await db
    .prepare("SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1")
    .first("n");
  assert.equal(anulacoesCount, 0);
});

test("H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery encontra payment pending -> recusa antes de recovery", async t => {
  const db = await fixture(t, { ledger: false });
  await db
    .prepare(
      `
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-pending', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'LOCAL_CRIADA', 1, 'mp-key-pend',
           '{"external_reference":"token"}', 1)
  `
    )
    .run();

  await db
    .prepare(
      `
    INSERT INTO pedido_pagamentos(id, pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
    VALUES(1, 1, 'PIX_MP', 'SITE', 10000, 'PENDENTE', 'a1:op-inc-pending:pag')
  `
    )
    .run();

  const session = await app.auth.createSession(db, 1);

  let putCancelled = false;
  t.mock.method(globalThis, "fetch", async (url, _options) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders?")) {
      return mpResponse({
        paging: { total: 1, limit: 30, offset: 0 },
        results: [{ id: 888, external_reference: "token", status: "pending" }]
      });
    }
    if (urlStr.includes("/v1/orders/ORD888")) {
      if (String(url).endsWith("/cancel")) {
        putCancelled = true;
        return mpResponse({ id: 888, status: "cancelled" });
      }
      return mpResponse({
        id: 888,
        status: putCancelled ? "cancelled" : "pending",
        external_reference: "token"
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  const anulacao = await db.prepare("SELECT * FROM pedido_anulacoes WHERE pedido_id = 1").first();
  assert.equal(anulacao, null);
});

test("H. operação LOCAL_CRIADA/ENVIO_INCONCLUSIVO: recovery continua inconclusiva -> NÃO anula", async t => {
  const db = await fixture(t, { ledger: false });
  await db
    .prepare(
      `
    INSERT INTO pedido_operacoes(operation_key, tipo, escopo, fingerprint_versao, fingerprint, fase, pedido_id, mp_idempotency_key, mp_request, ator_usuario_id)
    VALUES('op-inc-stuck', 'CHECKOUT_SITE', 'SITE', 1, 'fp', 'ENVIO_INCONCLUSIVO', 1, 'mp-key-stuck',
           '{"external_reference":"token"}', 1)
  `
    )
    .run();

  const session = await app.auth.createSession(db, 1);

  t.mock.method(globalThis, "fetch", async url => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/orders?")) {
      return mpResponse({
        paging: { total: 0, limit: 30, offset: 0 },
        results: []
      });
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  const anulacoesCount = await db
    .prepare("SELECT COUNT(*) as n FROM pedido_anulacoes WHERE pedido_id = 1")
    .first("n");
  assert.equal(anulacoesCount, 0);
});

// I. após resolução de todos os Pix: confirmar que a própria trigger aditiva recusa pedido_anulacoes
test("I. após resolução de todos os Pix: trigger aditiva recusa pedido_anulacoes", async t => {
  const db = await fixture(t);

  // 1. Se o pagamento estiver PENDENTE ou EXPIRADO, a trigger original DEVE abortar
  await db.prepare("UPDATE pedido_pagamentos SET status = 'EXPIRADO' WHERE id = 1").run();
  await assert.rejects(async () => {
    await db
      .prepare(
        `
        INSERT INTO pedido_anulacoes (
          pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
          total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
          liquido_original_centavos, estoque_snapshot
        ) VALUES (1, 'Teste direto', 'MANTER', 1, 'Teste', 10000, 0, 0, 0, '[]')
      `
      )
      .run();
  }, /ANULACAO_EXPOSICAO_PIX_REMOTA/);

  // 2. Com status CANCELADO (após resolução), a trigger permite a inserção normalmente
  await db.prepare("UPDATE pedido_pagamentos SET status = 'CANCELADO' WHERE id = 1").run();
  await assert.rejects(async () => {
    await db
      .prepare(
        `
      INSERT INTO pedido_anulacoes (
        pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
        total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
        liquido_original_centavos, estoque_snapshot
      ) VALUES (1, 'Teste direto', 'MANTER', 1, 'Teste', 10000, 0, 0, 0, '[]')
    `
      )
      .run();
  }, /ANULACAO_EXPOSICAO_PIX_REMOTA/);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM pedido_anulacoes").first("n"), 0);
});

// J. Pix PAGO continua bloqueando anulação direta e exige tratamento financeiro
test("J. Pix PAGO continua bloqueando anulação direta e exige tratamento financeiro", async t => {
  const db = await fixture(t, { paid: true }); // status é PAGO
  const session = await app.auth.createSession(db, 1);

  // Bloqueio na API
  const response = await anular(db, session);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");

  // Direct D1 writes are also refused by the containment trigger.
  await assert.rejects(async () => {
    await db
      .prepare(
        `
        INSERT INTO pedido_anulacoes (
          pedido_id, motivo, estoque_acao, criado_por_usuario_id, usuario_nome,
          total_original_centavos, bruto_original_centavos, reembolsado_original_centavos,
          liquido_original_centavos, estoque_snapshot
        ) VALUES (1, 'Tentativa bypass', 'MANTER', 1, 'Teste', 10000, 10000, 0, 10000, '[]')
      `
      )
      .run();
  }, /ANULACAO_EXPOSICAO_PIX_REMOTA/);
});
