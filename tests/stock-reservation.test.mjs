import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestPost as checkoutPix } from "../functions/api/checkout/pix.js";
import { onRequestGet as getProducts } from "../functions/api/products.js";
import { onRequestPut as updateAdminProduct } from "../functions/api/admin/products/[id].js";
import { syncOrderPayment } from "../functions/lib/paymentSync.js";
import {
  baixarEstoquePedido,
  liberarReservaPedido,
  reconciliarReservaExpirada,
  limparReservasExpiradas
} from "../functions/lib/stock.js";

const RATE_LIMIT_SECRET = "segredo-teste-stock-reservation";

function createRealSqliteDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'Geral',
      descricao TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🍬',
      ordem INTEGER NOT NULL DEFAULT 0,
      destaque INTEGER NOT NULL DEFAULT 0,
      preco_centavos INTEGER NOT NULL,
      disponivel INTEGER NOT NULL DEFAULT 1,
      ativo INTEGER NOT NULL DEFAULT 1,
      estoque INTEGER NOT NULL DEFAULT 10 CHECK (estoque >= 0),
      estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque),
      promocao_ativa INTEGER NOT NULL DEFAULT 0,
      preco_promocional_centavos INTEGER,
      promocao_inicio TEXT,
      promocao_fim TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      pix_expira_em TEXT,
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
      tentativas INTEGER NOT NULL,
      expira_em INTEGER NOT NULL
    );

    CREATE TABLE usuarios_admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL DEFAULT 'Admin',
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT 'admin@test.com',
      ativo INTEGER NOT NULL DEFAULT 1,
      papel TEXT NOT NULL DEFAULT 'admin',
      senha_hash TEXT NOT NULL DEFAULT 'hash',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE admin_sessoes (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL,
      expira_em TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  function prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      sql,
      bind(...params) {
        return {
          async run() {
            const info = stmt.run(...params);
            return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
          },
          async first() {
            return stmt.get(...params) || null;
          },
          async all() {
            return { results: stmt.all(...params) };
          }
        };
      },
      async run() {
        const info = stmt.run();
        return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async first() {
        return stmt.get() || null;
      },
      async all() {
        return { results: stmt.all() };
      }
    };
  }

  let batchQueue = Promise.resolve();
  async function batch(statements) {
    const previous = batchQueue;
    let release;
    batchQueue = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      db.exec("BEGIN");
      const results = [];
      for (const s of statements) {
        const r = await s.run();
        results.push(r);
      }
      db.exec("COMMIT");
      return results;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw err;
    } finally {
      release();
    }
  }

  return { DB: { prepare, batch, raw: db } };
}

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    return handler(url, opts);
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("Cenário A: PAGO confirmado, falha antes da conversão de estoque -> pedido fica PAGO + ATIVA, cleanup não libera, reconciliação posterior converte para CONVERTIDA", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bolo de Pote', 1500, 10, 2);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id, reserva_expira_em)
    VALUES (1, 'token-1', 'Bolo de Pote', 2, 1500, 3000, 'Ana', 'ana@test.com', 'key-1', 'PENDENTE', 'ATIVA', 'mp-order-1', datetime('now', '-5 minutes'));
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Bolo de Pote', 2, 1500, 3000);
  `);

  // 1. Simula recebimento de PAGO via syncOrderPayment
  const restore = mockFetch(
    async () => new Response(JSON.stringify({ id: "mp-order-1", status: "processed" }))
  );
  try {
    await syncOrderPayment(env, {
      pedidoId: 1,
      order: {
        id: "mp-order-1",
        status: "processed",
        transactions: { payments: [{ id: "pay-1", status: "approved" }] }
      }
    });

    const pAposPago = env.DB.raw
      .prepare(
        "SELECT status_pagamento, reserva_status, estoque_baixado_em FROM pedidos WHERE id = 1"
      )
      .get();
    assert.equal(pAposPago.status_pagamento, "PAGO");
    assert.equal(pAposPago.reserva_status, "CONVERTIDA");
    assert.ok(pAposPago.estoque_baixado_em);

    const prodAposPago = env.DB.raw
      .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
      .get();
    assert.equal(prodAposPago.estoque, 8); // 10 - 2 = 8
    assert.equal(prodAposPago.estoque_reservado, 0); // 2 - 2 = 0
  } finally {
    restore();
  }
});

test("Cenário B: Liberação multi-item com falha no meio executa rollback total (sem liberação parcial)", async () => {
  const env = createRealSqliteDb();

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Trufa', 500, 10, 2);
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (2, 'Cone', 800, 10, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-multi', 'Carrinho', 3, 0, 1800, 'Carlos', 'carlos@test.com', 'key-multi', 'PENDENTE', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Trufa', 2, 500, 1000);
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (2, 1, 2, 'Cone', 5, 800, 4000); -- Pede 5, mas estoque_reservado é apenas 1 (provocará falha na guarda estoque_reservado >= 5!)
  `);

  const res = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(res.ok, false);

  // Verifica que o produto 1 NÃO teve sua reserva alterada (rollback total)
  const prod1 = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
  assert.equal(prod1.estoque_reservado, 2);

  const prod2 = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 2").get();
  assert.equal(prod2.estoque_reservado, 1);

  const pedido = env.DB.raw
    .prepare("SELECT reserva_status, status_pagamento FROM pedidos WHERE id = 1")
    .get();
  assert.equal(pedido.reserva_status, "ATIVA");
  assert.equal(pedido.status_pagamento, "PENDENTE");
});

