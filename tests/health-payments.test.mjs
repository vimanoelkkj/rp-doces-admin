import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestGet as healthPayments } from "../functions/api/admin/health/payments.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function createRealSqliteDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      preco_centavos INTEGER NOT NULL,
      disponivel INTEGER NOT NULL DEFAULT 1,
      ativo INTEGER NOT NULL DEFAULT 1,
      estoque INTEGER NOT NULL DEFAULT 10,
      estoque_reservado INTEGER NOT NULL DEFAULT 0
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
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pago_em TEXT,
      estoque_baixado_em TEXT
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
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    }
  };
}

async function seedAdminSession(sqlite) {
  const token = "admin-session-token-test";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  const expiraEm = new Date(Date.now() + 3600000).toISOString();
  sqlite.raw.exec(`
    INSERT OR REPLACE INTO usuarios_admin (id, nome, username, email, ativo, papel)
    VALUES (1, 'Admin', 'admin', 'admin@test.com', 1, 'admin');
    INSERT OR REPLACE INTO admin_sessoes (token_hash, usuario_id, expira_em)
    VALUES ('${hash}', 1, '${expiraEm}');
  `);
  return token;
}

async function authenticatedRequest() {
  return new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: "rp_admin_session=test-token" }
  });
}

function mockAdminAuthDb(handlers = {}) {
  return fakeDb((sql) => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", username: "admin", ativo: 1, papel: "ADMIN" }) };
    }
    return handlers(sql) || {};
  });
}

test("1. Banco saudável -> status healthy", async () => {
  const DB = mockAdminAuthDb((sql) => {
    if (sql.includes("FROM pedidos")) {
      return {
        first: () => ({
          pagos_sem_baixa_estoque: 0,
          reservas_vencidas_ativas: 0,
          erros_com_reserva_ativa: 0,
          erros_com_reserva_vencida: 0
        })
      };
    }
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "healthy");
  assert.equal(data.alertas_ativos, 0);
  assert.equal(data.metricas.pagos_sem_baixa_estoque, 0);
  assert.equal(data.metricas.reservas_vencidas_ativas, 0);
  assert.equal(data.metricas.erros_com_reserva_ativa, 0);
  assert.equal(data.metricas.erros_com_reserva_vencida, 0);
  assert.ok(data.timestamp);
});

test("2. PAGO recente sem baixa dentro da tolerância -> ainda healthy (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido pago há 30 segundos (dentro da tolerância de 2 minutos)
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, pago_em, atualizado_em, estoque_baixado_em)
    VALUES ('tok-1', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-1', 'PAGO', datetime('now', '-30 seconds'), datetime('now', '-30 seconds'), NULL);
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "healthy");
  assert.equal(data.metricas.pagos_sem_baixa_estoque, 0);
  assert.equal(data.alertas_ativos, 0);
});

test("3. PAGO antigo sem baixa além da tolerância -> critical (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido pago há 3 minutos sem baixa de estoque
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, pago_em, atualizado_em, estoque_baixado_em)
    VALUES ('tok-2', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-2', 'PAGO', datetime('now', '-3 minutes'), datetime('now', '-3 minutes'), NULL);
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "critical");
  assert.equal(data.metricas.pagos_sem_baixa_estoque, 1);
  assert.equal(data.alertas_ativos, 1);
});

test("4. Reserva ATIVA dentro do prazo -> healthy (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido com reserva ativa expirando em 25 minutos
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, reserva_expira_em)
    VALUES ('tok-3', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-3', 'PENDENTE', 'ATIVA', datetime('now', '+25 minutes'));
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "healthy");
  assert.equal(data.metricas.reservas_vencidas_ativas, 0);
  assert.equal(data.alertas_ativos, 0);
});

test("5. Reserva ATIVA vencida + tolerância de 5 minutos -> warning (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido com reserva ativa que venceu há 6 minutos
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, reserva_expira_em)
    VALUES ('tok-4', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-4', 'PENDENTE', 'ATIVA', datetime('now', '-6 minutes'));
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "warning");
  assert.equal(data.metricas.reservas_vencidas_ativas, 1);
  assert.equal(data.alertas_ativos, 1);
});

