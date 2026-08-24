import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestPost } from "../functions/api/checkout/pix.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

const cliente = { nome: "Maria Silva", email: "maria@example.com", whatsapp: "(33) 99999-9999" };
const RATE_LIMIT_SECRET = "segredo-de-teste-para-rate-limit-checkout";

function produto(id, o = {}) {
  return {
    id,
    nome: `Produto ${id}`,
    preco_centavos: 1000,
    disponivel: 1,
    ativo: 1,
    estoque: 10,
    promocao_ativa: 0,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null,
    ...o,
  };
}

function db(produtos) {
  let rateLimitAttempts = 0;
  return fakeDb(
    sql => {
      if (sql.includes("checkout_rate_limits")) {
        rateLimitAttempts++;
        return { first: () => ({ tentativas: rateLimitAttempts }) };
      }
      if (sql.includes("FROM produtos WHERE id IN")) {
        return { all: s => ({ results: produtos.filter(p => s.args.includes(p.id)) }) };
      }
      return { run: () => ({ success: true, meta: { changes: 1 } }) };
    },
    async ss => ss.map((_, i) => ({ success: true, meta: i === 0 ? { last_row_id: 91, changes: 1 } : { changes: 1 } }))
  );
}

function req(body, headers = {}) {
  return new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://loja.test", ...headers },
    body: JSON.stringify(body),
  });
}

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
      quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
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
      reserva_status TEXT NOT NULL DEFAULT 'SEM_RESERVA' CHECK (reserva_status IN ('SEM_RESERVA', 'ATIVA', 'CONVERTIDA', 'LIBERADA')),
      reserva_expira_em TEXT,
      reserva_liberada_em TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pago_em TEXT,
      estoque_baixado_em TEXT
    );

    CREATE TABLE pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      produto_id INTEGER,
      produto_nome TEXT NOT NULL,
      quantidade INTEGER NOT NULL CHECK (quantidade >= 1 AND quantidade <= 50),
      valor_unitario_centavos INTEGER NOT NULL,
      valor_total_centavos INTEGER NOT NULL,
      estoque_baixado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE checkout_rate_limits (
      chave TEXT PRIMARY KEY,
      tentativas INTEGER NOT NULL DEFAULT 1,
      expira_em INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkout_rate_limits_expira
    ON checkout_rate_limits(expira_em);

    CREATE TABLE push_inscricoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL
    );

    CREATE TABLE push_eventos (
      pedido_id INTEGER PRIMARY KEY,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  function wrapStatement(stmt, originalSql, bindArgs = []) {
    return {
      bind(...args) {
        return wrapStatement(stmt, originalSql, args);
      },
      first() {
        const rows = stmt.all(...bindArgs);
        return rows[0] || null;
      },
      all() {
        const rows = stmt.all(...bindArgs);
        return { results: rows };
      },
      run() {
        const info = stmt.run(...bindArgs);
        return {
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
          },
        };
      },
    };
  }

  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      return wrapStatement(stmt, sql);
    },
    async batch(statements) {
      db.exec("BEGIN TRANSACTION;");
      try {
        const results = statements.map((statement) => statement.run());
        db.exec("COMMIT;");
        return results;
      } catch (err) {
        db.exec("ROLLBACK;");
        throw err;
      }
    },
  };
}