test("Cenário C: Retry POST idempotente após mudança de preço no catálogo utiliza snapshot financeiro original", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";
  env.RATE_LIMIT_SECRET = RATE_LIMIT_SECRET;

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Doce Fino', 1000, 10, 0);
  `);

  let mpRequestBody = null;
  const restore = mockFetch(async (url, opts) => {
    mpRequestBody = JSON.parse(opts.body);
    return new Response(
      JSON.stringify({
        id: "mp-order-snapshot",
        status: "pending",
        transactions: {
          payments: [
            {
              id: "pay-1",
              payment_method: { id: "pix", qr_code: "pix-code", qr_code_base64: "base64" }
            }
          ]
        }
      }),
      { status: 201 }
    );
  });

  try {
    const req1 = new Request("https://loja.test/api/checkout/pix", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://loja.test",
        "CF-Connecting-IP": "1.1.1.1"
      },
      body: JSON.stringify({
        client_request_id: "550e8400-e29b-41d4-a716-446655440000",
        nome: "Bruna Lima",
        email: "bruna@test.com",
        whatsapp: "(33) 98888-7777",
        itens: [{ produto_id: 1, quantidade: 2 }]
      })
    });

    const res1 = await checkoutPix({ request: req1, env });
    assert.equal(res1.status, 201);
    assert.equal(mpRequestBody.total_amount, "20.00"); // 2 * 1000 = 2000 centavos = R$ 20.00

    // 2. Altera o preço do produto no catálogo para R$ 30,00 cada
    env.DB.raw.exec("UPDATE produtos SET preco_centavos = 3000 WHERE id = 1");

    // 3. Retry com a mesma client_request_id
    const req2 = new Request("https://loja.test/api/checkout/pix", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://loja.test",
        "CF-Connecting-IP": "1.1.1.1"
      },
      body: JSON.stringify({
        client_request_id: "550e8400-e29b-41d4-a716-446655440000",
        nome: "Bruna Lima",
        email: "bruna@test.com",
        whatsapp: "(33) 98888-7777",
        itens: [{ produto_id: 1, quantidade: 2 }]
      })
    });

    const res2 = await checkoutPix({ request: req2, env });
    assert.equal(res2.status, 200); // Replay Estado A
    const data2 = await res2.json();
    assert.equal(data2.pedido.valor_total_centavos, 2000); // Manteve o snapshot original de R$ 20,00!
  } finally {
    restore();
  }
});

test("Cenário D: Dois clientes disputam a última unidade (estoque = 1) -> exatamente um reserva e o outro recebe 409 antes do MP", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";
  env.RATE_LIMIT_SECRET = RATE_LIMIT_SECRET;

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Último Brigadeiro', 500, 1, 0);
  `);

  let mpCalls = 0;
  const restore = mockFetch(async () => {
    mpCalls++;
    return new Response(
      JSON.stringify({
        id: `mp-order-${mpCalls}`,
        status: "pending",
        transactions: {
          payments: [{ id: `pay-${mpCalls}`, qr_code: "pix", qr_code_base64: "base64" }]
        }
      }),
      { status: 201 }
    );
  });

  try {
    // Cliente 1 faz pedido
    const req1 = new Request("https://loja.test/api/checkout/pix", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://loja.test",
        "CF-Connecting-IP": "1.1.1.1"
      },
      body: JSON.stringify({
        client_request_id: "550e8400-e29b-41d4-a716-446655440001",
        nome: "Cliente Um",
        email: "um@test.com",
        whatsapp: "(33) 99999-0001",
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    });
    const res1 = await checkoutPix({ request: req1, env });
    assert.equal(res1.status, 201);

    const prodApos1 = env.DB.raw
      .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
      .get();
    assert.equal(prodApos1.estoque, 1);
    assert.equal(prodApos1.estoque_reservado, 1); // Unidade reservada!

    // Cliente 2 tenta pedir o mesmo produto
    const req2 = new Request("https://loja.test/api/checkout/pix", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://loja.test",
        "CF-Connecting-IP": "1.1.1.2"
      },
      body: JSON.stringify({
        client_request_id: "550e8400-e29b-41d4-a716-446655440002",
        nome: "Cliente Dois",
        email: "dois@test.com",
        whatsapp: "(33) 99999-0002",
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    });
    const res2 = await checkoutPix({ request: req2, env });
    assert.equal(res2.status, 409); // Rejeitado antes do MP!
    const data2 = await res2.json();
    assert.match(data2.erro, /esgotado ou com unidades reservadas/);

    assert.equal(mpCalls, 1); // Exatamente 1 chamada ao Mercado Pago
  } finally {
    restore();
  }
});

