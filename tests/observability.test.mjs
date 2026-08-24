import test from "node:test";
import assert from "node:assert/strict";
import { logEvent } from "../functions/lib/logger.js";

function captureConsoleOutput(fn) {
  const logs = { log: [], warn: [], error: [] };
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args) => logs.log.push(args.join(" "));
  console.warn = (...args) => logs.warn.push(args.join(" "));
  console.error = (...args) => logs.error.push(args.join(" "));

  try {
    const result = fn();
    return { result, logs };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

test("1. Campo permitido escalar é emitido", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("info", "payment.paid", {
      pedido_id: 101,
      mp_order_id: "order-999",
      status: "PAGO",
      mp_status: "processed",
      http_status: 200,
      reason: "MP_OK",
      attempts: 1,
      retry_after: 0,
      reservation_status: "CONVERTIDA",
      quantity: 3,
      product_id: 5,
      duration_ms: 150,
      action: "CONVERT",
      error_message: "Success"
    })
  );

  assert.equal(result.pedido_id, 101);
  assert.equal(result.mp_order_id, "order-999");
  assert.equal(result.status, "PAGO");
  assert.equal(result.mp_status, "processed");
  assert.equal(result.http_status, 200);
  assert.equal(result.reason, "MP_OK");
  assert.equal(result.attempts, 1);
  assert.equal(result.retry_after, 0);
  assert.equal(result.reservation_status, "CONVERTIDA");
  assert.equal(result.quantity, 3);
  assert.equal(result.product_id, 5);
  assert.equal(result.duration_ms, 150);
  assert.equal(result.action, "CONVERT");
  assert.equal(result.error_message, "Success");

  assert.equal(logs.log.length, 1);
  const json = JSON.parse(logs.log[0]);
  assert.equal(json.pedido_id, 101);
});

test("2. Campo desconhecido é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("info", "test.unknown", {
      pedido_id: 102,
      foo: "bar",
      custom_flag: true
    })
  );

  assert.equal(result.pedido_id, 102);
  assert.equal(result.foo, undefined);
  assert.equal(result.custom_flag, undefined);
  assert.equal(logs.log[0].includes("foo"), false);
});

test("3. Objeto aninhado é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("warn", "test.event", {
      pedido_id: 103,
      custom_nested_data: { a: 1, b: 2 }
    })
  );

  assert.equal(result.pedido_id, 103);
  assert.equal(result.custom_nested_data, undefined);
  assert.equal(logs.warn[0].includes("custom_nested_data"), false);
});

test("4. Array é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.array", {
      pedido_id: 104,
      items: [1, 2, 3]
    })
  );

  assert.equal(result.pedido_id, 104);
  assert.equal(result.items, undefined);
  assert.equal(logs.error[0].includes("items"), false);
});

test("5. MP_ACCESS_TOKEN é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.secret", { pedido_id: 105, MP_ACCESS_TOKEN: "SECRET_TOKEN_VALUE" })
  );
  assert.equal(result.MP_ACCESS_TOKEN, undefined);
  assert.equal(logs.error[0].includes("SECRET_TOKEN_VALUE"), false);
});

test("6. access_token é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.token", { pedido_id: 106, access_token: "BEARER_XYZ" })
  );
  assert.equal(result.access_token, undefined);
  assert.equal(logs.error[0].includes("BEARER_XYZ"), false);
});

test("7. secret é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.secret", { pedido_id: 107, secret: "MY_SECRET_KEY" })
  );
  assert.equal(result.secret, undefined);
  assert.equal(logs.error[0].includes("MY_SECRET_KEY"), false);
});

test("8. token é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.token", { pedido_id: 108, token: "AUTH_TOKEN_XYZ" })
  );
  assert.equal(result.token, undefined);
  assert.equal(logs.error[0].includes("AUTH_TOKEN_XYZ"), false);
});

test("9. authorization é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.auth", { pedido_id: 109, authorization: "Bearer xyz" })
  );
  assert.equal(result.authorization, undefined);
  assert.equal(logs.error[0].includes("Bearer xyz"), false);
});

