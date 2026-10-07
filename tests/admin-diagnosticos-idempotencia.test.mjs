import { mpResponse } from "./helpers/mp-orders.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";

const cookieDe = session => session.cookie.split(";")[0];

async function bancada(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
       VALUES(2,'Admin','admin','admin@example.invalid','unused','ADMIN')`
    )
    .run();
  const owner = await app.auth.createSession(db, 1);
  return { db, owner };
}

function pixRequest(session, body = { operationKey: "diag-op-test-0000001" }) {
  return new Request("https://local.test/api/admin/diagnosticos/pix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://local.test",
      ...(session ? { Cookie: cookieDe(session) } : {})
    },
    body: JSON.stringify(body)
  });
}

const pixEnv = (db, token = "fake-token") => ({ DB: db, MP_ACCESS_TOKEN: token });

function mockMpSucesso() {
  return async url => {
    assert.equal(url, "https://api.mercadopago.com/v1/orders");
    return mpResponse(
      {
        id: 777,
        status: "pending",
        date_of_expiration: "2099-01-01T00:00:00Z",
        point_of_interaction: {
          transaction_data: {
            qr_code: "000201...copia-e-cola",
            qr_code_base64: "base64img",
            ticket_url: "https://mp.test/ticket"
          }
        }
      },
      { status: 201 }
    );
  };
}

test("mesma operationKey em 2 chamadas -> mesma X-Idempotency-Key e mesmo body, sem date_of_expiration", async t => {
  const { db, owner } = await bancada(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    return mockMpSucesso()(url, init);
  });

  const opKey = "diag-retry-test-00001";
  const res1 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res1.status, 201);

  // Intervalo deliberado entre as tentativas: o body persistido é reenviado idêntico
  await new Promise(r => setTimeout(r, 20));

  const res2 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res2.status, 201);

  assert.equal(chamadas.length, 2, "Mercado Pago recebeu 2 requisições");

  const key1 = chamadas[0].init.headers["X-Idempotency-Key"];
  const key2 = chamadas[1].init.headers["X-Idempotency-Key"];
  assert.equal(key1, key2, "X-Idempotency-Key deve ser rigorosamente a mesma");

  const rawBody1 = chamadas[0].init.body;
  const rawBody2 = chamadas[1].init.body;
  assert.equal(rawBody1, rawBody2, "Body JSON enviado ao MP deve ser idêntico byte a byte");

  const parsed1 = JSON.parse(rawBody1);
  const parsed2 = JSON.parse(rawBody2);
  assert.equal("date_of_expiration" in parsed1.transactions.payments[0], false);
  assert.equal(parsed1.transactions.payments[0].expiration_time, "PT30M");
  assert.equal(parsed1.external_reference, parsed2.external_reference);
  assert.equal(parsed1.total_amount, parsed2.total_amount);
  assert.deepEqual(parsed1.payer, parsed2.payer);
});

test("operationKey diferentes -> chaves e bodies diferentes", async t => {
  const { db, owner } = await bancada(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    return mockMpSucesso()(url, init);
  });

  const res1 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-diff-test-00001" }),
    env: pixEnv(db)
  });
  assert.equal(res1.status, 201);

  const res2 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-diff-test-00002" }),
    env: pixEnv(db)
  });
  assert.equal(res2.status, 201);

  assert.equal(chamadas.length, 2);
  const key1 = chamadas[0].init.headers["X-Idempotency-Key"];
  const key2 = chamadas[1].init.headers["X-Idempotency-Key"];
  assert.notEqual(key1, key2, "Chaves devem ser diferentes para operationKey distintas");

  const parsed1 = JSON.parse(chamadas[0].init.body);
  const parsed2 = JSON.parse(chamadas[1].init.body);
  assert.notEqual(
    parsed1.external_reference,
    parsed2.external_reference,
    "external_reference deve ser diferente para operações distintas"
  );
});

test("timeout na primeira tentativa -> retry reenvia o body original, com a mesma expiration_time", async t => {
  const { db, owner } = await bancada(t);
  const chamadas = [];
  let primeiraTentativa = true;

  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    if (primeiraTentativa) {
      primeiraTentativa = false;
      throw new Error("ETIMEDOUT: network error simulating gateway timeout");
    }
    return mockMpSucesso()(url, init);
  });

  const opKey = "diag-timeout-test-00001";

  // 1ª tentativa falha por timeout
  const res1 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res1.status, 502);
  const bodyErro = await res1.json();
  assert.equal(bodyErro.code, "MERCADO_PAGO_INDISPONIVEL");

  // Pausa antes do retry do operador
  await new Promise(r => setTimeout(r, 20));

  // 2ª tentativa (operador clica em retry com a mesma operationKey)
  const res2 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res2.status, 201);

  assert.equal(chamadas.length, 2);
  const [tentativa1, tentativa2] = chamadas;
  assert.equal(
    tentativa1.init.headers["X-Idempotency-Key"],
    tentativa2.init.headers["X-Idempotency-Key"]
  );
  assert.equal(
    tentativa1.init.body,
    tentativa2.init.body,
    "Retry deve reenviar body idêntico ao da primeira tentativa"
  );

  const parsed1 = JSON.parse(tentativa1.init.body);
  assert.equal("date_of_expiration" in parsed1.transactions.payments[0], false);
  assert.equal(
    parsed1.transactions.payments[0].expiration_time,
    "PT30M",
    "Expiração preservada mesmo após timeout na 1ª tentativa"
  );
});

test("resposta 409 na primeira tentativa -> fluxo trata de forma segura e não tenta burlar criando outra chave/body", async t => {
  const { db, owner } = await bancada(t);
  const chamadas = [];

  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    return mpResponse(
      {
        message: "idempotency conflict",
        cause: [{ code: "409" }]
      },
      {
        status: 409,
        headers: { "x-request-id": "req-mp-conflict-409" }
      }
    );
  });

  const opKey = "diag-conflict-test-00001";

  // 1ª tentativa recebe 409
  const res1 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res1.status, 502);
  const json1 = await res1.json();
  assert.equal(json1.code, "MERCADO_PAGO_INDISPONIVEL");

  // Retry com a mesma operationKey
  const res2 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(res2.status, 502);

  assert.equal(chamadas.length, 2);
  // Garante que o backend não tentou gerar chave ou body diferente para contornar o 409
  assert.equal(
    chamadas[0].init.headers["X-Idempotency-Key"],
    chamadas[1].init.headers["X-Idempotency-Key"]
  );
  assert.equal(chamadas[0].init.body, chamadas[1].init.body);
});

test("invariantes de isolamento: tentativas e retries nunca tocam tabelas de domínio nem estoque", async t => {
  const { db, owner } = await bancada(t);
  t.mock.method(globalThis, "fetch", mockMpSucesso());

  const antes = await state(db);

  // Executa múltiplas chamadas e retries com a mesma e diferentes operationKeys
  await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-invar-00001" }),
    env: pixEnv(db)
  });
  await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-invar-00001" }),
    env: pixEnv(db)
  });
  await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-invar-00002" }),
    env: pixEnv(db)
  });

  const depois = await state(db);
  assert.deepEqual(
    depois,
    antes,
    "pedidos, itens, pagamentos, estoque e operacoes de dominio continuam 100% intocados"
  );

  // Verifica que a tabela de diagnósticos registrou apenas o isolamento de idempotência
  const rows = await db
    .prepare("SELECT operation_key, expires_at FROM admin_diagnostico_pix ORDER BY operation_key")
    .all();
  assert.equal(rows.results.length, 2);
  assert.equal(rows.results[0].operation_key, "diag-invar-00001");
  assert.equal(rows.results[1].operation_key, "diag-invar-00002");
});

test("MP_TEST_MODE=orders_pix gera contrato oficial do simulador (50.00, APRO, sem expiração) e retry da mesma operationKey preserva body idêntico", async t => {
  const { db, owner } = await bancada(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    return mockMpSucesso()(url, init);
  });

  const envOrdersPix = { DB: db, MP_ACCESS_TOKEN: "fake-token", MP_TEST_MODE: "orders_pix" };
  const opKey = "diag-orders-pix-sim-001";

  // 1ª tentativa
  const res1 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: envOrdersPix
  });
  assert.equal(res1.status, 201);

  // Intervalo para certificar que Date.now() não altera nada
  await new Promise(r => setTimeout(r, 20));

  // 2ª tentativa (retry)
  const res2 = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: envOrdersPix
  });
  assert.equal(res2.status, 201);

  assert.equal(chamadas.length, 2);
  const [c1, c2] = chamadas;

  // 1. orders_pix usa exatamente 50.00
  const body1 = JSON.parse(c1.init.body);
  const body2 = JSON.parse(c2.init.body);
  assert.equal(body1.total_amount, "50.00");
  assert.equal(body1.transactions.payments[0].amount, "50.00");
  assert.equal(body2.total_amount, "50.00");
  assert.equal(body2.transactions.payments[0].amount, "50.00");

  // 2. orders_pix usa APRO / test_user_br@testuser.com
  assert.deepEqual(body1.payer, {
    email: "test_user_br@testuser.com",
    first_name: "APRO"
  });

  // 3. orders_pix não contém campos de expiração
  assert.equal("expiration_time" in body1.transactions.payments[0], false);
  assert.equal("date_of_expiration" in body1.transactions.payments[0], false);

  // 4. retry da mesma operationKey continua produzindo body idêntico
  assert.equal(c1.init.headers["X-Idempotency-Key"], c2.init.headers["X-Idempotency-Key"]);
  assert.equal(c1.init.body, c2.init.body);
});

test("modo normal (sem orders_pix) continua usando valores e campos de expiração normais", async t => {
  const { db, owner } = await bancada(t);
  let enviado;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    enviado = JSON.parse(init.body);
    return mockMpSucesso()(url, init);
  });

  const res = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: "diag-normal-mode-001" }),
    env: pixEnv(db) // MP_TEST_MODE ausente (normal)
  });
  assert.equal(res.status, 201);

  assert.equal(enviado.total_amount, "0.01");
  assert.equal(enviado.transactions.payments[0].amount, "0.01");
  assert.equal(enviado.transactions.payments[0].expiration_time, "PT30M");
  assert.equal("date_of_expiration" in enviado.transactions.payments[0], false);
  assert.deepEqual(enviado.payer, {
    email: "diagnostico@rpdoces.com.br",
    first_name: "Diagnostico"
  });
});

test("diagnóstico legado persistido antes da mudança: o retry reenvia o mp_request byte a byte, com a mesma key e sem nova intenção", async t => {
  t.mock.method(console, "error", () => {});
  const { db, owner } = await bancada(t);
  const opKey = "diag-legado-pre-mudanca-0001";
  // Snapshot gravado pelo código ANTERIOR: ainda carrega date_of_expiration junto de
  // expiration_time. Valores diferentes dos que o builder novo geraria, para que
  // reconstruir o body seja detectável.
  const legado = JSON.stringify({
    type: "online",
    total_amount: "0.01",
    external_reference: "ADMIN_DIAG_PIX_legado-pre-mudanca",
    processing_mode: "automatic",
    transactions: {
      payments: [
        {
          amount: "0.01",
          payment_method: { id: "pix", type: "bank_transfer" },
          expiration_time: "PT30M",
          date_of_expiration: "2026-01-01T00:30:00.000Z"
        }
      ]
    },
    payer: { email: "diagnostico@rpdoces.com.br", first_name: "DiagLegado" }
  });
  await db
    .prepare(
      "INSERT INTO admin_diagnostico_pix (operation_key, expires_at, mp_request) VALUES (?, ?, ?)"
    )
    .bind(opKey, "2026-01-01T00:30:00.000Z", legado)
    .run();
  const antes = await state(db);
  const snapshotAntes = (await db.prepare("SELECT * FROM admin_diagnostico_pix").all()).results;

  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url, init });
    // 1ª tentativa indisponível (ambígua); o retry do operador tem sucesso.
    return chamadas.length === 1
      ? new Response("indisponivel", { status: 503 })
      : mockMpSucesso()(url, init);
  });

  const primeira = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(primeira.status, 502);
  assert.equal((await primeira.json()).code, "MERCADO_PAGO_INDISPONIVEL");
  const retry = await app.diagnosticoPix.onRequestPost({
    request: pixRequest(owner, { operationKey: opKey }),
    env: pixEnv(db)
  });
  assert.equal(retry.status, 201);

  assert.equal(chamadas.length, 2);
  for (const { init } of chamadas) {
    assert.equal(init.body, legado, "body enviado byte-identical ao mp_request persistido");
    assert.equal(init.headers["X-Idempotency-Key"], `diag-pix:${opKey}`);
  }
  const enviado = JSON.parse(chamadas[1].init.body).transactions.payments[0];
  assert.equal(
    enviado.date_of_expiration,
    "2026-01-01T00:30:00.000Z",
    "snapshot legado preservado"
  );
  assert.equal(enviado.expiration_time, "PT30M");
  assert.equal(
    JSON.parse(chamadas[1].init.body).payer.first_name,
    "DiagLegado",
    "não reconstruído"
  );

  // Dado histórico intacto: o snapshot não é atualizado e nenhuma intenção/operação nasce.
  const diagnosticos = (await db.prepare("SELECT * FROM admin_diagnostico_pix").all()).results;
  assert.deepEqual(diagnosticos, snapshotAntes, "linha histórica intacta (inclusive criado_em)");
  assert.equal(diagnosticos.length, 1);
  assert.equal(diagnosticos[0].mp_request, legado);
  assert.deepEqual(
    await state(db),
    antes,
    "o diagnóstico não escreve em vendas, estoque nem operações"
  );
});
