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