test("10. cookie é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.cookie", { pedido_id: 110, cookie: "session_id=123" })
  );
  assert.equal(result.cookie, undefined);
  assert.equal(logs.error[0].includes("session_id"), false);
});

test("11. qr_code é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.qr", { pedido_id: 111, qr_code: "00020126580014br.gov.bcb.pix" })
  );
  assert.equal(result.qr_code, undefined);
  assert.equal(logs.error[0].includes("00020126580014br"), false);
});

test("12. qr_code_base64 é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.qr_b64", { pedido_id: 112, qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAA" })
  );
  assert.equal(result.qr_code_base64, undefined);
  assert.equal(logs.error[0].includes("iVBORw0KGgoAAA"), false);
});

test("13. ticket_url é descartado", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.ticket", { pedido_id: 113, ticket_url: "https://mercadopago.com/ticket" })
  );
  assert.equal(result.ticket_url, undefined);
  assert.equal(logs.error[0].includes("mercadopago.com"), false);
});

test("14. email/cliente_email são descartados", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.email", { pedido_id: 114, email: "a@b.com", cliente_email: "c@d.com" })
  );
  assert.equal(result.email, undefined);
  assert.equal(result.cliente_email, undefined);
  assert.equal(logs.error[0].includes("a@b.com"), false);
  assert.equal(logs.error[0].includes("c@d.com"), false);
});

test("15. whatsapp/cliente_whatsapp são descartados", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.phone", { pedido_id: 115, whatsapp: "(33) 99999-0000", cliente_whatsapp: "(33) 98888-0000" })
  );
  assert.equal(result.whatsapp, undefined);
  assert.equal(result.cliente_whatsapp, undefined);
  assert.equal(logs.error[0].includes("99999-0000"), false);
  assert.equal(logs.error[0].includes("98888-0000"), false);
});

test("16. payer/body/raw são descartados", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.raw", {
      pedido_id: 116,
      payer: { name: "John" },
      body: { amount: 1000 },
      raw: "raw_string"
    })
  );
  assert.equal(result.payer, undefined);
  assert.equal(result.body, undefined);
  assert.equal(result.raw, undefined);
  assert.equal(logs.error[0].includes("raw_string"), false);
  assert.equal(logs.error[0].includes("John"), false);
});

test("17. err.data ou estrutura equivalente é descartada", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "test.err_data", {
      pedido_id: 117,
      "err.data": { card: "1234" },
      data: { error_detail: "gateway_fault" },
      error: { stack: "error_trace" }
    })
  );
  assert.equal(result["err.data"], undefined);
  assert.equal(result.data, undefined);
  assert.equal(result.error, undefined);
  assert.equal(logs.error[0].includes("gateway_fault"), false);
  assert.equal(logs.error[0].includes("error_trace"), false);
});

test("18. String de campo permitido respeita limite máximo", () => {
  const longReason = "R".repeat(300);
  const { result } = captureConsoleOutput(() =>
    logEvent("warn", "test.limit", {
      pedido_id: 118,
      reason: longReason
    })
  );
  assert.equal(result.reason.length, 200);
  assert.equal(result.reason, "R".repeat(200));
});

test("19. logEvent retorna o mesmo payload seguro que envia ao console", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("info", "test.return", {
      pedido_id: 119,
      status: "PENDENTE",
      secret_field: "SHOULD_BE_IGNORED"
    })
  );
  const jsonFromConsole = JSON.parse(logs.log[0]);
  assert.deepEqual(result, jsonFromConsole);
  assert.equal(result.secret_field, undefined);
});

test("20. Nível info usa console.log", () => {
  const { logs } = captureConsoleOutput(() => logEvent("info", "test.info", { pedido_id: 120 }));
  assert.equal(logs.log.length, 1);
  assert.equal(logs.warn.length, 0);
  assert.equal(logs.error.length, 0);
});