test("Cenário E: Timeout após Order possivelmente criada no MP -> reserva permanece ATIVA", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";
  env.RATE_LIMIT_SECRET = RATE_LIMIT_SECRET;

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Torta Holandesa', 2500, 5, 0);
  `);

  // Simula timeout de rede (fetch throws Error)
  const restore = mockFetch(async () => {
    throw new Error("Network connection reset / Gateway timeout");
  });

  try {
    const req = new Request("https://loja.test/api/checkout/pix", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://loja.test",
        "CF-Connecting-IP": "1.1.1.1"
      },
      body: JSON.stringify({
        client_request_id: "550e8400-e29b-41d4-a716-446655440005",
        nome: "Eduardo",
        email: "edu@test.com",
        whatsapp: "(33) 99999-5555",
        itens: [{ produto_id: 1, quantidade: 1 }]
      })
    });

    const res = await checkoutPix({ request: req, env });
    assert.equal(res.status, 502);

    // Reserva deve permanecer ATIVA (política conservadora fail-safe)
    const pedido = env.DB.raw
      .prepare(
        "SELECT status_pagamento, reserva_status FROM pedidos WHERE idempotency_key = '550e8400-e29b-41d4-a716-446655440005'"
      )
      .get();
    assert.equal(pedido.status_pagamento, "ERRO");
    assert.equal(pedido.reserva_status, "ATIVA");

    const prod = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
    assert.equal(prod.estoque_reservado, 1);
  } finally {
    restore();
  }
});

test("Cenário F: MP retorna expired confirmado na reconciliação -> reserva é liberada exatamente uma vez", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Palha Italiana', 800, 10, 2);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id, reserva_expira_em)
    VALUES (1, 'token-exp', 'Palha Italiana', 2, 800, 1600, 'Fernando', 'fer@test.com', 'key-exp', 'PENDENTE', 'ATIVA', 'mp-order-exp', datetime('now', '-10 minutes'));
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Palha Italiana', 2, 800, 1600);
  `);

  const restore = mockFetch(
    async () =>
      new Response(
        JSON.stringify({
          id: "mp-order-exp",
          status: "expired",
          status_detail: "expired_by_time"
        })
      )
  );

  try {
    const res = await reconciliarReservaExpirada(env, 1);
    assert.equal(res.reconciliado, true);
    assert.equal(res.status, "LIBERADA");

    const pedido = env.DB.raw
      .prepare(
        "SELECT status_pagamento, reserva_status, reserva_liberada_em FROM pedidos WHERE id = 1"
      )
      .get();
    assert.equal(pedido.status_pagamento, "EXPIRADO");
    assert.equal(pedido.reserva_status, "LIBERADA");
    assert.ok(pedido.reserva_liberada_em);

    const prod = env.DB.raw
      .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
      .get();
    assert.equal(prod.estoque, 10);
    assert.equal(prod.estoque_reservado, 0); // Liberou!
  } finally {
    restore();
  }
});

