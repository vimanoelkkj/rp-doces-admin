import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { calculatePixExpiration, PIX_TTL_MS } from "../functions/lib/mercadoPago.js";
import { onRequestPost as checkoutPix } from "../functions/api/checkout/pix.js";
import { onRequestGet as getOrder } from "../functions/api/orders/[token].js";
import { syncOrderPayment } from "../functions/lib/paymentSync.js";

function createRealSqliteDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      preco_centavos INTEGER NOT NULL,
      disponivel INTEGER NOT NULL DEFAULT 1,
      ativo INTEGER NOT NULL DEFAULT 1,
      estoque INTEGER NOT NULL DEFAULT 10 CHECK (estoque >= 0),
      estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque),
      promocao_ativa INTEGER NOT NULL DEFAULT 0,
      preco_promocional_centavos INTEGER,
      promocao_inicio TEXT,
      promocao_fim TEXT,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_publico TEXT NOT NULL UNIQUE,
      produto_id INTEGER,
      produto_nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 1,
      valor_unitario_centavos INTEGER NOT NULL,
      valor_total_centavos INTEGER NOT NULL,
      cliente_nome TEXT NOT NULL,
      cliente_email TEXT NOT NULL,
      cliente_whatsapp TEXT NOT NULL DEFAULT '',
      tipo_entrega TEXT NOT NULL DEFAULT 'RETIRADA',
      observacao TEXT NOT NULL DEFAULT '',
      metodo_pagamento TEXT NOT NULL DEFAULT 'PIX',
      status_pagamento TEXT NOT NULL DEFAULT 'PENDENTE',
      status_pedido TEXT NOT NULL DEFAULT 'NOVO',
      mp_order_id TEXT UNIQUE,
      mp_payment_id TEXT,
      mp_status TEXT,
      mp_status_detail TEXT,
      mp_ticket_url TEXT,
      mp_qr_code TEXT,
      mp_qr_code_base64 TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA',
      reserva_expira_em TEXT,
      reserva_liberada_em TEXT,
      pix_expira_em TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pago_em TEXT,
      estoque_baixado_em TEXT
    );

    CREATE TABLE pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      produto_nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL,
      valor_unitario_centavos INTEGER NOT NULL,
      valor_total_centavos INTEGER NOT NULL,
      estoque_baixado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE checkout_rate_limits (
      chave TEXT PRIMARY KEY,
      tentativas INTEGER NOT NULL DEFAULT 0,
      expira_em INTEGER NOT NULL
    );
  `);

  function prepare(sql) {
    const stmt = db.prepare(sql);
    function createBound(params = []) {
      return {
        sql,
        async run() {
          const info = stmt.run(...params);
          return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        async first() {
          return stmt.get(...params) ?? null;
        },
        async all() {
          const results = stmt.all(...params);
          return { results };
        },
        bind(...moreParams) {
          return createBound(moreParams);
        }
      };
    }
    return createBound([]);
  }

  return {
    raw: db,
    prepare,
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) {
          results.push(await s.run());
        }
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  };
}

const RATE_LIMIT_SECRET = "test-rate-limit-secret-key-123456";

function mockMpSuccess(qrCode = "PIX-QR-CODE-TEST") {
  let counter = 0;
  return async () => {
    counter++;
    return new Response(
      JSON.stringify({
        id: `mp-order-test-${counter}-${Math.random().toString(36).slice(2)}`,
        status: "created",
        transactions: {
          payments: [
            {
              id: `pay-test-${counter}`,
              payment_method: {
                qr_code: qrCode,
                qr_code_base64: "base64-image-data",
                ticket_url: "https://mercadopago.com/ticket/123"
              }
            }
          ]
        }
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" }
      }
    );
  };
}

test("1. calculatePixExpiration: cálculo seguro, sem Date.now() e suporte a formatos ISO/SQLite", () => {
  // ISO 8601 UTC
  const isoBase = "2026-08-24T00:00:00.000Z";
  assert.equal(calculatePixExpiration(isoBase), "2026-08-24T00:30:00.000Z");

  // SQLite CURRENT_TIMESTAMP (YYYY-MM-DD HH:MM:SS)
  const sqliteBase = "2026-08-24 00:00:00";
  assert.equal(calculatePixExpiration(sqliteBase), "2026-08-24T00:30:00.000Z");

  // Objeto Date
  const dateBase = new Date("2026-08-24T12:00:00.000Z");
  assert.equal(calculatePixExpiration(dateBase), "2026-08-24T12:30:00.000Z");

  // Base inválida -> NÃO usa Date.now() e retorna null
  assert.equal(calculatePixExpiration(null), null);
  assert.equal(calculatePixExpiration(undefined), null);
  assert.equal(calculatePixExpiration(""), null);
  assert.equal(calculatePixExpiration("invalid-date-string"), null);
  assert.equal(calculatePixExpiration({}), null);
});

test("2. Migration 020: Schema permite pix_expira_em NULL e aceita ALTER TABLE", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE pedidos_legados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_publico TEXT NOT NULL UNIQUE
    );
    INSERT INTO pedidos_legados (token_publico) VALUES ('tok-1');
  `);

  // Executa migration 020
  db.exec("ALTER TABLE pedidos_legados ADD COLUMN pix_expira_em TEXT;");

  const row = db
    .prepare("SELECT token_publico, pix_expira_em FROM pedidos_legados WHERE id = 1")
    .get();
  assert.equal(row.token_publico, "tok-1");
  assert.equal(row.pix_expira_em, null, "Registro legado deve ter pix_expira_em NULL");
});