test("21. Nível warn usa console.warn", () => {
  const { logs } = captureConsoleOutput(() => logEvent("warn", "test.warn", { pedido_id: 121 }));
  assert.equal(logs.log.length, 0);
  assert.equal(logs.warn.length, 1);
  assert.equal(logs.error.length, 0);
});

test("22. Nível error usa console.error", () => {
  const { logs } = captureConsoleOutput(() => logEvent("error", "test.error", { pedido_id: 122 }));
  assert.equal(logs.log.length, 0);
  assert.equal(logs.warn.length, 0);
  assert.equal(logs.error.length, 1);
});

test("23. Teste Adversarial Exato da Especificação", () => {
  const { result, logs } = captureConsoleOutput(() =>
    logEvent("error", "teste", {
      pedido_id: 123,
      qr_code: "SEGREDO",
      cliente_email: "cliente@example.com",
      nested: {
        authorization: "Bearer SECRET",
        token: "SECRET"
      }
    })
  );

  assert.equal(result.lvl, "error");
  assert.equal(result.event, "teste");
  assert.equal(result.pedido_id, 123);
  assert.equal(Object.keys(result).length, 4); // ts, lvl, event, pedido_id

  const emitted = logs.error[0];
  assert.equal(emitted.includes("SEGREDO"), false);
  assert.equal(emitted.includes("cliente@example.com"), false);
  assert.equal(emitted.includes("SECRET"), false);
  assert.equal(emitted.includes("nested"), false);
  assert.equal(emitted.includes("authorization"), false);
});

test("24. Webhook inválido chama webhook.invalid_signature e não vaza payload", async () => {
  const { onRequestPost: webhookHandler } = await import("../functions/api/webhooks/mercadopago.js");
  const request = new Request("https://loja.test/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": "ts=123,v1=invalida",
      "x-request-id": "req-1"
    },
    body: JSON.stringify({ type: "order", data: { id: "999" }, sensitive_customer: "secret@email.com" })
  });

  const env = { MP_WEBHOOK_SECRET: "chave-webhook" };
  const { logs } = captureConsoleOutput(() => {
    // Synchronously capture logs triggered by the promise
  });

  const logsCaptured = { warn: [], error: [], log: [] };
  const origWarn = console.warn;
  console.warn = (...args) => logsCaptured.warn.push(args.join(" "));
  try {
    const res = await webhookHandler({ request, env });
    assert.equal(res.status, 401);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(logsCaptured.warn.length, 1);
  const json = JSON.parse(logsCaptured.warn[0]);
  assert.equal(json.event, "webhook.invalid_signature");
  assert.equal(json.http_status, 401);
  assert.equal(json.reason, "HMAC_MISMATCH");
  assert.equal(json.pedido_id, undefined);
  assert.equal(logsCaptured.warn[0].includes("secret@email.com"), false);
});

test("25. Webhook com erro não loga err.data", async () => {
  const { onRequestPost: webhookHandler } = await import("../functions/api/webhooks/mercadopago.js");
  const request = new Request("https://loja.test/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": "ts=123,v1=invalida",
      "x-request-id": "req-2"
    },
    body: JSON.stringify({ type: "order", data: { id: "999" } })
  });

  const env = { MP_WEBHOOK_SECRET: null }; // Força erro de configuração
  const logsCaptured = { error: [] };
  const origError = console.error;
  console.error = (...args) => logsCaptured.error.push(args.join(" "));

  try {
    const res = await webhookHandler({ request, env });
    assert.equal(res.status, 503);
  } finally {
    console.error = origError;
  }

  assert.equal(logsCaptured.error.length, 1);
  const json = JSON.parse(logsCaptured.error[0]);
  assert.equal(json.event, "webhook.error");
  assert.equal(json.http_status, 503);
  assert.equal(json.data, undefined);
  assert.equal(json["err.data"], undefined);
});

import { fakeDb } from "./helpers/fake-db.mjs";

