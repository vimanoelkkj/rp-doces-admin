import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { onRequestPost as webhook } from "../functions/api/webhooks/mercadopago.js";
import { onRequestGet as adminOrders } from "../functions/api/admin/orders/index.js";
import { onRequestGet as getPublicOrder } from "../functions/api/orders/[token].js";
import { syncOrderPayment } from "../functions/lib/paymentSync.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

const SECRET = "segredo-de-teste";

async function signature(dataId, requestId, timestamp = "1770000000") {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))
  );
  const value = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `ts=${timestamp},v1=${value}`;
}

async function webhookRequest(dataId, signatureValue, requestId = "request-1") {
  return new Request("https://loja.test/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": signatureValue
    },
    body: JSON.stringify({ type: "order", data: { id: dataId } })
  });
}

async function sendSignedWebhook(env, orderId, requestId = "request-1") {
  const signed = await signature(orderId, requestId);
  return webhook({
    request: await webhookRequest(orderId, signed, requestId),
    env
  });
}

function mockMercadoPagoOrder(t, orderData) {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(orderData));
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
}

function webhookDb() {
  const state = { updates: [], stockChecks: 0 };
  const DB = fakeDb(sql => {
    if (sql.includes("WHERE mp_order_id = ? OR mp_payment_id = ?")) {
      return { first: () => ({ id: 7, mp_order_id: "order-7" }) };
    }
    if (sql.includes("UPDATE pedidos SET") && sql.includes("mp_order_id = COALESCE")) {
      return {
        run: statement => {
          state.updates.push(statement.args);
          return { meta: { changes: 1 } };
        }
      };
    }
    if (sql.includes("SELECT id, status_pagamento, estoque_baixado_em")) {
      return {
        first: () => {
          state.stockChecks++;
          return { id: 7, status_pagamento: "PAGO", estoque_baixado_em: "2026-08-23" };
        }
      };
    }
    return {};
  });
  return { DB, state };
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
      estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
      estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque),
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

  return {
    raw: db,
    prepare(sql) {
      return {
        sql,
        bind(...args) {
          this.args = args;
          return this;
        },
        first() {
          const stmt = db.prepare(sql);
          return stmt.get(...(this.args || [])) || null;
        },
        all() {
          const stmt = db.prepare(sql);
          return { results: stmt.all(...(this.args || [])) };
        },
        run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...(this.args || []));
          return {
            success: true,
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
          };
        }
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) {
          results.push(s.run());
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

function seedPedido(
  db,
  {
    id,
    status_pagamento = "PENDENTE",
    mp_status = null,
    mp_status_detail = null,
    pago_em = null,
    estoque_baixado_em = null,
    estoque = 5,
    quantidade = 2
  }
) {
  db.raw.exec(`
    INSERT INTO produtos (id, nome, preco_centavos, estoque, atualizado_em)
    VALUES (1, 'Bolo de Teste', 1500, ${estoque}, CURRENT_TIMESTAMP);

    INSERT INTO pedidos (
      id, token_publico, produto_id, produto_nome, quantidade,
      valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
      idempotency_key, mp_order_id, status_pagamento, mp_status, mp_status_detail,
      pago_em, estoque_baixado_em
    ) VALUES (
      ${id}, 'token-${id}', 1, 'Bolo de Teste', ${quantidade},
      1500, ${1500 * quantidade}, 'Cliente Teste', 'cliente@example.com',
      'idemp-${id}', 'order-${id}', '${status_pagamento}',
      ${mp_status ? `'${mp_status}'` : "NULL"},
      ${mp_status_detail ? `'${mp_status_detail}'` : "NULL"},
      ${pago_em ? `'${pago_em}'` : "NULL"},
      ${estoque_baixado_em ? `'${estoque_baixado_em}'` : "NULL"}
    );

    INSERT INTO pedido_itens (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos, estoque_baixado_em)
    VALUES (${id}, 1, 'Bolo de Teste', ${quantidade}, 1500, ${1500 * quantidade}, ${estoque_baixado_em ? `'${estoque_baixado_em}'` : "NULL"});
  `);
}

test("webhook aprovado sincroniza pagamento sem confiar no payload", async t => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(url, "https://api.mercadopago.com/v1/orders/order-7");
    return new Response(
      JSON.stringify({
        id: "order-7",
        status: "processed",
        status_detail: "accredited",
        transactions: { payments: [{ id: "payment-7" }] }
      })
    );
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const { DB, state } = webhookDb();
  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "token-de-teste", MP_WEBHOOK_SECRET: SECRET },
    "order-7",
    "request-1"
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
  assert.equal(calls, 1);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0][1], "PAGO");
  assert.equal(state.updates[0][3], "processed");
  assert.equal(state.updates[0][4], "accredited");
  assert.equal(state.updates[0][5], "payment-7");
  assert.equal(state.stockChecks, 1);
  assert.equal(DB.batches.length, 0);
});

