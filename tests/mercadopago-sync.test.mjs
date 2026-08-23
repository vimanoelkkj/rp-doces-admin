import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as webhook } from "../functions/api/webhooks/mercadopago.js";
import { onRequestGet as adminOrders } from "../functions/api/admin/orders/index.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

const SECRET = "segredo-de-teste";

async function signature(dataId, requestId, timestamp = "1770000000") {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)),
  );
  const value = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ts=${timestamp},v1=${value}`;
}

async function webhookRequest(dataId, signatureValue) {
  return new Request("https://loja.test/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "request-1",
      "x-signature": signatureValue,
    },
    body: JSON.stringify({ type: "order", data: { id: dataId } }),
  });
}

function webhookDb() {
  const state = { updates: [], stockChecks: 0 };
  const DB = fakeDb((sql) => {
    if (sql.includes("WHERE mp_order_id = ? OR mp_payment_id = ?")) {
      return { first: () => ({ id: 7, mp_order_id: "order-7" }) };
    }
    if (sql.includes("UPDATE pedidos SET") && sql.includes("mp_order_id = COALESCE")) {
      return { run: (statement) => { state.updates.push(statement.args); return { meta: { changes: 1 } }; } };
    }
    if (sql.includes("SELECT id, status_pagamento, estoque_baixado_em")) {
      return {
        first: () => {
          state.stockChecks++;
          return { id: 7, status_pagamento: "PAGO", estoque_baixado_em: "2026-08-23" };
        },
      };
    }
    return {};
  });
  return { DB, state };
}

test("webhook aprovado sincroniza pagamento sem confiar no payload", async (t) => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url, "https://api.mercadopago.com/v1/orders/order-7");
    return new Response(JSON.stringify({
      id: "order-7",
      status: "processed",
      status_detail: "accredited",
      transactions: { payments: [{ id: "payment-7" }] },
    }));
  };
  t.after(() => { globalThis.fetch = oldFetch; });

  const { DB, state } = webhookDb();
  const signed = await signature("order-7", "request-1");
  const response = await webhook({
    request: await webhookRequest("order-7", signed),
    env: { DB, MP_ACCESS_TOKEN: "token-de-teste", MP_WEBHOOK_SECRET: SECRET },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
  assert.equal(calls, 1);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0][1], "PAGO");
  assert.equal(state.updates[0][4], "payment-7");
  assert.equal(state.stockChecks, 1);
  assert.equal(DB.batches.length, 0);
});

test("webhook duplicado não força nova baixa de estoque", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "order-7",
    status: "processed",
    transactions: { payments: [{ id: "payment-7" }] },
  }));
  t.after(() => { globalThis.fetch = oldFetch; });

  const { DB, state } = webhookDb();
  const signed = await signature("order-7", "request-1");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await webhook({
      request: await webhookRequest("order-7", signed),
      env: { DB, MP_ACCESS_TOKEN: "token-de-teste", MP_WEBHOOK_SECRET: SECRET },
    });
    assert.equal(response.status, 200);
  }

  assert.equal(state.stockChecks, 2);
  assert.equal(DB.batches.length, 0);
});

test("webhook rejeita assinatura inválida sem consultar Mercado Pago", async (t) => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("fetch não deveria ser chamado"); };
  t.after(() => { globalThis.fetch = oldFetch; });

  const response = await webhook({
    request: await webhookRequest("order-7", "ts=1,v1=invalida"),
    env: { DB: fakeDb(() => ({})), MP_ACCESS_TOKEN: "token", MP_WEBHOOK_SECRET: SECRET },
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("falha transitória do Mercado Pago retorna 502 para permitir retry", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("indisponível", { status: 503 });
  t.after(() => { globalThis.fetch = oldFetch; });

  const { DB, state } = webhookDb();
  const signed = await signature("order-7", "request-1");
  const response = await webhook({
    request: await webhookRequest("order-7", signed),
    env: { DB, MP_ACCESS_TOKEN: "token", MP_WEBHOOK_SECRET: SECRET },
  });
  assert.equal(response.status, 502);
  assert.equal(state.updates.length, 0);
});

test("reconciliação recupera pedido pago com estoque pendente", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Mercado Pago não deveria ser consultado"); };
  t.after(() => { globalThis.fetch = oldFetch; });

  const itens = [
    { id: 10, produto_id: 1, produto_nome: "Bolo", quantidade: 2 },
    { id: 11, produto_id: 2, produto_nome: "Pudim", quantidade: 1 },
  ];
  const DB = fakeDb((sql) => {
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
      headers: { Cookie: "rp_admin_session=sessao" },
    }),
    env: { DB },
  });

  assert.equal(response.status, 200);
  assert.equal(DB.batches.length, 1);
  assert.equal(DB.batches[0].length, 1 + itens.length * 2 + 1);
});