test("26. Rate limit gera checkout.rate_limited com 429 e retry_after", async () => {
  const { onRequestPost: checkoutHandler } = await import("../functions/api/checkout/pix.js");
  const request = new Request("https://loja.test/api/checkout/pix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://loja.test",
      "cf-connecting-ip": "198.51.100.1"
    },
    body: JSON.stringify({
      nome: "Teste",
      email: "teste@email.com",
      whatsapp: "3399999999",
      itens: [{ produto_id: 1, quantidade: 1 }]
    })
  });

  const DB = fakeDb((sql) => {
    if (sql.includes("FROM produtos WHERE id IN")) {
      return {
        all: () => ({
          results: [{
            id: 1,
            nome: "Bolo",
            preco_centavos: 1000,
            disponivel: 1,
            ativo: 1,
            estoque: 10,
            estoque_reservado: 0
          }]
        })
      };
    }
    if (sql.includes("checkout_rate_limits")) {
      return { first: () => ({ tentativas: 7 }) };
    }
    return {};
  });

  const env = {
    RATE_LIMIT_SECRET: "secret-key",
    MP_ACCESS_TOKEN: "mp-token",
    DB
  };

  const logsCaptured = { warn: [] };
  const origWarn = console.warn;
  console.warn = (...args) => logsCaptured.warn.push(args.join(" "));

  try {
    const res = await checkoutHandler({ request, env });
    assert.equal(res.status, 429);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(logsCaptured.warn.length, 1);
  const json = JSON.parse(logsCaptured.warn[0]);
  assert.equal(json.event, "checkout.rate_limited");
  assert.equal(json.http_status, 429);
  assert.equal(json.attempts, 7);
  assert.equal(typeof json.retry_after, "number");
});

test("27. Falha de conversão de estoque gera stock.conversion_failed com pedido_id", async () => {
  const { baixarEstoquePedido } = await import("../functions/lib/stock.js");

  const DB = fakeDb((sql) => {
    if (sql.includes("HAVING") || sql.includes("MIN(i.id)")) {
      return { first: () => ({ id: 1, produto_id: 10, quantidade: 2, estoque: 0, estoque_reservado: 0 }) };
    }
    if (sql.includes("FROM pedidos WHERE id = ?")) {
      return { first: () => ({ id: 50, status_pagamento: "PAGO", reserva_status: "ATIVA", estoque_baixado_em: null }) };
    }
    if (sql.includes("FROM pedido_itens")) {
      return { all: () => ({ results: [{ id: 1, produto_id: 10, produto_nome: "Bolo", quantidade: 2 }] }) };
    }
    return {};
  });

  const env = { DB };

  const logsCaptured = { error: [] };
  const origError = console.error;
  console.error = (...args) => logsCaptured.error.push(args.join(" "));

  try {
    const res = await baixarEstoquePedido(env, 50);
    assert.equal(res.ok, false);
  } finally {
    console.error = origError;
  }

  assert.equal(logsCaptured.error.length, 1);
  const json = JSON.parse(logsCaptured.error[0]);
  assert.equal(json.event, "stock.conversion_failed");
  assert.equal(json.pedido_id, 50);
  assert.equal(json.reason, "STOCK_CONVERSION_FAILED");
});