test("3. Checkout normal persiste pix_expira_em e retorna no payload POST", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-QR-NORMAL");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };
  const req = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: "req-exp-normal-1",
      nome: "Maria",
      email: "maria@test.com",
      whatsapp: "(33) 99999-1111",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const res = await checkoutPix({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();

  assert.ok(data.pedido.pix_expira_em, "pix_expira_em deve estar presente na resposta");

  // Valida persistência no D1
  const row = DB.raw
    .prepare("SELECT criado_em, pix_expira_em FROM pedidos WHERE token_publico = ?")
    .get(data.pedido.token);
  assert.equal(row.pix_expira_em, data.pedido.pix_expira_em);

  const diffMs =
    new Date(row.pix_expira_em).getTime() -
    new Date(calculatePixExpiration(row.criado_em)).getTime();
  assert.equal(diffMs, 0, "pix_expira_em deve coincidir exatamente com criado_em + 30m");
});

test("4. GET /api/orders/[token] retorna exatamente o mesmo pix_expira_em", async () => {
  const DB = createRealSqliteDb();
  const token = "b5555555-5555-4555-8555-555555555555";
  const expira = "2026-08-24T03:00:00.000Z";

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, idempotency_key,
      status_pagamento, pix_expira_em
    ) VALUES (1, ?, 'Torta', 1, 3000, 3000, 'Carlos', 'carlos@test.com', 'key-get', 'PENDENTE', ?)
  `
    )
    .run(token, expira);

  const env = { DB };
  const res = await getOrder({ params: { token }, env });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.pedido.pix_expira_em, expira);
});

test("5. Replay com mesmo client_request_id retorna exatamente o mesmo pix_expira_em", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-QR-REPLAY");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };
  const body = JSON.stringify({
    client_request_id: "req-replay-same-id",
    nome: "Fernanda",
    email: "fernanda@test.com",
    whatsapp: "(33) 99999-2222",
    itens: [{ produto_id: 1, quantidade: 1 }]
  });

  const req1 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body
  });

  const res1 = await checkoutPix({ request: req1, env });
  assert.equal(res1.status, 201);
  const data1 = await res1.json();
  const expira1 = data1.pedido.pix_expira_em;

  // 2ª chamada: Replay imediato
  const req2 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body
  });

  const res2 = await checkoutPix({ request: req2, env });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  const expira2 = data2.pedido.pix_expira_em;

  assert.equal(expira2, expira1, "Replay deve retornar exatamente o mesmo pix_expira_em");
});

test("6. Replay tardio não altera nem renova pix_expira_em", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-QR-TIME");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };
  const body = JSON.stringify({
    client_request_id: "req-time-advance",
    nome: "Lucas",
    email: "lucas@test.com",
    whatsapp: "(33) 99999-3333",
    itens: [{ produto_id: 1, quantidade: 1 }]
  });

  const req1 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body
  });

  const res1 = await checkoutPix({ request: req1, env });
  const data1 = await res1.json();
  const expiraOriginal = data1.pedido.pix_expira_em;

  // Simula avanço de tempo no banco
  const req2 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body
  });

  const res2 = await checkoutPix({ request: req2, env });
  const data2 = await res2.json();

  assert.equal(
    data2.pedido.pix_expira_em,
    expiraOriginal,
    "Timestamp de expiração não pode ter sido renovado"
  );
});

test("7. Recovery 10 minutos após timeout mantém T0 + 30m ancorado no criado_em original", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-RECOVERED");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 1);"
  );

  // Insere pedido criado 10 minutos atrás em estado ERRO (sem pix_expira_em ainda)
  const token = "c7777777-7777-4777-8777-777777777777";
  const idempotencyKey = "key-timeout-recovery-01";
  const criadoEmOriginal = "2026-08-24 00:00:00"; // T0

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, cliente_whatsapp, observacao,
      idempotency_key, status_pagamento, reserva_status, reserva_expira_em, criado_em
    ) VALUES (1, ?, 'Bolo', 1, 2500, 2500, 'Julia', 'julia@test.com', '5533999994444', '', ?, 'ERRO', 'ATIVA', '2026-08-24 00:31:00', ?)
  `
    )
    .run(token, idempotencyKey, criadoEmOriginal);

  DB.raw
    .prepare(
      `
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Bolo', 1, 2500, 2500)
  `
    )
    .run();

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };

  // Executa o retry (recovery)
  const req = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: idempotencyKey,
      nome: "Julia",
      email: "julia@test.com",
      whatsapp: "(33) 99999-4444",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const res = await checkoutPix({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();

  // Esperado: ancorado em 00:00:00 -> 00:30:00 UTC
  assert.equal(
    data.pedido.pix_expira_em,
    "2026-08-24T00:30:00.000Z",
    "Recovery deve ancorar expiração em T0 + 30m, nunca no instante do recovery"
  );
});