test("multi-item usa preços do backend, promoção e um Pix", async t => {
  const old = fetch;
  let calls = 0, sent;
  globalThis.fetch = async (_u, i) => {
    calls++;
    sent = JSON.parse(i.body);
    return new Response(JSON.stringify({
      id: "order-91",
      status: "created",
      transactions: { payments: [{ id: "pay-1", payment_method: { qr_code: "PIX" } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = old);

  const env = {
    DB: db([
      produto(1),
      produto(2, {
        preco_centavos: 2000,
        promocao_ativa: 1,
        preco_promocional_centavos: 1500,
        promocao_inicio: new Date(Date.now() - 60000).toISOString()
      })
    ]),
    MP_ACCESS_TOKEN: "teste",
    RATE_LIMIT_SECRET
  };

  const r = await onRequestPost({
    request: req({
      ...cliente,
      total_centavos: 1,
      itens: [
        { produto_id: 1, quantidade: 2, preco_centavos: 1 },
        { produto_id: 2, quantidade: 1, preco_centavos: 1 }
      ]
    }),
    env
  });

  const body = await responseJson(r);
  assert.equal(r.status, 201);
  assert.equal(body.pedido.valor_total_centavos, 3500);
  assert.equal(body.pedido.itens[1].valor_unitario_centavos, 1500);
  assert.equal(sent.total_amount, "35.00");
  assert.equal(sent.transactions.payments.length, 1);
  assert.equal(calls, 1);
});

test("contrato legado de um item continua aceito", async t => {
  const old = fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "order-92",
    status: "created",
    transactions: { payments: [{}] }
  }), { status: 200 });
  t.after(() => globalThis.fetch = old);

  const r = await onRequestPost({
    request: req({ ...cliente, produto_id: 1, quantidade: 1 }),
    env: { DB: db([produto(1)]), MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });
  const b = await responseJson(r);
  assert.equal(r.status, 201);
  assert.equal(b.pedido.itens.length, 1);
  assert.equal(b.pedido.quantidade_total, 1);
});

test("itens repetidos respeitam limite total", async () => {
  const r = await onRequestPost({
    request: req({ ...cliente, itens: [{ produto_id: 1, quantidade: 30 }, { produto_id: 1, quantidade: 21 }] }),
    env: { DB: db([produto(1)]), MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });
  assert.equal(r.status, 400);
});

test("estoque insuficiente impede criação do Pix", async t => {
  const old = fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error(); };
  t.after(() => globalThis.fetch = old);

  const r = await onRequestPost({
    request: req({ ...cliente, itens: [{ produto_id: 1, quantidade: 2 }] }),
    env: { DB: db([produto(1, { estoque: 1 })]), MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });
  assert.equal(r.status, 409);
  assert.equal(calls, 0);
});

test("Caso 1: request com client_request_id cria pedido e envia X-Idempotency-Key estável ao MP", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const oldFetch = globalThis.fetch;
  let mpHeaders = null;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    mpHeaders = init.headers;
    return new Response(JSON.stringify({
      id: "mp-order-1",
      status: "created",
      transactions: { payments: [{ id: "pay-1", payment_method: { qr_code: "PIX-CODE-1", ticket_url: "https://mp.test/1" } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const clientId = "c1111111-1111-4111-8111-111111111111";
  const r = await onRequestPost({
    request: req({
      client_request_id: clientId,
      ...cliente,
      itens: [{ produto_id: 1, quantidade: 2 }]
    }),
    env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });

  assert.equal(r.status, 201);
  const body = await responseJson(r);
  assert.equal(body.pedido.valor_total_centavos, 3000);
  assert.equal(body.pix.qr_code, "PIX-CODE-1");
  assert.equal(calls, 1);
  assert.equal(mpHeaders["X-Idempotency-Key"] || mpHeaders["x-idempotency-key"], clientId);

  const pedidoNoBanco = DB.raw.prepare("SELECT idempotency_key, mp_order_id, mp_qr_code FROM pedidos WHERE id = 1").get();
  assert.equal(pedidoNoBanco.idempotency_key, clientId);
  assert.equal(pedidoNoBanco.mp_order_id, "mp-order-1");
  assert.equal(pedidoNoBanco.mp_qr_code, "PIX-CODE-1");
});

test("Caso 2: retry sequencial com mesmo client_request_id retorna mesmo pedido/Pix sem chamar MP novamente", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      id: "mp-order-2",
      status: "created",
      transactions: { payments: [{ id: "pay-2", payment_method: { qr_code: "PIX-CODE-2" } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const clientId = "c2222222-2222-4222-8222-222222222222";
  const requestBody = {
    client_request_id: clientId,
    ...cliente,
    itens: [{ produto_id: 1, quantidade: 2 }]
  };

  // Primeira chamada
  const r1 = await onRequestPost({ request: req(requestBody), env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET } });
  const b1 = await responseJson(r1);
  assert.equal(r1.status, 201);
  assert.equal(calls, 1);

  // Segunda chamada (retry)
  const r2 = await onRequestPost({ request: req(requestBody), env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET } });
  const b2 = await responseJson(r2);
  assert.equal(r2.status, 200);
  assert.equal(calls, 1); // NÃO chamou o MP novamente

  assert.equal(b2.pedido.token, b1.pedido.token);
  assert.equal(b2.pedido.referencia, b1.pedido.referencia);
  assert.equal(b2.pix.qr_code, b1.pix.qr_code);

  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(count.total, 1);
});

test("Caso 3: concorrência real com mesmo client_request_id cria exatamente 1 registro no banco e converge para o mesmo Pix", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const oldFetch = globalThis.fetch;
  let calls = 0;
  const sentIdempotencyKeys = [];
  globalThis.fetch = async (_url, init) => {
    calls++;
    sentIdempotencyKeys.push(init.headers["X-Idempotency-Key"] || init.headers["x-idempotency-key"]);
    // Simula latência de rede realista de gateway
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response(JSON.stringify({
      id: "mp-order-3",
      status: "created",
      transactions: { payments: [{ id: "pay-3", payment_method: { qr_code: "PIX-CODE-CONCURRENT" } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const clientId = "c3333333-3333-4333-8333-333333333333";
  const requestBody = {
    client_request_id: clientId,
    ...cliente,
    itens: [{ produto_id: 1, quantidade: 1 }]
  };

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };
  const [res1, res2] = await Promise.all([
    onRequestPost({ request: req(requestBody), env }),
    onRequestPost({ request: req(requestBody), env })
  ]);

  const b1 = await responseJson(res1);
  const b2 = await responseJson(res2);

  assert.ok(res1.status === 200 || res1.status === 201);
  assert.ok(res2.status === 200 || res2.status === 201);
  assert.equal(b1.pedido.token, b2.pedido.token);
  assert.equal(b1.pix.qr_code, "PIX-CODE-CONCURRENT");
  assert.equal(b2.pix.qr_code, "PIX-CODE-CONCURRENT");

  // Todas as requisições que porventura chamaram o MP enviaram obrigatoriamente a MESMA X-Idempotency-Key
  assert.ok(calls >= 1);
  for (const key of sentIdempotencyKeys) {
    assert.equal(key, clientId);
  }

  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos WHERE idempotency_key = ?").get(clientId);
  assert.equal(count.total, 1);
});

test("Caso 4: mesmo client_request_id com payload divergente retorna 409 Conflict", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10), (2, 'Bolo', 2500, 10)").run();

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "mp-order-4",
    status: "created",
    transactions: { payments: [{ id: "pay-4", payment_method: { qr_code: "PIX-4" } }] }
  }), { status: 200 });
  t.after(() => globalThis.fetch = oldFetch);

  const clientId = "c4444444-4444-4444-8444-444444444444";
  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };

  // Request 1: Produto 1
  const r1 = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, observacao: "Sem calda", itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });
  assert.equal(r1.status, 201);

  // Request 2: Mesmo ID mas Produto 2
  const r2 = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, observacao: "Sem calda", itens: [{ produto_id: 2, quantidade: 1 }] }),
    env
  });
  assert.equal(r2.status, 409);
  const b2 = await responseJson(r2);
  assert.match(b2.erro, /pedido diferente/i);

  // Request 3: Mesmo ID mas email diferente
  const r3 = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, email: "outro@example.com", observacao: "Sem calda", itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });
  assert.equal(r3.status, 409);

  // Request 4: Mesmo ID mas whatsapp diferente
  const r4 = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, whatsapp: "33988887777", observacao: "Sem calda", itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });
  assert.equal(r4.status, 409);

  // Request 5: Mesmo ID mas observação diferente
  const r5 = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, observacao: "Com calda extra", itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });
  assert.equal(r5.status, 409);
});