test("webhook duplicado não força nova baixa de estoque", async t => {
  mockMercadoPagoOrder(t, {
    id: "order-7",
    status: "processed",
    transactions: { payments: [{ id: "payment-7" }] }
  });

  const { DB, state } = webhookDb();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await sendSignedWebhook(
      { DB, MP_ACCESS_TOKEN: "token-de-teste", MP_WEBHOOK_SECRET: SECRET },
      "order-7",
      "request-1"
    );
    assert.equal(response.status, 200);
  }

  assert.equal(state.stockChecks, 2);
  assert.equal(DB.batches.length, 0);
});

test("webhook rejeita assinatura inválida sem consultar Mercado Pago", async t => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("fetch não deveria ser chamado");
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const response = await webhook({
    request: await webhookRequest("order-7", "ts=1,v1=invalida"),
    env: { DB: fakeDb(() => ({})), MP_ACCESS_TOKEN: "token", MP_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("falha transitória do Mercado Pago retorna 502 para permitir retry", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("indisponível", { status: 503 });
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const { DB, state } = webhookDb();
  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "token", MP_WEBHOOK_SECRET: SECRET },
    "order-7",
    "request-1"
  );
  assert.equal(response.status, 502);
  assert.equal(state.updates.length, 0);
});

test("reconciliação recupera pedido pago com estoque pendente", async t => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Mercado Pago não deveria ser consultado");
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const itens = [
    { id: 10, produto_id: 1, produto_nome: "Bolo", quantidade: 2 },
    { id: 11, produto_id: 2, produto_nome: "Pudim", quantidade: 1 }
  ];
  const DB = fakeDb(sql => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
    }
    if (sql.includes("status_pagamento = 'PENDENTE'")) return { all: () => ({ results: [] }) };
    if (sql.includes("status_pagamento = 'PAGO'") && sql.includes("estoque_baixado_em IS NULL")) {
      return { all: () => ({ results: [{ id: 9 }] }) };
    }
    if (sql.includes("SELECT id, status_pagamento, estoque_baixado_em")) {
      return { first: () => ({ id: 9, status_pagamento: "PAGO", estoque_baixado_em: null }) };
    }
    if (sql.includes("SELECT id, produto_id, produto_nome, quantidade")) {
      return { all: () => ({ results: itens }) };
    }
    if (sql.includes("SELECT MIN(i.id)")) return { first: () => null };
    if (sql.includes("FROM pedidos ORDER BY")) return { all: () => ({ results: [] }) };
    if (sql.includes("FROM pedido_itens") && sql.includes("pedido_id IN")) {
      return { all: () => ({ results: [] }) };
    }
    return {};
  });

  const response = await adminOrders({
    request: new Request("https://loja.test/api/admin/orders", {
      headers: { Cookie: "rp_admin_session=sessao" }
    }),
    env: { DB }
  });

  assert.equal(response.status, 200);
  assert.equal(DB.batches.length, 1);
  assert.equal(DB.batches[0].length, itens.length * 2 + 1);
});

// =========================================================================
// TESTES OBRIGATÓRIOS DA ETAPA 1 (BLINDAGEM CONTRA REGRESSÃO DE STATUS PAGO)
// =========================================================================