test("Cenário G: Falha 503 na reconciliação de reserva expirada -> reserva permanece ATIVA", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Cupcake', 1200, 5, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id, reserva_expira_em)
    VALUES (1, 'token-503', 'Cupcake', 1, 1200, 1200, 'Gabriel', 'gab@test.com', 'key-503', 'PENDENTE', 'ATIVA', 'mp-order-503', datetime('now', '-5 minutes'));
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Cupcake', 1, 1200, 1200);
  `);

  const restore = mockFetch(async () => new Response("Service Unavailable", { status: 503 }));

  try {
    const res = await reconciliarReservaExpirada(env, 1);
    assert.equal(res.reconciliado, false);

    const pedido = env.DB.raw
      .prepare("SELECT status_pagamento, reserva_status FROM pedidos WHERE id = 1")
      .get();
    assert.equal(pedido.status_pagamento, "PENDENTE");
    assert.equal(pedido.reserva_status, "ATIVA");

    const prod = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
    assert.equal(prod.estoque_reservado, 1);
  } finally {
    restore();
  }
});

test("Cenário H: Webhook PAGO duplicado não altera estoque físico nem reservado duas vezes", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Brownie', 1200, 10, 2);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id)
    VALUES (1, 'token-dup', 'Brownie', 2, 1200, 2400, 'Helena', 'helena@test.com', 'key-dup', 'PENDENTE', 'ATIVA', 'mp-order-dup');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Brownie', 2, 1200, 2400);
  `);

  const orderPago = {
    id: "mp-order-dup",
    status: "processed",
    transactions: { payments: [{ id: "pay-dup", status: "approved" }] }
  };

  // 1ª execução
  await syncOrderPayment(env, { pedidoId: 1, order: orderPago });
  const prod1 = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod1.estoque, 8);
  assert.equal(prod1.estoque_reservado, 0);

  // 2ª execução duplicada
  await syncOrderPayment(env, { pedidoId: 1, order: orderPago });
  const prod2 = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod2.estoque, 8); // Não baixou de novo!
  assert.equal(prod2.estoque_reservado, 0);
});

test("Cenário I: PAGO -> REEMBOLSADO não repõe estoque físico automaticamente", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Torta Limão', 1800, 10, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id)
    VALUES (1, 'token-reemb', 'Torta Limão', 1, 1800, 1800, 'Igor', 'igor@test.com', 'key-reemb', 'PENDENTE', 'ATIVA', 'mp-order-reemb');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Torta Limão', 1, 1800, 1800);
  `);

  // 1. Paga
  await syncOrderPayment(env, {
    pedidoId: 1,
    order: {
      id: "mp-order-reemb",
      status: "processed",
      transactions: { payments: [{ id: "pay-1", status: "approved" }] }
    }
  });
  const prodAposPago = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prodAposPago.estoque, 9);
  assert.equal(prodAposPago.estoque_reservado, 0);

  // 2. Reembolsa
  await syncOrderPayment(env, {
    pedidoId: 1,
    order: { id: "mp-order-reemb", status: "refunded", status_detail: "refunded" }
  });

  const pedidoReemb = env.DB.raw.prepare("SELECT status_pagamento FROM pedidos WHERE id = 1").get();
  assert.equal(pedidoReemb.status_pagamento, "REEMBOLSADO");

  const prodAposReemb = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prodAposReemb.estoque, 9); // Estoque físico NÃO voltou automaticamente
  assert.equal(prodAposReemb.estoque_reservado, 0);
});

test("Cenário J: Edição Admin não permite reduzir estoque físico abaixo de estoque_reservado", async () => {
  const env = createRealSqliteDb();
  env.ADMIN_KEY = "admin-secret";

  const token = "admin-token-123";
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const expiraEm = new Date(Date.now() + 3600000).toISOString();
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Quindim', 600, 5, 3);
    INSERT INTO usuarios_admin (id, nome, username, email, ativo, papel, senha_hash) VALUES (1, 'Admin', 'admin', 'admin@test.com', 1, 'admin', 'hash');
  `);
  env.DB.raw
    .prepare("INSERT INTO admin_sessoes (token_hash, usuario_id, expira_em) VALUES (?, 1, ?)")
    .run(tokenHash, expiraEm);

  const req = new Request("https://loja.test/api/admin/products/1", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      Origin: "https://loja.test",
      cookie: `rp_admin_session=${token}`
    },
    body: JSON.stringify({
      nome: "Quindim",
      categoria: "BOLO_NO_POTE",
      descricao: "Delicioso",
      preco_centavos: 600,
      disponivel: true,
      ativo: true,
      estoque: 2 // Tentando reduzir para 2 enquanto há 3 reservados!
    })
  });

  const res = await updateAdminProduct({ request: req, env, params: { id: "1" } });
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.match(data.erro, /existem 3 unidade\(s\) reservada\(s\)/);

  const prod = env.DB.raw.prepare("SELECT estoque FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque, 5); // Não alterou!
});