test("Caso 5: pedido local existente sem Pix (falha anterior) é recuperado no retry com a mesma X-Idempotency-Key", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const clientId = "c5555555-5555-4555-8555-555555555555";
  // Simula pedido inserido previamente no banco mas que falhou antes de salvar o Pix (status_pagamento = ERRO, mp_qr_code = NULL)
  DB.raw.prepare(`
    INSERT INTO pedidos (token_publico, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos,
      cliente_nome, cliente_email, cliente_whatsapp, observacao, tipo_entrega, status_pagamento, idempotency_key)
    VALUES ('token-5', 1, 'Pudim', 1, 1500, 1500, 'Maria Silva', 'maria@example.com', '5533999999999', '', 'RETIRADA', 'ERRO', ?)
  `).run(clientId);
  DB.raw.prepare(`
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Pudim', 1, 1500, 1500)
  `).run();

  const oldFetch = globalThis.fetch;
  let sentHeader = null;
  let calls = 0;
  globalThis.fetch = async (_u, init) => {
    calls++;
    sentHeader = init.headers["X-Idempotency-Key"] || init.headers["x-idempotency-key"];
    return new Response(JSON.stringify({
      id: "mp-order-recovered",
      status: "created",
      transactions: { payments: [{ id: "pay-recovered", payment_method: { qr_code: "PIX-RECOVERED" } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const r = await onRequestPost({
    request: req({ client_request_id: clientId, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });

  assert.equal(r.status, 201);
  assert.equal(calls, 1);
  assert.equal(sentHeader, clientId); // Reutilizou a mesma X-Idempotency-Key

  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(count.total, 1); // NÃO criou um segundo pedido

  const atualizado = DB.raw.prepare("SELECT mp_order_id, mp_qr_code, status_pagamento FROM pedidos WHERE id = 1").get();
  assert.equal(atualizado.mp_order_id, "mp-order-recovered");
  assert.equal(atualizado.mp_qr_code, "PIX-RECOVERED");
  assert.equal(atualizado.status_pagamento, "PENDENTE");
});

test("Caso 6: nova tentativa deliberada com novo client_request_id cria novo pedido", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const oldFetch = globalThis.fetch;
  let orderSeq = 0;
  globalThis.fetch = async () => {
    orderSeq++;
    return new Response(JSON.stringify({
      id: `mp-order-${orderSeq}`,
      status: "created",
      transactions: { payments: [{ id: `pay-${orderSeq}`, payment_method: { qr_code: `PIX-${orderSeq}` } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };
  const r1 = await onRequestPost({
    request: req({ client_request_id: "c6666666-6666-4666-8666-111111111111", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });
  const r2 = await onRequestPost({
    request: req({ client_request_id: "c6666666-6666-4666-8666-222222222222", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env
  });

  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(count.total, 2);
});

test("Caso 7: client_request_id inválido é rejeitado com 400 Bad Request", async () => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const r = await onRequestPost({
    request: req({ client_request_id: "invalido!", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });
  assert.equal(r.status, 400);
  const body = await responseJson(r);
  assert.match(body.erro, /client_request_id inválido/i);
});

test("Caso 8: nova compra idêntica com novo client_request_id após Pix anterior expirado", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  // Simula pedido 1 que atingiu EXPIRADO
  DB.raw.prepare(`
    INSERT INTO pedidos (token_publico, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos,
      cliente_nome, cliente_email, cliente_whatsapp, tipo_entrega, status_pagamento, mp_status, mp_qr_code, idempotency_key)
    VALUES ('token-exp', 1, 'Pudim', 1, 1500, 1500, 'Maria Silva', 'maria@example.com', '5533999999999', 'RETIRADA', 'EXPIRADO', 'expired', 'OLD-QR', 'c8888888-8888-4888-8888-111111111111')
  `).run();
  DB.raw.prepare(`
    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 'Pudim', 1, 1500, 1500)
  `).run();

  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "mp-order-new",
    status: "created",
    transactions: { payments: [{ id: "pay-new", payment_method: { qr_code: "NEW-PIX-QR" } }] }
  }), { status: 200 });
  t.after(() => globalThis.fetch = oldFetch);

  // Cliente tenta pagar novamente o mesmo carrinho com novo client_request_id
  const r = await onRequestPost({
    request: req({ client_request_id: "c8888888-8888-4888-8888-222222222222", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env: { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET }
  });

  assert.equal(r.status, 201);
  const body = await responseJson(r);
  assert.equal(body.pix.qr_code, "NEW-PIX-QR");

  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(count.total, 2); // 1 expirado + 1 novo
});

// ==========================================
// Testes Dedicados da Etapa 4 (Rate Limiting)
// ==========================================

test("Rate Limit: tentativas 1 a 6 são permitidas, 7ª retorna 429 Too Many Requests com Retry-After", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 100)").run();

  const oldFetch = globalThis.fetch;
  let orderCount = 0;
  globalThis.fetch = async () => {
    orderCount++;
    return new Response(JSON.stringify({
      id: `mp-order-${orderCount}`,
      status: "created",
      transactions: { payments: [{ id: `pay-${orderCount}`, payment_method: { qr_code: `PIX-${orderCount}` } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };
  const headers = { "CF-Connecting-IP": "192.168.1.50" };

  // Tentativas 1 a 6: permitidas
  for (let i = 1; i <= 6; i++) {
    const r = await onRequestPost({
      request: req({ client_request_id: `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
      env
    });
    assert.equal(r.status, 201, `Tentativa ${i} deveria ser 201`);
  }
  assert.equal(orderCount, 6);

  // 7ª tentativa: bloqueada
  const r7 = await onRequestPost({
    request: req({ client_request_id: "a0000000-0000-4000-8000-000000000007", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
    env
  });
  assert.equal(r7.status, 429, "7ª tentativa deve retornar 429");
  assert.equal(orderCount, 6, "Mercado Pago não deve ser chamado na 7ª tentativa");
  assert.ok(r7.headers.get("Retry-After"), "Deve incluir Retry-After");
  const b7 = await responseJson(r7);
  assert.match(b7.erro, /muitas tentativas/i);
  assert.ok(b7.retry_after >= 1 && b7.retry_after <= 60);

  // Valida que exatamente 6 pedidos foram criados na tabela pedidos
  const totalPedidos = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(totalPedidos.total, 6);
});

test("Rate Limit: replay de Pix já existente NÃO consome cota de criação e funciona mesmo no limite", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 100)").run();

  const oldFetch = globalThis.fetch;
  let orderCount = 0;
  globalThis.fetch = async () => {
    orderCount++;
    return new Response(JSON.stringify({
      id: `mp-order-${orderCount}`,
      status: "created",
      transactions: { payments: [{ id: `pay-${orderCount}`, payment_method: { qr_code: `PIX-${orderCount}` } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };
  const headers = { "CF-Connecting-IP": "192.168.1.60" };
  const firstClientId = "b0000000-0000-4000-8000-000000000001";

  // Cria 6 pedidos até esgotar o limite do IP
  for (let i = 1; i <= 6; i++) {
    const cid = i === 1 ? firstClientId : `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const r = await onRequestPost({
      request: req({ client_request_id: cid, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
      env
    });
    assert.equal(r.status, 201);
  }

  // Nova criação (7ª tentativa) é bloqueada com 429
  const rBlocked = await onRequestPost({
    request: req({ client_request_id: "b0000000-0000-4000-8000-000000000099", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
    env
  });
  assert.equal(rBlocked.status, 429);

  // Mas o REPLAY do primeiro pedido (com Pix completo) funciona perfeitamente com 200 OK!
  const rReplay = await onRequestPost({
    request: req({ client_request_id: firstClientId, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
    env
  });
  assert.equal(rReplay.status, 200, "Replay deve retornar 200 mesmo com IP no limite");
  const bReplay = await responseJson(rReplay);
  assert.equal(bReplay.pix.qr_code, "PIX-1");
});

test("Rate Limit: IPs diferentes possuem cotas independentes", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 100)").run();

  const oldFetch = globalThis.fetch;
  let orderSeq = 0;
  globalThis.fetch = async () => {
    orderSeq++;
    return new Response(JSON.stringify({
      id: `mp-order-ip-${orderSeq}`,
      status: "created",
      transactions: { payments: [{ id: `pay-ip-${orderSeq}`, payment_method: { qr_code: `PIX-IP-${orderSeq}` } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };

  // Esgota IP 1
  for (let i = 1; i <= 6; i++) {
    const r = await onRequestPost({
      request: req({ client_request_id: `ip1-0000-4000-8000-${String(i).padStart(12, "0")}`, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, { "CF-Connecting-IP": "10.0.0.1" }),
      env
    });
    assert.equal(r.status, 201);
  }
  const rIp1Blocked = await onRequestPost({
    request: req({ client_request_id: "ip1-0000-4000-8000-000000000007", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, { "CF-Connecting-IP": "10.0.0.1" }),
    env
  });
  assert.equal(rIp1Blocked.status, 429);

  // IP 2 faz pedido e tem sucesso (201)
  const rIp2 = await onRequestPost({
    request: req({ client_request_id: "ip2-0000-4000-8000-000000000001", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, { "CF-Connecting-IP": "10.0.0.2" }),
    env
  });
  assert.equal(rIp2.status, 201);
});

test("Rate Limit: ausência de RATE_LIMIT_SECRET retorna erro seguro 503", async () => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 10)").run();

  const envSemSecret = { DB, MP_ACCESS_TOKEN: "teste" }; // RATE_LIMIT_SECRET ausente
  const r = await onRequestPost({
    request: req({ client_request_id: "c7777777-7777-4777-8777-777777777777", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }),
    env: envSemSecret
  });
  assert.equal(r.status, 503);
  const b = await responseJson(r);
  assert.match(b.erro, /indisponível/i);
});

test("Rate Limit: CONCORRÊNCIA REAL NO LIMITE (estado = 5, duas requests simultâneas -> exatamente 1 ganha e 1 recebe 429)", async t => {
  const DB = createRealSqliteDb();
  DB.raw.prepare("INSERT INTO produtos (id, nome, preco_centavos, estoque) VALUES (1, 'Pudim', 1500, 100)").run();

  const oldFetch = globalThis.fetch;
  let mpOrderCalls = 0;
  globalThis.fetch = async () => {
    mpOrderCalls++;
    await new Promise(r => setTimeout(r, 15));
    return new Response(JSON.stringify({
      id: `mp-order-${mpOrderCalls}`,
      status: "created",
      transactions: { payments: [{ id: `pay-${mpOrderCalls}`, payment_method: { qr_code: `PIX-${mpOrderCalls}` } }] }
    }), { status: 200 });
  };
  t.after(() => globalThis.fetch = oldFetch);

  const env = { DB, MP_ACCESS_TOKEN: "teste", RATE_LIMIT_SECRET };
  const headers = { "CF-Connecting-IP": "172.16.0.99" };

  // 1. Preenche exatamente 5 tentativas no rate limit
  for (let i = 1; i <= 5; i++) {
    const r = await onRequestPost({
      request: req({ client_request_id: `concur-0000-4000-8000-${String(i).padStart(12, "0")}`, ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
      env
    });
    assert.equal(r.status, 201);
  }
  assert.equal(mpOrderCalls, 5);

  // 2. Dispara 2 requests concorrentes com client_request_id diferentes no mesmo milissegundo para a 6ª vaga
  const reqA = onRequestPost({
    request: req({ client_request_id: "concur-0000-4000-8000-00000000006A", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
    env
  });
  const reqB = onRequestPost({
    request: req({ client_request_id: "concur-0000-4000-8000-00000000006B", ...cliente, itens: [{ produto_id: 1, quantidade: 1 }] }, headers),
    env
  });

  const [resA, resB] = await Promise.all([reqA, reqB]);
  const statuses = [resA.status, resB.status].sort();

  // EXATAMENTE UMA deve ser 201 (ganhou a 6ª vaga) e EXATAMENTE UMA deve ser 429 (excedeu para 7)
  assert.deepEqual(statuses, [201, 429], "Concorrência no limite deve permitir exatamente uma (201) e bloquear a outra (429)");

  // Valida que o Mercado Pago foi chamado exatamente 6 vezes (5 anteriores + 1 vencedora)
  assert.equal(mpOrderCalls, 6, "Mercado Pago só deve ter sido chamado 6 vezes no total");

  // Valida que na tabela pedidos foram criados exatamente 6 pedidos
  const totalPedidos = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(totalPedidos.total, 6);
});

test("Rate Limit: avanço temporal de janela (+61s) concede nova cota ao mesmo IP", async () => {
  const DB = createRealSqliteDb();
  const env = { DB, RATE_LIMIT_SECRET };
  const reqDummy = new Request("https://loja.test/api/checkout/pix", { headers: { "CF-Connecting-IP": "10.0.0.99" } });

  const t0 = 1700000000000; // Base timestamp

  // 6 tentativas no minuto 0 -> todas permitidas
  for (let i = 1; i <= 6; i++) {
    const res = await (await import("../functions/lib/checkoutRateLimit.js")).checkCheckoutRateLimit(env, reqDummy, t0);
    assert.equal(res.allowed, true);
    assert.equal(res.count, i);
  }

  // 7ª tentativa no mesmo minuto -> bloqueada
  const resBlocked = await (await import("../functions/lib/checkoutRateLimit.js")).checkCheckoutRateLimit(env, reqDummy, t0);
  assert.equal(resBlocked.allowed, false);
  assert.equal(resBlocked.count, 7);

  // Avança 61 segundos (minuto seguinte)
  const t1 = t0 + 61000;
  const resNewWindow = await (await import("../functions/lib/checkoutRateLimit.js")).checkCheckoutRateLimit(env, reqDummy, t1);
  assert.equal(resNewWindow.allowed, true, "Nova janela deve conceder nova cota");
  assert.equal(resNewWindow.count, 1, "Novo bucket inicia contador em 1");
});

test("Rate Limit: limpeza remove registros expirados sem afetar registros ativos", async () => {
  const DB = createRealSqliteDb();
  const nowSec = 1700000000;

  // Insere um registro expirado e um ativo
  DB.raw.prepare("INSERT INTO checkout_rate_limits (chave, tentativas, expira_em) VALUES ('expirado', 10, ?)").run(nowSec - 100);
  DB.raw.prepare("INSERT INTO checkout_rate_limits (chave, tentativas, expira_em) VALUES ('ativo', 3, ?)").run(nowSec + 100);

  // Executa limpeza de registros expirados
  DB.raw.prepare("DELETE FROM checkout_rate_limits WHERE expira_em < ?").run(nowSec);

  const restantes = DB.raw.prepare("SELECT chave FROM checkout_rate_limits").all();
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].chave, "ativo");
});