test("6. ERRO + reserva ATIVA não vencida -> warning (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido em ERRO mas ainda com reserva ativa não vencida
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, reserva_expira_em)
    VALUES ('tok-5', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-5', 'ERRO', 'ATIVA', datetime('now', '+10 minutes'));
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "warning");
  assert.equal(data.metricas.erros_com_reserva_ativa, 1);
  assert.equal(data.metricas.erros_com_reserva_vencida, 0);
  assert.equal(data.alertas_ativos, 1);
});

test("7. ERRO + reserva ATIVA vencida -> critical (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Pedido em ERRO com reserva ativa vencida há mais de 5 minutos
    INSERT INTO pedidos (token_publico, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email, idempotency_key, status_pagamento, reserva_status, reserva_expira_em)
    VALUES ('tok-6', 'Bolo', 1, 1000, 1000, 'Cliente', 'c@t.com', 'idemp-6', 'ERRO', 'ATIVA', datetime('now', '-10 minutes'));
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "critical");
  assert.equal(data.metricas.erros_com_reserva_ativa, 1);
  assert.equal(data.metricas.erros_com_reserva_vencida, 1);
  assert.equal(data.metricas.reservas_vencidas_ativas, 1);
  // Alertas ativos contam categorias distintas ativas
  assert.equal(data.alertas_ativos, 3);
});

test("8. Múltiplas anomalias respeitam precedência critical", async () => {
  const DB = mockAdminAuthDb((sql) => {
    if (sql.includes("FROM pedidos")) {
      return {
        first: () => ({
          pagos_sem_baixa_estoque: 1, // trigger critical
          reservas_vencidas_ativas: 5, // trigger warning
          erros_com_reserva_ativa: 2,  // trigger warning
          erros_com_reserva_vencida: 0
        })
      };
    }
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "critical");
  assert.equal(data.alertas_ativos, 3);
});

test("9. alertas_ativos conta categorias ativas, não quantidade de pedidos", async () => {
  const DB = mockAdminAuthDb((sql) => {
    if (sql.includes("FROM pedidos")) {
      return {
        first: () => ({
          pagos_sem_baixa_estoque: 15, // 1ª categoria ativa
          reservas_vencidas_ativas: 40, // 2ª categoria ativa
          erros_com_reserva_ativa: 0,
          erros_com_reserva_vencida: 0
        })
      };
    }
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.alertas_ativos, 2);
});

test("10. Resposta não contém PII nem chaves de pedidos individuais", async () => {
  const DB = mockAdminAuthDb((sql) => {
    if (sql.includes("FROM pedidos")) {
      return {
        first: () => ({
          pagos_sem_baixa_estoque: 0,
          reservas_vencidas_ativas: 0,
          erros_com_reserva_ativa: 0,
          erros_com_reserva_vencida: 0
        })
      };
    }
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  const allowedKeys = new Set(["status", "alertas_ativos", "metricas", "timestamp"]);
  for (const k of Object.keys(data)) {
    assert.ok(allowedKeys.has(k), `Chave inesperada na raiz da resposta: ${k}`);
  }

  const allowedMetrics = new Set([
    "pagos_sem_baixa_estoque",
    "reservas_vencidas_ativas",
    "erros_com_reserva_ativa",
    "erros_com_reserva_vencida"
  ]);
  for (const k of Object.keys(data.metricas)) {
    assert.ok(allowedMetrics.has(k), `Chave inesperada em metricas: ${k}`);
    assert.equal(typeof data.metricas[k], "number");
  }
});

test("11. Banco vazio -> zeros + healthy (SQLite real)", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);
  const data = await responseJson(res);

  assert.equal(data.status, "healthy");
  assert.equal(data.alertas_ativos, 0);
  assert.deepEqual(data.metricas, {
    pagos_sem_baixa_estoque: 0,
    reservas_vencidas_ativas: 0,
    erros_com_reserva_ativa: 0,
    erros_com_reserva_vencida: 0
  });
});

test("12. Endpoint exige autenticação administrativa", async () => {
  const DB = fakeDb((sql) => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => null }; // Sessão não encontrada
    }
    return {};
  });

  const requestSemCookie = new Request("https://loja.test/api/admin/health/payments");
  const res1 = await healthPayments({ request: requestSemCookie, env: { DB } });
  assert.equal(res1.status, 401);

  const requestComCookieInvalido = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: "rp_admin_session=invalido" }
  });
  const res2 = await healthPayments({ request: requestComCookieInvalido, env: { DB } });
  assert.equal(res2.status, 401);
});