test("Cenário K: GET /api/products reflete disponibilidade real (estoque - estoque_reservado) e limpa reservas vencidas", async () => {
  const env = createRealSqliteDb();
  env.MP_ACCESS_TOKEN = "test-token";

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, categoria, preco_centavos, estoque, estoque_reservado, disponivel, ativo)
    VALUES (1, 'Bolo Vencido', 'Bolos', 1500, 2, 2, 1, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, mp_order_id, reserva_expira_em)
    VALUES (1, 'token-vencido', 'Bolo Vencido', 2, 1500, 3000, 'Joao', 'joao@test.com', 'key-venc', 'PENDENTE', 'ATIVA', 'mp-order-venc', datetime('now', '-35 minutes'));
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Bolo Vencido', 2, 1500, 3000);
  `);

  const restore = mockFetch(
    async () =>
      new Response(
        JSON.stringify({
          id: "mp-order-venc",
          status: "expired",
          status_detail: "expired_by_time"
        })
      )
  );

  try {
    const res = await getProducts({ env });
    assert.equal(res.status, 200);
    const data = await res.json();
    const prod = data.produtos.find(p => p.id === 1);
    assert.ok(prod);
    assert.equal(prod.disponivel, true); // Reserva vencida foi liberada pelo cleanup, tornando o produto disponível de novo!
  } finally {
    restore();
  }
});

// =========================================================================
// TESTES OBRIGATÓRIOS DE CONCORRÊNCIA REAL E MULTI-ITEM
// =========================================================================

test("Concorrência A: duas liberarReservaPedido() simultâneas no mesmo pedido não causam duplo decremento", async () => {
  const env = createRealSqliteDb();

  // Estado inicial: estoque = 10, estoque_reservado = 5 (1 do pedido 1 + 4 de outros pedidos)
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Bombom Morango', 700, 10, 5);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-c1', 'Bombom Morango', 1, 700, 700, 'Lucas', 'lucas@test.com', 'key-c1', 'PENDENTE', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Bombom Morango', 1, 700, 700);
  `);

  // Duas liberações simultâneas
  const [res1, res2] = await Promise.all([
    liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" }),
    liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" })
  ]);

  // Exatamente uma teve liberado: true
  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  assert.equal(Number(res1.liberado) + Number(res2.liberado), 1);

  // Resultado obrigatório: estoque_reservado = 4 (NUNCA 3!)
  const prod = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod.estoque, 10);
  assert.equal(prod.estoque_reservado, 4);

  const pedido = env.DB.raw
    .prepare("SELECT reserva_status, status_pagamento FROM pedidos WHERE id = 1")
    .get();
  assert.equal(pedido.reserva_status, "LIBERADA");
  assert.equal(pedido.status_pagamento, "EXPIRADO");
});