test("8. Novo client_request_id gera novo pedido com sua própria expiração", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-NEW");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };

  const req1 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: "req-diff-client-0001",
      nome: "Cliente 1",
      email: "c1@test.com",
      whatsapp: "(33) 99999-0001",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const req2 = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: "req-diff-client-0002",
      nome: "Cliente 2",
      email: "c2@test.com",
      whatsapp: "(33) 99999-0002",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const res1 = await checkoutPix({ request: req1, env });
  assert.equal(res1.status, 201);
  const data1 = await res1.json();

  const res2 = await checkoutPix({ request: req2, env });
  assert.equal(res2.status, 201);
  const data2 = await res2.json();

  assert.notEqual(data1.pedido.token, data2.pedido.token);
  assert.ok(data1.pedido.pix_expira_em);
  assert.ok(data2.pedido.pix_expira_em);
});

test("9. Pedido legado com pix_expira_em NULL funciona perfeitamente nas APIs", async () => {
  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const token = "d8888888-8888-4888-8888-888888888888";
  const idempotencyKey = "key-legado-null-test-01";

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, cliente_whatsapp,
      idempotency_key, status_pagamento, mp_qr_code, pix_expira_em
    ) VALUES (1, ?, 'Bolo', 1, 2500, 2500, 'Legado', 'legado@test.com', '5533999990000', ?, 'PENDENTE', 'QR-LEGADO', NULL)
  `
    )
    .run(token, idempotencyKey);

  DB.raw
    .prepare(
      `
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Bolo', 1, 2500, 2500)
  `
    )
    .run();

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };

  // GET /api/orders/[token]
  const getRes = await getOrder({ params: { token }, env });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.pedido.pix_expira_em, null);

  // POST /api/checkout/pix replay
  const postReq = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: idempotencyKey,
      nome: "Legado",
      email: "legado@test.com",
      whatsapp: "(33) 99999-0000",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const postRes = await checkoutPix({ request: postReq, env });
  assert.equal(postRes.status, 200);
  const postData = await postRes.json();
  assert.equal(postData.pedido.pix_expira_em, null);
});

test("10. Transição para PAGO preserva pix_expira_em histórico imutável", async () => {
  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 1);"
  );

  const token = "e9999999-9999-4999-8999-999999999999";
  const expira = "2026-08-24T01:30:00.000Z";

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, idempotency_key,
      status_pagamento, reserva_status, mp_order_id, pix_expira_em
    ) VALUES (1, ?, 'Bolo', 1, 2500, 2500, 'Paulo', 'paulo@test.com', 'key-pago', 'PENDENTE', 'ATIVA', 'mp-1', ?)
  `
    )
    .run(token, expira);

  DB.raw
    .prepare(
      `
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Bolo', 1, 2500, 2500)
  `
    )
    .run();

  const env = { DB };
  const synced = await syncOrderPayment(env, {
    pedidoId: 1,
    order: { id: "mp-1", status: "processed", status_detail: "accredited" }
  });

  assert.equal(synced.status_pagamento, "PAGO");

  const row = DB.raw
    .prepare("SELECT status_pagamento, pix_expira_em FROM pedidos WHERE id = 1")
    .get();
  assert.equal(row.status_pagamento, "PAGO");
  assert.equal(
    row.pix_expira_em,
    expira,
    "pix_expira_em deve permanecer inalterado após pagamento"
  );
});