test("Caso 1: PENDENTE + processed -> status atualiza normalmente para PAGO e baixa estoque", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, { id: 101, status_pagamento: "PENDENTE", estoque: 5, quantidade: 2 });
  mockMercadoPagoOrder(t, {
    id: "order-101",
    status: "processed",
    status_detail: "accredited",
    transactions: { payments: [{ id: "pay-101" }] }
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-101",
    "req-101"
  );
  assert.equal(response.status, 200);

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_status_detail, pago_em, estoque_baixado_em FROM pedidos WHERE id = 101"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO");
  assert.equal(row.mp_status, "processed");
  assert.equal(row.mp_status_detail, "accredited");
  assert.ok(row.pago_em);
  assert.ok(row.estoque_baixado_em);

  const prod = DB.raw.prepare("SELECT estoque FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque, 3); // 5 - 2 = 3
});

test("Caso 2: PAGO + expired (evento atrasado) -> NÃO regride e permanece PAGO (atualiza mp_status bruto)", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 102,
    status_pagamento: "PAGO",
    mp_status: "processed",
    pago_em: "2026-08-23 10:00:00",
    estoque_baixado_em: "2026-08-23 10:00:01"
  });
  mockMercadoPagoOrder(t, {
    id: "order-102",
    status: "expired",
    status_detail: "expired_by_time",
    transactions: { payments: [] }
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-102",
    "req-102"
  );
  assert.equal(response.status, 200);

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_status_detail, pago_em FROM pedidos WHERE id = 102"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO"); // status financeiro protegido contra regressão
  assert.equal(row.mp_status, "expired"); // metadados brutos registram o último evento observado
  assert.equal(row.mp_status_detail, "expired_by_time");
  assert.equal(row.pago_em, "2026-08-23 10:00:00"); // pago_em preservado
});

test("Caso 3: PAGO + canceled (evento atrasado) -> NÃO regride e permanece PAGO (atualiza mp_status bruto)", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 103,
    status_pagamento: "PAGO",
    mp_status: "processed",
    pago_em: "2026-08-23 11:00:00"
  });
  mockMercadoPagoOrder(t, {
    id: "order-103",
    status: "canceled",
    status_detail: "by_collector"
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-103",
    "req-103"
  );
  assert.equal(response.status, 200);

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_status_detail, pago_em FROM pedidos WHERE id = 103"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO"); // status financeiro protegido
  assert.equal(row.mp_status, "canceled"); // metadados brutos registram último evento
  assert.equal(row.mp_status_detail, "by_collector");
  assert.equal(row.pago_em, "2026-08-23 11:00:00");
});

test("Caso 4: PAGO + failed (evento atrasado) -> NÃO regride e permanece PAGO (atualiza mp_status bruto)", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 104,
    status_pagamento: "PAGO",
    mp_status: "processed",
    pago_em: "2026-08-23 12:00:00"
  });
  mockMercadoPagoOrder(t, {
    id: "order-104",
    status: "failed",
    status_detail: "rejected"
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-104",
    "req-104"
  );
  assert.equal(response.status, 200);

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_status_detail, pago_em FROM pedidos WHERE id = 104"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO"); // status financeiro protegido
  assert.equal(row.mp_status, "failed"); // metadados brutos registram último evento
  assert.equal(row.mp_status_detail, "rejected");
});

test("Caso 5: PAGO + processed repetido -> continua PAGO, sem dupla baixa de estoque e sem push duplicado", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 105,
    status_pagamento: "PAGO",
    estoque: 10,
    quantidade: 2,
    pago_em: "2026-08-23 13:00:00",
    estoque_baixado_em: "2026-08-23 13:00:01"
  });
  DB.raw.exec("INSERT INTO push_eventos (pedido_id) VALUES (105);");

  const oldFetch = globalThis.fetch;
  let pushCalls = 0;
  globalThis.fetch = async url => {
    if (url.includes("mercadopago.com")) {
      return new Response(
        JSON.stringify({
          id: "order-105",
          status: "processed",
          transactions: { payments: [{ id: "pay-105" }] }
        })
      );
    }
    pushCalls++;
    return new Response("", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-105",
    "req-105"
  );
  assert.equal(response.status, 200);

  const row = DB.raw.prepare("SELECT status_pagamento, pago_em FROM pedidos WHERE id = 105").get();
  assert.equal(row.status_pagamento, "PAGO");
  assert.equal(row.pago_em, "2026-08-23 13:00:00");

  const prod = DB.raw.prepare("SELECT estoque FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque, 10); // não baixou estoque novamente
  assert.equal(pushCalls, 0); // não enviou push duplicado
});

