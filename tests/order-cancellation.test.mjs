import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as cancelOrder } from "../functions/api/orders/[token]/cancel.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

const token = "123e4567-e89b-12d3-a456-426614174000";

function request() {
  return new Request(`https://loja.test/api/orders/${token}/cancel`, {
    method: "POST",
    headers: { Origin: "https://loja.test" }
  });
}

function mpResponse(status) {
  return new Response(
    JSON.stringify({
      id: "mp-order-7",
      status,
      status_detail: status,
      transactions: {
        payments: [
          {
            id: "mp-payment-7",
            status,
            payment_method: { id: "pix", type: "bank_transfer" }
          }
        ]
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function cancellationDb(initialStatus = "PENDENTE") {
  let status = initialStatus;
  const db = fakeDb(sql => {
    if (sql.includes("WHERE token_publico = ?")) {
      return {
        first: () => ({
          id: 7,
          token_publico: token,
          status_pagamento: status,
          mp_order_id: "mp-order-7"
        })
      };
    }
    if (sql.includes("SELECT status_pagamento FROM pedidos WHERE id")) {
      return { first: () => ({ status_pagamento: status }) };
    }
    if (sql.includes("UPDATE pedidos SET") && sql.includes("mp_order_id = COALESCE")) {
      return {
        run: statement => {
          status = statement.args[2];
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
    if (sql.includes("SELECT status_pagamento, mp_status, mp_status_detail, pago_em")) {
      return {
        first: () => ({
          status_pagamento: status,
          mp_status:
            status === "PAGO"
              ? "processed"
              : status === "CANCELADO"
                ? "canceled"
                : "action_required",
          mp_status_detail: null,
          pago_em: status === "PAGO" ? "2026-08-29 20:00:00" : null
        })
      };
    }
    if (sql.includes("SELECT id, status_pagamento, estoque_baixado_em, reserva_status")) {
      return {
        first: () => ({
          id: 7,
          status_pagamento: status,
          estoque_baixado_em: status === "PAGO" ? "2026-08-29 20:00:00" : null,
          reserva_status: "LIBERADA"
        })
      };
    }
    if (sql.includes("SELECT id, status_pagamento, reserva_status")) {
      return { first: () => ({ id: 7, status_pagamento: status, reserva_status: "LIBERADA" }) };
    }
    return {};
  });
  return { db, status: () => status };
}

test("cancela Pix pendente no Mercado Pago", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return String(url).endsWith("/cancel") ? mpResponse("canceled") : mpResponse("action_required");
  };

  const memory = cancellationDb();
  const response = await cancelOrder({
    request: request(),
    params: { token },
    env: { DB: memory.db, MP_ACCESS_TOKEN: "test-token" }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.pedido.status, "CANCELADO");
  assert.deepEqual(
    calls.map(call => call.method),
    ["GET", "POST"]
  );
  assert.equal(memory.status(), "CANCELADO");
});

test("cancelamento repetido não chama o Mercado Pago novamente", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return mpResponse("canceled");
  };

  const memory = cancellationDb("CANCELADO");
  const response = await cancelOrder({
    request: request(),
    params: { token },
    env: { DB: memory.db, MP_ACCESS_TOKEN: "test-token" }
  });

  assert.equal(response.status, 200);
  assert.equal(fetchCalls, 0);
});

test("pagamento confirmado antes do cancelamento vence a corrida", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return mpResponse("processed");
  };

  const memory = cancellationDb();
  const response = await cancelOrder({
    request: request(),
    params: { token },
    env: { DB: memory.db, MP_ACCESS_TOKEN: "test-token" }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /pagamento já foi confirmado/i);
  assert.deepEqual(
    calls.map(call => call.method),
    ["GET"]
  );
  assert.equal(memory.status(), "PAGO");
});
