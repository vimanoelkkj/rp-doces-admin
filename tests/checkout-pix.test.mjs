import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestPost } from "../functions/api/checkout/pix.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

const cliente = { nome: "Maria Silva", email: "maria@example.com", whatsapp: "(33) 99999-9999" };

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
  return fakeDb(
    sql => sql.includes("FROM produtos WHERE id IN")
      ? { all: s => ({ results: produtos.filter(p => s.args.includes(p.id)) }) }
      : { run: () => ({ success: true, meta: { changes: 1 } }) },
    async ss => ss.map((_, i) => ({ success: true, meta: i === 0 ? { last_row_id: 91, changes: 1 } : { changes: 1 } }))
  );
}

function req(body) {
  return new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://loja.test" },
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
    MP_ACCESS_TOKEN: "teste"
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
    env: { DB: db([produto(1)]), MP_ACCESS_TOKEN: "teste" }
  });
  const b = await responseJson(r);
  assert.equal(r.status, 201);
  assert.equal(b.pedido.itens.length, 1);
  assert.equal(b.pedido.quantidade_total, 1);
});

test("itens repetidos respeitam limite total", async () => {
  const r = await onRequestPost({
    request: req({ ...cliente, itens: [{ produto_id: 1, quantidade: 30 }, { produto_id: 1, quantidade: 21 }] }),
    env: { DB: db([produto(1)]), MP_ACCESS_TOKEN: "teste" }
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
    env: { DB: db([produto(1, { estoque: 1 })]), MP_ACCESS_TOKEN: "teste" }
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
    env: { DB, MP_ACCESS_TOKEN: "teste" }
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
  const r1 = await onRequestPost({ request: req(requestBody), env: { DB, MP_ACCESS_TOKEN: "teste" } });
  const b1 = await responseJson(r1);
  assert.equal(r1.status, 201);
  assert.equal(calls, 1);

  // Segunda chamada (retry)
  const r2 = await onRequestPost({ request: req(requestBody), env: { DB, MP_ACCESS_TOKEN: "teste" } });
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

  const env = { DB, MP_ACCESS_TOKEN: "teste" };
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
  const env = { DB, MP_ACCESS_TOKEN: "teste" };

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
    env: { DB, MP_ACCESS_TOKEN: "teste" }
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

  const env = { DB, MP_ACCESS_TOKEN: "teste" };
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
    env: { DB, MP_ACCESS_TOKEN: "teste" }
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
    env: { DB, MP_ACCESS_TOKEN: "teste" }
  });

  assert.equal(r.status, 201);
  const body = await responseJson(r);
  assert.equal(body.pix.qr_code, "NEW-PIX-QR");

  const count = DB.raw.prepare("SELECT count(*) as total FROM pedidos").get();
  assert.equal(count.total, 2); // 1 expirado + 1 novo
});