test("13. Falha do DB retorna resposta genérica sem SQL/stack", async () => {
  const DB = mockAdminAuthDb((sql) => {
    if (sql.includes("FROM pedidos")) {
      throw new Error("FATAL_SQLITE_INTERNAL_ERROR: table corrupted at offset 0x999; SELECT * FROM secret_table");
    }
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 500);
  const data = await responseJson(res);

  assert.equal(data.erro, "Erro ao consultar saúde dos pagamentos.");
  const jsonStr = JSON.stringify(data);
  assert.equal(jsonStr.includes("FATAL_SQLITE_INTERNAL_ERROR"), false);
  assert.equal(jsonStr.includes("secret_table"), false);
  assert.equal(jsonStr.includes("stack"), false);
});

test("14. Nenhuma função de Mercado Pago ou fetch externo é chamada", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("FETCH_EXTERNAL_DEVE_PERMANECER_INATIVO");
  };

  try {
    const DB = mockAdminAuthDb((sql) => {
      if (sql.includes("FROM pedidos")) {
        return {
          first: () => ({
            pagos_sem_baixa_estoque: 0,
            reservas_vencidas_ativas: 0,
            erros_com_reserva_ativa: 0,
            erros_com_reserva_vencida: 0
          })
        };
      }
    });

    const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("15 & 16. Endpoint é estritamente read-only: não executa mutações (INSERT/UPDATE/DELETE/REPLACE/batch)", async () => {
  const statementsExecutados = [];

  const DB = fakeDb((sql) => {
    statementsExecutados.push(sql.trim());
    const isSelect = sql.trim().toUpperCase().startsWith("SELECT");
    assert.ok(isSelect, `Statement não-SELECT detectado no endpoint: ${sql}`);

    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", username: "admin", ativo: 1, papel: "ADMIN" }) };
    }
    return {
      first: () => ({
        pagos_sem_baixa_estoque: 0,
        reservas_vencidas_ativas: 0,
        erros_com_reserva_ativa: 0,
        erros_com_reserva_vencida: 0
      })
    };
  }, async () => {
    throw new Error("BATCH_MUTATIONS_NOT_ALLOWED_IN_READ_ONLY_HEALTH");
  });

  const res = await healthPayments({ request: await authenticatedRequest(), env: { DB } });
  assert.equal(res.status, 200);

  // Confirma que apenas SELECTs foram executados
  assert.ok(statementsExecutados.length >= 2);
  for (const stmt of statementsExecutados) {
    assert.ok(stmt.toUpperCase().startsWith("SELECT"), `Statement executado não é SELECT: ${stmt}`);
    assert.equal(stmt.toUpperCase().includes("INSERT"), false);
    assert.equal(stmt.toUpperCase().includes("UPDATE"), false);
    assert.equal(stmt.toUpperCase().includes("DELETE"), false);
    assert.equal(stmt.toUpperCase().includes("REPLACE"), false);
  }
});

test("17. Teste Adversarial de PII em Banco com Pedido Realista Completo", async () => {
  const sqlite = createRealSqliteDb();
  const token = await seedAdminSession(sqlite);
  sqlite.raw.exec(`
    -- Inserir pedido com múltiplos dados sensíveis/PII
    INSERT INTO pedidos (
      token_publico, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos,
      cliente_nome, cliente_email, cliente_whatsapp, observacao, mp_order_id, mp_payment_id,
      mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url, idempotency_key, reserva_status,
      reserva_expira_em, status_pagamento
    ) VALUES (
      'token-ultra-secreto-uuid-99999', 10, 'Trufa de Maracujá Especial', 3, 500, 1500,
      'João da Silva Sauro', 'joao.sauro@empresa-secreta.com', '(33) 99999-8888',
      'Por favor entregar discretamente na portaria dos fundos', 'mp-order-id-sensivel-777',
      'mp-payment-id-sensivel-888', 'pending', '00020126580014br.gov.bcb.pix...',
      'BASE64_QR_CODE_SECRET_STRING', 'https://mercadopago.com/ticket/secret',
      'idempotency-key-secret-client', 'ATIVA', datetime('now', '+20 minutes'), 'PENDENTE'
    );
  `);

  const request = new Request("https://loja.test/api/admin/health/payments", {
    headers: { Cookie: `rp_admin_session=${token}` }
  });
  const res = await healthPayments({ request, env: { DB: sqlite } });
  assert.equal(res.status, 200);

  const rawJson = await res.text();

  // Verificação estrita de que nenhum PII ou identificador vazou no payload serializado
  assert.equal(rawJson.includes("token-ultra-secreto-uuid-99999"), false);
  assert.equal(rawJson.includes("Trufa de Maracujá Especial"), false);
  assert.equal(rawJson.includes("João da Silva Sauro"), false);
  assert.equal(rawJson.includes("joao.sauro@empresa-secreta.com"), false);
  assert.equal(rawJson.includes("99999-8888"), false);
  assert.equal(rawJson.includes("portaria dos fundos"), false);
  assert.equal(rawJson.includes("mp-order-id-sensivel-777"), false);
  assert.equal(rawJson.includes("mp-payment-id-sensivel-888"), false);
  assert.equal(rawJson.includes("00020126580014br.gov.bcb.pix"), false);
  assert.equal(rawJson.includes("BASE64_QR_CODE_SECRET_STRING"), false);
  assert.equal(rawJson.includes("idempotency-key-secret-client"), false);
});

test("18. EXPLAIN QUERY PLAN da consulta agregada", () => {
  const sqlite = createRealSqliteDb();
  const explain = sqlite.raw.prepare(`
    EXPLAIN QUERY PLAN
    SELECT
      COALESCE(SUM(CASE
        WHEN status_pagamento = 'PAGO'
          AND estoque_baixado_em IS NULL
          AND COALESCE(pago_em, atualizado_em) <= datetime('now', '-2 minutes')
        THEN 1 ELSE 0 END), 0) AS pagos_sem_baixa_estoque,
      COALESCE(SUM(CASE
        WHEN reserva_status = 'ATIVA'
          AND reserva_expira_em IS NOT NULL
          AND reserva_expira_em <= datetime('now', '-5 minutes')
        THEN 1 ELSE 0 END), 0) AS reservas_vencidas_ativas,
      COALESCE(SUM(CASE
        WHEN status_pagamento = 'ERRO'
          AND reserva_status = 'ATIVA'
        THEN 1 ELSE 0 END), 0) AS erros_com_reserva_ativa,
      COALESCE(SUM(CASE
        WHEN status_pagamento = 'ERRO'
          AND reserva_status = 'ATIVA'
          AND reserva_expira_em IS NOT NULL
          AND reserva_expira_em <= datetime('now', '-5 minutes')
        THEN 1 ELSE 0 END), 0) AS erros_com_reserva_vencida
    FROM pedidos
  `).all();

  assert.ok(explain.length >= 1);
  const detail = explain[0].detail;
  // A query realiza uma varredura sequencial limpa (SCAN pedidos) em passagem única O(N)
  assert.ok(detail.includes("SCAN pedidos"));
});