test("Caso 6: polling com estado obsoleto após confirmação PAGO não causa regressão", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, { id: 106, status_pagamento: "PENDENTE", estoque: 5, quantidade: 1 });
  DB.raw.exec(
    "UPDATE pedidos SET token_publico = '123e4567-e89b-12d3-a456-426614174106' WHERE id = 106"
  );

  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  // 1. Confirmação PAGO via webhook
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "order-106",
        status: "processed",
        status_detail: "accredited",
        transactions: { payments: [{ id: "pay-106" }] }
      })
    );

  const webhookResp = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-106",
    "req-106"
  );
  assert.equal(webhookResp.status, 200);

  // 2. Polling subsequente com resposta defasada/obsoleta do MP ("opened" / PENDENTE)
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "order-106",
        status: "opened",
        status_detail: "waiting_transfer"
      })
    );

  const pollingResp = await getPublicOrder({
    params: { token: "123e4567-e89b-12d3-a456-426614174106" },
    env: { DB, MP_ACCESS_TOKEN: "mp-token" }
  });
  assert.equal(pollingResp.status, 200);
  const pollingBody = await responseJson(pollingResp);

  // O status consolidado final no banco e na resposta do polling NÃO regride e permanece PAGO
  assert.equal(pollingBody.pedido.status, "PAGO");
  const row = DB.raw.prepare("SELECT status_pagamento FROM pedidos WHERE id = 106").get();
  assert.equal(row.status_pagamento, "PAGO");
});

test("Caso 7: Reembolso legítimo: PAGO -> REEMBOLSADO transiciona corretamente", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 107,
    status_pagamento: "PAGO",
    pago_em: "2026-08-23 14:00:00",
    estoque_baixado_em: "2026-08-23 14:00:01"
  });
  mockMercadoPagoOrder(t, {
    id: "order-107",
    status: "refunded",
    status_detail: "refunded",
    transactions: { payments: [{ id: "pay-107" }] }
  });

  const response = await sendSignedWebhook(
    { DB, MP_ACCESS_TOKEN: "mp-token", MP_WEBHOOK_SECRET: SECRET },
    "order-107",
    "req-107"
  );
  assert.equal(response.status, 200);

  const row = DB.raw
    .prepare("SELECT status_pagamento, mp_status, pago_em FROM pedidos WHERE id = 107")
    .get();
  assert.equal(row.status_pagamento, "REEMBOLSADO");
  assert.equal(row.mp_status, "refunded");
  assert.equal(row.pago_em, "2026-08-23 14:00:00"); // pago_em preservado
});

// =========================================================================
// TESTES UNITÁRIOS DO SERVIÇO CENTRALIZADO (functions/lib/paymentSync.js)
// =========================================================================

test("syncOrderPayment: transiciona PENDENTE para PAGO, baixa estoque e preenche pago_em", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, { id: 201, status_pagamento: "PENDENTE", estoque: 5, quantidade: 2 });

  const result = await syncOrderPayment(
    { DB },
    {
      pedidoId: 201,
      order: {
        id: "order-201",
        status: "processed",
        status_detail: "accredited",
        transactions: { payments: [{ id: "pay-201" }] }
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status_pagamento, "PAGO");
  assert.equal(result.mp_status, "processed");
  assert.equal(result.mp_status_detail, "accredited");
  assert.ok(result.pago_em);

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_payment_id, estoque_baixado_em FROM pedidos WHERE id = 201"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO");
  assert.equal(row.mp_status, "processed");
  assert.equal(row.mp_payment_id, "pay-201");
  assert.ok(row.estoque_baixado_em);

  const prod = DB.raw.prepare("SELECT estoque FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque, 3); // 5 - 2 = 3
});