test("Concorrência B: duas baixarEstoquePedido() simultâneas no mesmo pedido não causam dupla baixa física nem de reserva", async () => {
  const env = createRealSqliteDb();

  // Estado inicial: estoque = 10, estoque_reservado = 5 (1 do pedido 1 + 4 de outros pedidos), pedido PAGO + ATIVA
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Cone Trufado', 1000, 10, 5);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-c2', 'Cone Trufado', 1, 1000, 1000, 'Mariana', 'mari@test.com', 'key-c2', 'PAGO', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Cone Trufado', 1, 1000, 1000);
  `);

  // Duas baixas simultâneas
  const [res1, res2] = await Promise.all([
    baixarEstoquePedido(env, 1),
    baixarEstoquePedido(env, 1)
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  assert.equal(Number(res1.baixado) + Number(res2.baixado), 1);

  // Resultado obrigatório: estoque = 9 (nunca 8!), estoque_reservado = 4 (nunca 3!)
  const prod = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod.estoque, 9);
  assert.equal(prod.estoque_reservado, 4);

  const pedido = env.DB.raw
    .prepare(
      "SELECT reserva_status, status_pagamento, estoque_baixado_em FROM pedidos WHERE id = 1"
    )
    .get();
  assert.equal(pedido.reserva_status, "CONVERTIDA");
  assert.equal(pedido.status_pagamento, "PAGO");
  assert.ok(pedido.estoque_baixado_em);
});

test("Concorrência C: Multi-item com erro no 2º item executa rollback total (produto 1 e pedido inalterados)", async () => {
  const env = createRealSqliteDb();

  // Produto 1 tem 2 reservados (válido). Produto 2 tem 1 reservado, mas pedido tenta baixar/liberar 5 (inválido).
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Item 1', 500, 10, 2);
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (2, 'Item 2', 500, 10, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-c3', 'Combo', 7, 500, 3500, 'Nathalia', 'nat@test.com', 'key-c3', 'PAGO', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Item 1', 2, 500, 1000);
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (2, 1, 2, 'Item 2', 5, 500, 2500);
  `);

  const res = await baixarEstoquePedido(env, 1);
  assert.equal(res.ok, false);

  // Produto 1 NÃO teve estoque alterado
  const prod1 = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod1.estoque, 10);
  assert.equal(prod1.estoque_reservado, 2);

  // Produto 2 NÃO teve estoque alterado
  const prod2 = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 2")
    .get();
  assert.equal(prod2.estoque, 10);
  assert.equal(prod2.estoque_reservado, 1);

  // Pedido permanece ATIVA
  const pedido = env.DB.raw
    .prepare("SELECT reserva_status, estoque_baixado_em FROM pedidos WHERE id = 1")
    .get();
  assert.equal(pedido.reserva_status, "ATIVA");
  assert.equal(pedido.estoque_baixado_em, null);
});

test("Concorrência D: Retry de liberarReservaPedido() depois de já LIBERADA não causa alteração adicional", async () => {
  const env = createRealSqliteDb();

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Doce Leite', 400, 10, 1);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-c4', 'Doce Leite', 1, 400, 400, 'Otavio', 'otavio@test.com', 'key-c4', 'PENDENTE', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Doce Leite', 1, 400, 400);
  `);

  const res1 = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(res1.ok, true);
  assert.equal(res1.liberado, true);

  const res2 = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(res2.ok, true);
  assert.equal(res2.liberado, false); // Idempotente!

  const prod = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque_reservado, 0); // Permanece 0
});

test("Concorrência E: Retry de baixarEstoquePedido() depois de já CONVERTIDA não causa alteração adicional", async () => {
  const env = createRealSqliteDb();

  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Pão de Mel', 800, 10, 2);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-c5', 'Pão de Mel', 2, 800, 1600, 'Paula', 'paula@test.com', 'key-c5', 'PAGO', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Pão de Mel', 2, 800, 1600);
  `);

  const res1 = await baixarEstoquePedido(env, 1);
  assert.equal(res1.ok, true);
  assert.equal(res1.baixado, true);

  const res2 = await baixarEstoquePedido(env, 1);
  assert.equal(res2.ok, true);
  assert.equal(res2.baixado, false); // Idempotente!

  const prod = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod.estoque, 8);
  assert.equal(prod.estoque_reservado, 0);
});