test("28. Liberação bem-sucedida gera stock.reservation_released", async () => {
  const { liberarReservaPedido } = await import("../functions/lib/stock.js");

  const DB = fakeDb((sql) => {
    if (sql.includes("HAVING") || sql.includes("MIN(i.id)")) {
      return { first: () => null };
    }
    if (sql.includes("FROM pedidos WHERE id = ?")) {
      return { first: () => ({ id: 51, status_pagamento: "PENDENTE", reserva_status: "ATIVA" }) };
    }
    if (sql.includes("FROM pedido_itens")) {
      return { all: () => ({ results: [{ id: 1, produto_id: 10, quantidade: 2 }] }) };
    }
    return {};
  }, async () => [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);

  const env = { DB };

  const logsCaptured = { log: [] };
  const origLog = console.log;
  console.log = (...args) => logsCaptured.log.push(args.join(" "));

  try {
    const res = await liberarReservaPedido(env, 51, { novoStatus: "EXPIRADO" });
    assert.equal(res.ok, true);
    assert.equal(res.liberado, true);
  } finally {
    console.log = origLog;
  }

  assert.equal(logsCaptured.log.length, 1);
  const json = JSON.parse(logsCaptured.log[0]);
  assert.equal(json.event, "stock.reservation_released");
  assert.equal(json.pedido_id, 51);
  assert.equal(json.reservation_status, "LIBERADA");
  assert.equal(json.status, "EXPIRADO");
});

test("29. Falha de liberação gera stock.reservation_failed", async () => {
  const { liberarReservaPedido } = await import("../functions/lib/stock.js");

  const DB = fakeDb((sql) => {
    if (sql.includes("HAVING") || sql.includes("MIN(i.id)")) {
      return { first: () => ({ id: 1, produto_id: 10, estoque_reservado: 0 }) };
    }
    if (sql.includes("FROM pedidos WHERE id = ?")) {
      return { first: () => ({ id: 52, status_pagamento: "PENDENTE", reserva_status: "ATIVA" }) };
    }
    if (sql.includes("FROM pedido_itens")) {
      return { all: () => ({ results: [{ id: 1, produto_id: 10, quantidade: 2 }] }) };
    }
    return {};
  });

  const env = { DB };

  const logsCaptured = { error: [] };
  const origError = console.error;
  console.error = (...args) => logsCaptured.error.push(args.join(" "));

  try {
    const res = await liberarReservaPedido(env, 52);
    assert.equal(res.ok, false);
  } finally {
    console.error = origError;
  }

  assert.equal(logsCaptured.error.length, 1);
  const json = JSON.parse(logsCaptured.error[0]);
  assert.equal(json.event, "stock.reservation_failed");
  assert.equal(json.pedido_id, 52);
  assert.equal(json.reason, "RESERVATION_RELEASE_FAILED");
});

test("30. push.failed não inclui body da resposta", async () => {
  const { notifyPaidOrder } = await import("../functions/lib/push.js");

  const DB = fakeDb((sql) => {
    if (sql.includes("FROM push_inscricoes")) {
      return { all: () => ({ results: [{ id: 1, endpoint: "https://push.test/sub", p256dh: "BMx", auth: "auth" }] }) };
    }
    if (sql.includes("FROM pedidos")) {
      return { first: () => ({ id: 53, status_pagamento: "PAGO", cliente_nome: "Maria", valor_total_centavos: 1000 }) };
    }
    if (sql.includes("INSERT OR IGNORE INTO push_eventos")) {
      return { run: () => ({ meta: { changes: 1 } }) };
    }
    return {};
  });

  const env = {
    VAPID_PUBLIC_KEY: "invalid_key",
    VAPID_PRIVATE_KEY: "invalid_key",
    DB
  };

  const logsCaptured = { warn: [] };
  const origWarn = console.warn;
  console.warn = (...args) => logsCaptured.warn.push(args.join(" "));

  try {
    await notifyPaidOrder(env, 53);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(logsCaptured.warn.length, 1);
  const json = JSON.parse(logsCaptured.warn[0]);
  assert.equal(json.event, "push.failed");
  assert.equal(json.pedido_id, 53);
  assert.equal(json.reason, "PUSH_FAILED");
});

test("31. PAGO real gera payment.paid", async () => {
  const { syncOrderPayment } = await import("../functions/lib/paymentSync.js");

  let estadoPedido = "PENDENTE";
  const DB = fakeDb((sql) => {
    if (sql.includes("SELECT status_pagamento FROM pedidos")) {
      return { first: () => ({ status_pagamento: estadoPedido }) };
    }
    if (sql.includes("UPDATE pedidos SET")) {
      estadoPedido = "PAGO";
      return { run: () => ({ meta: { changes: 1 } }) };
    }
    if (sql.includes("SELECT status_pagamento, mp_status")) {
      return { first: () => ({ status_pagamento: "PAGO", mp_status: "processed" }) };
    }
    return {};
  });

  const env = { DB };

  const logsCaptured = { log: [] };
  const origLog = console.log;
  console.log = (...args) => logsCaptured.log.push(args.join(" "));

  try {
    await syncOrderPayment(env, {
      pedidoId: 54,
      order: { id: "mp-54", status: "processed", status_detail: "accredited", transactions: { payments: [{ id: "p-54", status: "approved" }] } }
    });
  } finally {
    console.log = origLog;
  }

  const paidLogs = logsCaptured.log.filter(l => l.includes("payment.paid"));
  assert.equal(paidLogs.length, 1);
  const json = JSON.parse(paidLogs[0]);
  assert.equal(json.event, "payment.paid");
  assert.equal(json.pedido_id, 54);
  assert.equal(json.mp_order_id, "mp-54");
  assert.equal(json.status, "PAGO");
});

test("32. Webhook duplicado PAGO não gera payment.paid duplicado", async () => {
  const { syncOrderPayment } = await import("../functions/lib/paymentSync.js");

  // Pedido já está consolidado como PAGO
  const DB = fakeDb((sql) => {
    if (sql.includes("SELECT status_pagamento FROM pedidos")) {
      return { first: () => ({ status_pagamento: "PAGO" }) };
    }
    if (sql.includes("SELECT status_pagamento, mp_status")) {
      return { first: () => ({ status_pagamento: "PAGO", mp_status: "processed" }) };
    }
    return {};
  });

  const env = { DB };

  const logsCaptured = { log: [] };
  const origLog = console.log;
  console.log = (...args) => logsCaptured.log.push(args.join(" "));

  try {
    await syncOrderPayment(env, {
      pedidoId: 55,
      order: { id: "mp-55", status: "processed", status_detail: "accredited", transactions: { payments: [{ id: "p-55", status: "approved" }] } }
    });
  } finally {
    console.log = origLog;
  }

  const paidLogs = logsCaptured.log.filter(l => l.includes("payment.paid"));
  assert.equal(paidLogs.length, 0); // Não emite evento duplicado
});

test("33. Reconciliação de PAGO sem estoque gera reconciliation.recovered", async () => {
  const { onRequestGet: adminOrdersHandler } = await import("../functions/api/admin/orders/index.js");

  const request = new Request("https://loja.test/api/admin/orders", {
    headers: { Cookie: "rp_admin_session=test" }
  });

  const DB = fakeDb((sql) => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", username: "admin", ativo: 1, papel: "ADMIN" }) };
    }
    if (sql.includes("status_pagamento = 'PENDENTE'")) {
      return { all: () => ({ results: [] }) };
    }
    if (sql.includes("status_pagamento = 'PAGO'") && sql.includes("estoque_baixado_em IS NULL")) {
      return { all: () => ({ results: [{ id: 56 }] }) };
    }
    if (sql.includes("SELECT id, status_pagamento, estoque_baixado_em")) {
      return { first: () => ({ id: 56, status_pagamento: "PAGO", reserva_status: "ATIVA", estoque_baixado_em: null }) };
    }
    if (sql.includes("SELECT id, produto_id, produto_nome, quantidade")) {
      return { all: () => ({ results: [{ id: 1, produto_id: 10, produto_nome: "Bolo", quantidade: 1 }] }) };
    }
    if (sql.includes("SELECT MIN(i.id)")) {
      return { first: () => null };
    }
    if (sql.includes("FROM pedidos ORDER BY")) {
      return { all: () => ({ results: [] }) };
    }
    return {};
  }, async () => [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }]);

  const env = { DB };

  const logsCaptured = { log: [] };
  const origLog = console.log;
  console.log = (...args) => logsCaptured.log.push(args.join(" "));

  try {
    await adminOrdersHandler({ request, env });
  } finally {
    console.log = origLog;
  }

  const recoveredLogs = logsCaptured.log.filter(l => l.includes("reconciliation.recovered"));
  assert.equal(recoveredLogs.length, 1);
  const json = JSON.parse(recoveredLogs[0]);
  assert.equal(json.event, "reconciliation.recovered");
  assert.equal(json.pedido_id, 56);
  assert.equal(json.status, "PAGO");
});