test("syncOrderPayment: protege PAGO contra regressão para CANCELADO/EXPIRADO e NÃO aciona pipeline pós-pagamento", async t => {
  const DB = createRealSqliteDb();
  // Pedido já pago, estoque inicial do produto = 5 (com estoque_baixado_em ainda NULL para provar que a baixa não é disparada)
  seedPedido(DB, {
    id: 202,
    status_pagamento: "PAGO",
    mp_status: "processed",
    pago_em: "2026-08-23 10:00:00",
    estoque: 5,
    quantidade: 2
  });

  const oldFetch = globalThis.fetch;
  let pushCalls = 0;
  globalThis.fetch = async () => {
    pushCalls++;
    return new Response("", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
  });

  const result = await syncOrderPayment(
    {
      DB,
      VAPID_PUBLIC_KEY:
        "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-Skv6_yViEuiBIa-Ib9-Skv6_yViEuiBIa-Ib9-Skv6_yViEuiBIa8",
      VAPID_PRIVATE_KEY: "segredo-vapid"
    },
    {
      pedidoId: 202,
      order: {
        id: "order-202",
        status: "expired",
        status_detail: "expired_by_time",
        transactions: { payments: [] }
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status_pagamento, "PAGO");
  assert.equal(result.mp_status, "expired");
  assert.equal(result.mp_status_detail, "expired_by_time");
  assert.equal(result.pago_em, "2026-08-23 10:00:00");

  const row = DB.raw
    .prepare(
      "SELECT status_pagamento, mp_status, mp_status_detail, pago_em, estoque_baixado_em FROM pedidos WHERE id = 202"
    )
    .get();
  assert.equal(row.status_pagamento, "PAGO");
  assert.equal(row.mp_status, "expired");
  assert.equal(row.mp_status_detail, "expired_by_time");
  assert.equal(row.pago_em, "2026-08-23 10:00:00");
  assert.equal(row.estoque_baixado_em, null); // NÃO acionou baixa de estoque

  const prod = DB.raw.prepare("SELECT estoque FROM produtos WHERE id = 1").get();
  assert.equal(prod.estoque, 5); // Estoque permaneceu inalterado (5)
  assert.equal(pushCalls, 0); // Push NÃO foi disparado
});

test("syncOrderPayment: transiciona PAGO para REEMBOLSADO", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, {
    id: 203,
    status_pagamento: "PAGO",
    mp_status: "processed",
    pago_em: "2026-08-23 10:00:00",
    estoque_baixado_em: "2026-08-23 10:00:01"
  });

  const result = await syncOrderPayment(
    { DB },
    {
      pedidoId: 203,
      order: {
        id: "order-203",
        status: "refunded",
        status_detail: "refunded",
        transactions: { payments: [{ id: "pay-203" }] }
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status_pagamento, "REEMBOLSADO");
  assert.equal(result.mp_status, "refunded");
  assert.equal(result.pago_em, "2026-08-23 10:00:00");

  const row = DB.raw
    .prepare("SELECT status_pagamento, mp_status, pago_em FROM pedidos WHERE id = 203")
    .get();
  assert.equal(row.status_pagamento, "REEMBOLSADO");
  assert.equal(row.mp_status, "refunded");
  assert.equal(row.pago_em, "2026-08-23 10:00:00");
});

test("syncOrderPayment: utiliza fallback mpOrderId quando order.id está ausente no objeto", async t => {
  const DB = createRealSqliteDb();
  seedPedido(DB, { id: 204, status_pagamento: "PENDENTE" });

  const result = await syncOrderPayment(
    { DB },
    {
      pedidoId: 204,
      order: {
        status: "processed",
        status_detail: "accredited",
        transactions: { payments: [{ id: "pay-204" }] }
      },
      mpOrderId: "order-fallback-204"
    }
  );

  assert.equal(result.ok, true);
  const row = DB.raw
    .prepare("SELECT mp_order_id, status_pagamento FROM pedidos WHERE id = 204")
    .get();
  assert.equal(row.mp_order_id, "order-fallback-204");
  assert.equal(row.status_pagamento, "PAGO");
});