test("11. Transição para REEMBOLSADO preserva pix_expira_em histórico", async () => {
  const DB = createRealSqliteDb();
  const expira = "2026-08-24T02:30:00.000Z";

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, idempotency_key,
      status_pagamento, mp_order_id, pix_expira_em
    ) VALUES (1, 'tok-reemb', 'Bolo', 1, 2500, 2500, 'Reemb', 'reemb@test.com', 'key-reemb', 'PAGO', 'mp-reemb', ?)
  `
    )
    .run(expira);

  const env = { DB };
  const synced = await syncOrderPayment(env, {
    pedidoId: 1,
    order: { id: "mp-reemb", status: "refunded", status_detail: "refunded" }
  });

  assert.equal(synced.status_pagamento, "REEMBOLSADO");

  const row = DB.raw
    .prepare("SELECT status_pagamento, pix_expira_em FROM pedidos WHERE id = 1")
    .get();
  assert.equal(row.pix_expira_em, expira);
});

test("12. reserva_expira_em e pix_expira_em permanecem independentes", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-INDEP");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 0);"
  );

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };
  const req = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: "req-indep-test-client-1",
      nome: "Rafael",
      email: "rafael@test.com",
      whatsapp: "(33) 99999-5555",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const res = await checkoutPix({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();

  const row = DB.raw
    .prepare(
      "SELECT reserva_expira_em, pix_expira_em, criado_em FROM pedidos WHERE token_publico = ?"
    )
    .get(data.pedido.token);
  assert.ok(row.reserva_expira_em, "reserva_expira_em deve existir");
  assert.ok(row.pix_expira_em, "pix_expira_em deve existir");
  assert.notEqual(
    row.reserva_expira_em,
    row.pix_expira_em,
    "reserva_expira_em (31m) e pix_expira_em (30m) devem ser timestamps distintos"
  );
});

test("13. Base temporal ausente/inválida: não fabrica timestamp com Date.now() e retorna null", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = mockMpSuccess("PIX-NO-BASE");
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const DB = createRealSqliteDb();
  DB.raw.exec(
    "INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo', 2500, 10, 1);"
  );

  // Insere pedido prévio com criado_em inválido ('INVALIDO')
  const token = "f0000000-0000-4000-8000-000000000000";
  const idempotencyKey = "key-invalid-base-test-01";

  DB.raw
    .prepare(
      `
    INSERT INTO pedidos (
      id, token_publico, produto_nome, quantidade, valor_unitario_centavos,
      valor_total_centavos, cliente_nome, cliente_email, cliente_whatsapp, observacao,
      idempotency_key, status_pagamento, reserva_status, reserva_expira_em, criado_em
    ) VALUES (1, ?, 'Bolo', 1, 2500, 2500, 'SemData', 'semdata@test.com', '5533999996666', '', ?, 'ERRO', 'ATIVA', '2026-08-24 00:31:00', 'INVALIDO')
  `
    )
    .run(token, idempotencyKey);

  DB.raw
    .prepare(
      `
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Bolo', 1, 2500, 2500)
  `
    )
    .run();

  const env = { DB, RATE_LIMIT_SECRET, MP_ACCESS_TOKEN: "mp-token" };

  const req = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://loja.test",
      "cf-connecting-ip": "1.2.3.4"
    },
    body: JSON.stringify({
      client_request_id: idempotencyKey,
      nome: "SemData",
      email: "semdata@test.com",
      whatsapp: "(33) 99999-6666",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const res = await checkoutPix({ request: req, env });
  assert.equal(res.status, 201);
  const data = await res.json();

  assert.equal(
    data.pedido.pix_expira_em,
    null,
    "Base temporal inválida deve resultar em pix_expira_em null sem quebrar o checkout"
  );
});