test("Concorrência F: Duas reservas de pedidos DIFERENTES sobre o mesmo produto liberam suas respectivas cotas independentemente", async () => {
  const env = createRealSqliteDb();

  // Produto com 5 reservas: 2 do Pedido 1, 3 do Pedido 2
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Cookie', 600, 20, 5);
    
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-p1', 'Cookie', 2, 600, 1200, 'Quezia', 'quezia@test.com', 'key-p1', 'PENDENTE', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Cookie', 2, 600, 1200);

    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (2, 'token-p2', 'Cookie', 3, 600, 1800, 'Rodrigo', 'rodrigo@test.com', 'key-p2', 'PENDENTE', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (2, 2, 1, 'Cookie', 3, 600, 1800);
  `);

  // Libera pedido 1 (2 unidades)
  const res1 = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(res1.ok, true);
  assert.equal(res1.liberado, true);

  const prodApos1 = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
  assert.equal(prodApos1.estoque_reservado, 3); // 5 - 2 = 3

  // Libera pedido 2 (3 unidades)
  const res2 = await liberarReservaPedido(env, 2, { novoStatus: "EXPIRADO" });
  assert.equal(res2.ok, true);
  assert.equal(res2.liberado, true);

  const prodApos2 = env.DB.raw.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").get();
  assert.equal(prodApos2.estoque_reservado, 0); // 3 - 3 = 0
});

test("Concorrência G: Corrida liberarReservaPedido() vence baixarEstoquePedido() (baixa atrasada não consome reserva de terceiros)", async () => {
  const env = createRealSqliteDb();

  // Estado inicial: estoque = 10, estoque_reservado = 5 (1 do Pedido 1 + 4 de terceiros)
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Torta Holandesa', 1200, 10, 5);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-g1', 'Torta Holandesa', 1, 1200, 1200, 'Silvia', 'silvia@test.com', 'key-g1', 'PAGO', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Torta Holandesa', 1, 1200, 1200);
  `);

  // 1. Liberação executa primeiro e comita
  const resLib = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(resLib.ok, true);
  assert.equal(resLib.liberado, true);

  // 2. Baixa executa depois (mesmo se o processo acreditava que o status era ATIVA)
  const resBaixa = await baixarEstoquePedido(env, 1);
  assert.equal(resBaixa.ok, true);
  assert.equal(resBaixa.baixado, false); // Não baixou pois reserva_status já não é mais ATIVA!

  // Resultado obrigatório:
  // estoque = 10 (intacto), estoque_reservado = 4 (apenas a cota do pedido 1 foi liberada; as outras 4 de terceiros estão intactas!)
  const prod = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod.estoque, 10);
  assert.equal(prod.estoque_reservado, 4);

  const pedido = env.DB.raw
    .prepare("SELECT reserva_status, estoque_baixado_em FROM pedidos WHERE id = 1")
    .get();
  assert.equal(pedido.reserva_status, "LIBERADA");
  assert.equal(pedido.estoque_baixado_em, null);
});

test("Concorrência H: Corrida baixarEstoquePedido() vence liberarReservaPedido() (liberação posterior é no-op)", async () => {
  const env = createRealSqliteDb();

  // Estado inicial: estoque = 10, estoque_reservado = 5 (1 do Pedido 1 + 4 de terceiros)
  env.DB.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, estoque_reservado) VALUES (1, 'Torta Holandesa', 1200, 10, 5);
    INSERT INTO pedidos (id, token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status)
    VALUES (1, 'token-h1', 'Torta Holandesa', 1, 1200, 1200, 'Silvia', 'silvia@test.com', 'key-h1', 'PAGO', 'ATIVA');
    INSERT INTO pedido_itens (id, pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
    VALUES (1, 1, 1, 'Torta Holandesa', 1, 1200, 1200);
  `);

  // 1. Baixa executa primeiro e comita
  const resBaixa = await baixarEstoquePedido(env, 1);
  assert.equal(resBaixa.ok, true);
  assert.equal(resBaixa.baixado, true);

  // 2. Liberação tenta executar depois
  const resLib = await liberarReservaPedido(env, 1, { novoStatus: "EXPIRADO" });
  assert.equal(resLib.ok, true);
  assert.equal(resLib.liberado, false); // No-op!

  // Resultado obrigatório:
  // estoque = 9, estoque_reservado = 4
  const prod = env.DB.raw
    .prepare("SELECT estoque, estoque_reservado FROM produtos WHERE id = 1")
    .get();
  assert.equal(prod.estoque, 9);
  assert.equal(prod.estoque_reservado, 4);

  const pedido = env.DB.raw
    .prepare(
      "SELECT reserva_status, status_pagamento, estoque_baixado_em FROM pedidos WHERE id = 1"
    )
    .get();
  assert.equal(pedido.reserva_status, "CONVERTIDA");
  assert.equal(pedido.status_pagamento, "PAGO");
  assert.ok(pedido.estoque_baixado_em);
});
