import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { app, fixture, state } from "./helpers/b3.mjs";

// Literal Orders wire fixtures, independent of production serializers/mappers.
const wire = () => ({
  id: "ORD101",
  type: "online",
  status: "processed",
  status_detail: "accredited",
  external_reference: "token",
  total_amount: "100.00",
  country_code: "BR",
  created_date: "2026-01-01T00:00:00Z",
  last_updated_date: "2026-01-01T00:01:00Z",
  transactions: {
    payments: [
      {
        id: "PAY101",
        status: "processed",
        status_detail: "accredited",
        amount: "100.00",
        paid_amount: "97.28",
        expiration_time: "PT30M",
        payment_method: {
          id: "pix",
          type: "bank_transfer",
          qr_code: "pix-code",
          qr_code_base64: "qr-image",
          ticket_url: "https://example.invalid/qr"
        }
      }
    ]
  }
});

test("checkout persists ORD and PAY atomically and keeps the public QR response pending", async t => {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM pedidos").run();
  await db
    .prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_itens','pedido_pagamentos')"
    )
    .run();
  let sent, wireKey;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.mercadopago.com/v1/orders");
    sent = JSON.parse(init.body);
    wireKey = init.headers["X-Idempotency-Key"];
    const order = wire();
    order.external_reference = sent.external_reference;
    order.status = order.transactions.payments[0].status = "action_required";
    order.status_detail = order.transactions.payments[0].status_detail = "waiting_transfer";
    return Response.json(order, { status: 201 });
  });
  const response = await app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { Origin: "https://local.test" },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 2 }],
        cliente: { nome: "Test", whatsapp: "11999999999" },
        operationKey: "A".repeat(128)
      })
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.qrCode, "pix-code");
  const row = await db
    .prepare("SELECT status,mp_order_id,mp_payment_id,mp_status FROM pedido_pagamentos")
    .first();
  assert.deepEqual(row, {
    status: "PENDENTE",
    mp_order_id: "ORD101",
    mp_payment_id: "PAY101",
    mp_status: "pending"
  });
  const operation = await db
    .prepare("SELECT mp_request,mp_idempotency_key FROM pedido_operacoes")
    .first();
  assert.deepEqual(JSON.parse(operation.mp_request), sent);
  assert.equal(wireKey, "616aba27aa2c1513daf8409c8d0ffa4fcde1b5684e8b5b1ab73480002363888a");
  assert.equal(operation.mp_idempotency_key, wireKey);
});

test("Order webhook: invalid signature has zero effects; duplicate/out-of-order GETs never regress paid stock", async t => {
  const db = await fixture(t);
  let order = wire();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(order);
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("orders-local-only"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("id:ORD101;request-id:orders;ts:1;")
    )
  ).toString("hex");
  const dispatch = signature =>
    app.webhook.onRequestPost({
      env: { DB: db, MP_ACCESS_TOKEN: "fake", MP_WEBHOOK_SECRET: "orders-local-only" },
      request: new Request(
        "https://local.test/api/webhooks/mercadopago?type=order&data.id=ORD101",
        {
          method: "POST",
          headers: { "x-request-id": "orders", "x-signature": `ts=1,v1=${signature}` },
          body: JSON.stringify({ type: "order", data: { id: "ORD101" }, status: "refunded" })
        }
      )
    });
  const before = await state(db);
  let effects = 0;
  db.hook = statements => {
    effects += statements.length;
    return statements;
  };
  assert.equal((await dispatch("bad")).status, 401);
  assert.equal(calls, 0);
  assert.equal(effects, 0);
  db.hook = null;
  assert.deepEqual(await state(db), before);
  for (let i = 0; i < 2; i++) assert.equal((await dispatch(signature)).status, 200);
  order = wire();
  order.status = order.transactions.payments[0].status = "action_required";
  order.status_detail = order.transactions.payments[0].status_detail = "waiting_transfer";
  assert.equal((await dispatch(signature)).status, 200);
  const after = await state(db);
  assert.equal(after.pagamentos[0].status, "PAGO");
  assert.equal(after.produtos[0].estoque, 8);
  assert.equal(after.produtos[0].estoque_reservado, 0);
  assert.equal(after.refunds.length, 0);
  assert.equal(calls, 3);
});

for (const cancelHttp of [200, 500])
  test(`suspended regeneration never reaches cancel HTTP ${cancelHttp} or creates B`, async t => {
    const db = await fixture(t);
    await db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN' WHERE id=1").run();
    let creations = 0;
    let gets = 0;
    let cancellations = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (String(url).endsWith("/cancel")) {
        cancellations++;
        return cancelHttp === 200
          ? Response.json({ id: "ORD101", status: "canceled" })
          : new Response("unavailable", { status: 500 });
      }
      if (init.method === "POST") {
        creations++;
        throw new Error("unsafe successor creation");
      }
      gets++;
      const order = wire();
      order.status = order.transactions.payments[0].status = "action_required";
      order.status_detail = order.transactions.payments[0].status_detail = "waiting_transfer";
      return Response.json(order);
    });
    const result = await app.pix.createAdminPixCharge(
      { DB: db, MP_ACCESS_TOKEN: "fake" },
      {
        pedidoId: 1,
        usuarioId: 1,
        valorCentavos: 10000,
        substituiId: 1,
        operationKey: `orders-cancel-${cancelHttp}`
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.erro, "PIX_REGENERACAO_SUSPENSA");
    assert.equal(gets, 0);
    assert.equal(cancellations, 0);
    assert.equal(creations, 0);
    assert.equal((await state(db)).pagamentos.length, 1);
  });

test("create body: decimal strings, one Pix, automatic processing and persisted reference", async () => {
  assert.deepEqual(
    await app.orderTypes.createPixOrderBody(1001, "reference", {
      email: "test@example.invalid"
    }),
    {
      type: "online",
      total_amount: "10.01",
      external_reference: "reference",
      processing_mode: "automatic",
      transactions: {
        payments: [
          {
            amount: "10.01",
            payment_method: { id: "pix", type: "bank_transfer" },
            expiration_time: "PT30M"
          }
        ]
      },
      payer: { email: "test@example.invalid" }
    }
  );
  for (const [cents, decimal] of [
    [1, "0.01"],
    [10, "0.10"],
    [100, "1.00"],
    [100001, "1000.01"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"]
  ]) {
    assert.equal(app.orderTypes.centsToDecimal(cents), decimal);
    assert.equal(app.orderTypes.decimalToCents(decimal), cents);
  }
  assert.equal(app.orderTypes.decimalToCents(1.01), null);
  assert.equal(app.orderTypes.decimalToCents("1.001"), null);
});

test("long operation identity: deterministic bounded reference without changing A1 key", async () => {
  const reference = `a1:pagamento:${"A".repeat(128)}`;
  const result = await app.orderTypes.orderExternalReference(reference);
  assert.match(result, /^[a-f0-9]{64}$/);
  assert.equal(await app.orderTypes.orderExternalReference(reference), result);
  assert.notEqual(await app.orderTypes.orderExternalReference(`${reference}B`), result);
  assert.equal(
    await app.orderTypes.orderExternalReference("a1:op-1:pag"),
    "e38bba82ac8714f843b30fdbd330160b209a3427ecd66bd880a935828b36c813"
  );
  assert.equal(await app.orderTypes.orderExternalReference("allowed_ABC-123"), "allowed_ABC-123");
  assert.equal(await app.orderTypes.orderIdempotencyKey("Z".repeat(128)), "Z".repeat(128));
});

for (const [status, detail, expected] of [
  ["action_required", "waiting_transfer", "PENDENTE"],
  ["processed", "accredited", "PAGO"],
  ["canceled", null, "CANCELADO"],
  ["expired", null, "EXPIRADO"],
  ["refunded", null, "REEMBOLSADO"],
  ["new_status", "accredited", null],
  ["processed", "unknown", null]
]) {
  test(`Orders status ${status}/${detail}: ${expected}`, () =>
    assert.equal(app.orderStatus.mapOrderStatus(status, detail), expected));
}

test("only GET confers unforgeable immutable authority; POST preserves QR and stable key", async t => {
  const db = await fixture(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url, init]);
    return Response.json(wire());
  });
  const created = await app.mpPost.postPagamentoMp("fake", "same-key", {});
  assert.equal(created.resultado, "SUCESSO");
  assert.equal(created.payment.order_id, "ORD101");
  assert.equal(created.payment.id, "PAY101");
  assert.equal(created.payment.point_of_interaction.transaction_data.qr_code, "pix-code");
  assert.equal(app.orders.isVerifiedMpOrder(created.payment), false);
  await assert.rejects(() => app.sync.syncPaymentFromMp(db, 1, created.payment), /NAO_VERIFICADA/);
  await app.mpPost.postPagamentoMp("fake", "same-key", {});
  assert.equal(calls[0][1].headers["X-Idempotency-Key"], "same-key");
  assert.equal(calls[1][1].headers["X-Idempotency-Key"], "same-key");
  const verified = await app.orders.fetchMpOrder("fake", "ORD101");
  assert.equal(calls[2][0], "https://api.mercadopago.com/v1/orders/ORD101");
  assert.equal(app.orders.isVerifiedMpOrder(verified), true);
  assert.equal(app.orders.isVerifiedMpOrder({ ...verified }), false);
  assert.throws(() => {
    verified.total_amount = "0.01";
  }, TypeError);
  assert.equal(verified.date_of_expiration, "2026-01-01T00:30:00.000Z");
  assert.equal(verified.paid_amount, "97.28");
  assert.equal((await app.sync.syncPaymentFromMp(db, 1, verified)).status, "PAGO");
});

for (const [label, change] of [
  [
    "total",
    o => {
      o.total_amount = "99.00";
    }
  ],
  [
    "amount",
    o => {
      o.transactions.payments[0].amount = "99.00";
    }
  ],
  [
    "reference",
    o => {
      o.external_reference = "different";
    }
  ],
  [
    "method",
    o => {
      o.transactions.payments[0].payment_method.id = "visa";
    }
  ],
  [
    "method type",
    o => {
      o.transactions.payments[0].payment_method.type = "credit_card";
    }
  ],
  [
    "country",
    o => {
      o.country_code = "US";
    }
  ],
  [
    "root status",
    o => {
      o.status = "unknown";
    }
  ],
  [
    "transaction status",
    o => {
      o.transactions.payments[0].status = "unknown";
    }
  ]
])
  test(`GET integrity rejects divergent ${label} without release or stock debit`, async t => {
    const db = await fixture(t);
    const order = wire();
    change(order);
    t.mock.method(globalThis, "fetch", async () => Response.json(order));
    const verified = await app.orders.fetchMpOrder("fake", "ORD101");
    await app.sync.syncPaymentFromMp(db, 1, verified);
    const snapshot = await state(db);
    assert.equal(snapshot.pagamentos[0].status, "PENDENTE");
    assert.equal(snapshot.pedido.reserva_status, "ATIVA");
    assert.equal(snapshot.produtos[0].estoque, 10);
    assert.equal(snapshot.produtos[0].estoque_reservado, 2);
  });

test("wrong ORD, wrong PAY and multiple transactions cannot pay", async t => {
  const db = await fixture(t);
  let order = wire();
  order.id = "ORD999";
  t.mock.method(globalThis, "fetch", async () => Response.json(order));
  await assert.rejects(() => app.orders.fetchMpOrder("fake", "ORD101"), /ID_DIVERGENTE/);
  order = wire();
  order.transactions.payments[0].id = "PAY999";
  await assert.rejects(
    () => app.orders.fetchMpOrder("fake", "ORD101").then(o => app.sync.syncPaymentFromMp(db, 1, o)),
    /IDENTIDADE/
  );
  order.transactions.payments.push(order.transactions.payments[0]);
  await assert.rejects(() => app.orders.fetchMpOrder("fake", "ORD101"), /ORDER_INVALIDA/);
  assert.equal((await state(db)).pagamentos[0].status, "PENDENTE");
});

for (const status of [402, 408, 409, 423, 429, 500])
  test(`creation HTTP ${status} remains ambiguous`, async t => {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response("external error", {
          status,
          headers: { "x-request-id": "req-test-409" }
        })
    );
    const res = await app.mpPost.postPagamentoMp("fake", "key", {});
    assert.equal(res.resultado, "AMBIGUO");
    assert.equal(res.requestId, "req-test-409");
  });
test("validation HTTP 400 is definitive; network and timeout remain ambiguous", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("invalid", {
        status: 400,
        headers: { "x-request-id": "req-test-400" }
      })
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.requestId, "req-test-400");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network");
  });
  assert.equal((await app.mpPost.postPagamentoMp("fake", "key", {})).motivo, "TRANSPORTE");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("timeout")))
      )
  );
  const pending = app.mpPost.postPagamentoMp("fake", "key", {});
  t.mock.timers.tick(20_000);
  assert.equal((await pending).motivo, "TIMEOUT");
});

test("Orders 400 error parsing: invalid_email_for_sandbox -> code correto", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: "invalid_email_for_sandbox",
          message: 'Email format is invalid for sandbox environment, must contain "@testuser.com".',
          status: 400
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-sandbox-email" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, "invalid_email_for_sandbox");
  assert.equal(
    res.mensagem,
    'Email format is invalid for sandbox environment, must contain "@testuser.com".'
  );
  assert.equal(res.requestId, "req-sandbox-email");
});

test("Orders 400 error parsing: unsupported_properties -> code correto", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          code: "unsupported_properties",
          message: "The property 'foo' is not supported.",
          status: 400
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-unsupported" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, "unsupported_properties");
  assert.equal(res.mensagem, "The property 'foo' is not supported.");
  assert.equal(res.requestId, "req-unsupported");
});

test("Orders 400 error parsing: required_properties -> fallback valido", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          message: "required_properties"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-required" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, "required_properties");
  assert.equal(res.mensagem, "required_properties");
  assert.equal(res.requestId, "req-required");
});

test("Orders 400 error parsing: message descritiva longa -> code null", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          message: "An unexpected error occurred during validation of your request body."
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-long-desc" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, null);
  assert.equal(
    res.mensagem,
    "An unexpected error occurred during validation of your request body."
  );
  assert.equal(res.requestId, "req-long-desc");
});

test("Orders 400 error parsing: details/cause com code valido -> code correto", async t => {
  // Teste com cause array
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          message: "Invalid parameters were supplied.",
          cause: [{ code: "parameter_out_of_range", description: "Value too high" }]
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-cause-code" }
        }
      )
  );
  const resCause = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(resCause.resultado, "RECUSA_DEFINITIVA");
  assert.equal(resCause.code, "parameter_out_of_range");
  assert.equal(resCause.requestId, "req-cause-code");

  // Teste com details object
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          message: "Validation failed.",
          details: { error: "field_missing" }
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-details-code" }
        }
      )
  );
  const resDetails = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(resDetails.resultado, "RECUSA_DEFINITIVA");
  assert.equal(resDetails.code, "field_missing");
  assert.equal(resDetails.requestId, "req-details-code");
});

test("Orders 400 error parsing: campo com codigo malicioso/invalido -> null", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: "<script>alert('xss')</script>",
          code: "spaces are not allowed in codes",
          message: "A".repeat(65) // excede 64 chars
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.code, null);
});

test("Orders 400 error parsing: x-request-id continua propagado", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: "invalid_parameter"
        }),
        {
          status: 400,
          headers: { "x-request-id": "mp-tracked-req-id-12345" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.requestId, "mp-tracked-req-id-12345");
  assert.equal(res.code, "invalid_parameter");
});

test("Orders 400 error parsing: errors[] code, mantendo mensagem, detalhe, status e request id", async t => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              code: "invalid_email_for_sandbox",
              message:
                'Email format is invalid for sandbox environment, must contain "@testuser.com".'
            }
          ]
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-errors-code" }
        }
      )
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, "invalid_email_for_sandbox");
  assert.equal(res.mensagem, null, "message de errors[] nunca vira mensagem nem code");
  assert.equal(res.detalhe, null);
  assert.equal(res.requestId, "req-errors-code");
});

// Prioridade do code: error > code > errors[] > cause/details > message (só se já for um código).
for (const [name, body, expected] of [
  [
    "primeiro item inválido, segundo com code válido",
    { errors: [{ code: "has spaces <b>" }, { code: "second_code" }] },
    "second_code"
  ],
  [
    "errors[].error válido sem code",
    { errors: [{ error: "item_error", message: "texto livre" }] },
    "item_error"
  ],
  ["errors[].id válido sem code nem error", { errors: [{ id: "item_id" }] }, "item_id"],
  [
    "no mesmo item code vence error e id",
    { errors: [{ id: "item_id", error: "item_error", code: "item_code" }] },
    "item_code"
  ],
  [
    "errors[].message com cara de código, sem code/error/id -> não extrai do message",
    { errors: [{ message: "message_looking_like_code" }] },
    null
  ],
  [
    "errors[] com códigos inválidos/maliciosos -> null",
    { errors: [{ code: "<script>alert(1)</script>", error: "with spaces", id: "x".repeat(65) }] },
    null
  ],
  [
    "itens que não são objeto são ignorados e arrays aninhados não são inspecionados",
    { errors: [null, "string_item", 7, [{ code: "nested_code" }], { code: "object_code" }] },
    "object_code"
  ],
  ["errors que não é array é ignorado", { errors: { code: "object_errors_code" } }, null],
  [
    "error da raiz vence code da raiz e errors[]",
    { error: "root_error", code: "root_code", errors: [{ code: "item_code" }] },
    "root_error"
  ],
  [
    "code da raiz vence errors[]",
    { code: "root_code", errors: [{ code: "item_code" }] },
    "root_code"
  ],
  [
    "errors[] vence cause e details",
    {
      errors: [{ code: "errors_code" }],
      cause: [{ code: "cause_code" }],
      details: { error: "details_code" }
    },
    "errors_code"
  ],
  [
    "errors[] específico precede o fallback de message",
    { message: "message_code", errors: [{ code: "specific_code" }] },
    "specific_code"
  ],
  [
    "cause estruturado precede o fallback de message",
    { message: "message_code", cause: [{ code: "cause_code" }] },
    "cause_code"
  ],
  [
    "message é o último fallback quando errors[] não tem código seguro",
    { message: "message_code", errors: [{ code: "bad code" }] },
    "message_code"
  ]
])
  test(`Orders 400 error parsing: ${name}`, async t => {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify(body), {
          status: 400,
          headers: { "Content-Type": "application/json", "x-request-id": "req-errors-table" }
        })
    );
    const res = await app.mpPost.postPagamentoMp("fake", "key", {});
    assert.equal(res.resultado, "RECUSA_DEFINITIVA");
    assert.equal(res.httpStatus, 400);
    assert.equal(res.code, expected);
    assert.equal(res.requestId, "req-errors-table");
  });

test("Orders 400 error parsing: estrutura profunda que derruba a extração do code não apaga mensagem", async t => {
  // O JSON.parse aceita a profundidade, mas a recursão sobre details estoura a pilha e o parser
  // engole o erro. Como a message é um código válido, `code === null` prova que a extração
  // falhou (senão viria "mensagem_preservada"); a mensagem já lida tem que sobreviver.
  const depth = 100_000;
  const corpo = `{"message":"mensagem_preservada","details":${"[".repeat(depth)}${"]".repeat(depth)}}`;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(corpo, {
        status: 400,
        headers: { "Content-Type": "application/json", "x-request-id": "req-deep-details" }
      })
  );
  const res = await app.mpPost.postPagamentoMp("fake", "key", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.httpStatus, 400);
  assert.equal(res.code, null);
  assert.equal(res.mensagem, "mensagem_preservada");
  assert.equal(res.requestId, "req-deep-details");
});

for (const [ids, expected] of [
  [[], "NENHUM"],
  [["ORD1"], "UNICO"],
  [["ORD1", "ORD2"], "AMBIGUO"]
])
  test(`search ${ids.length} candidates: ${expected}, bounded read only`, async t => {
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/v1/orders");
      assert.equal(parsed.searchParams.get("begin_date"), "2025-12-31T23:55:00.000Z");
      assert.equal(parsed.searchParams.get("end_date"), "2026-01-01T01:00:00.000Z");
      assert.equal(parsed.searchParams.get("external_reference"), "ref");
      assert.equal(init.method, undefined);
      return Response.json({
        data: ids.map(id => ({ id, external_reference: "ref" })),
        paging: { total: String(ids.length) }
      });
    });
    assert.equal(
      (
        await app.mpSearch.buscarPagamentosPorReferenciaExterna(
          "fake",
          "ref",
          "2026-01-01 00:00:00"
        )
      ).resultado,
      expected
    );
  });
test("incomplete search page never selects a sole visible candidate", async t => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: [{ id: "ORD1", external_reference: "ref" }], paging: { total: "2" } })
  );
  assert.equal(
    (await app.mpSearch.buscarPagamentosPorReferenciaExterna("fake", "ref", "2026-01-01T00:00:00Z"))
      .resultado,
    "INDISPONIVEL"
  );
});

test("refund total/partial: ORD endpoint, PAY, decimal amount, stable intent and exact REF recovery", async t => {
  const calls = [];
  const response = {
    id: "ORD101",
    status: "processed",
    transactions: {
      refunds: [{ id: "REF1", transaction_id: "PAY101", amount: "1.01", status: "processed" }]
    }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url, init]);
    return Response.json(response);
  });
  assert.equal(
    (await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "intent")).resultado,
    "SUCESSO"
  );
  assert.equal(calls[0][1].body, undefined);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "intent", {
          amountCentavos: 101
        })
      ).resultado,
      "SUCESSO"
    );
  assert.equal(calls[1][0], "https://api.mercadopago.com/v1/orders/ORD101/refund");
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    transactions: [{ id: "PAY101", amount: "1.01" }]
  });
  assert.equal(calls[1][1].headers["X-Idempotency-Key"], calls[2][1].headers["X-Idempotency-Key"]);
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD101", "PAY101", "REF1", 101)).refund.status,
    "approved"
  );
  assert.equal(
    (await app.mpRefund.getRefundMp("fake", "ORD101", "PAY101", "REFdifferent", 101)).resultado,
    "AMBIGUO"
  );
  response.transactions.refunds.push({ ...response.transactions.refunds[0], id: "REF2" });
  assert.equal(
    (await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "intent", { amountCentavos: 101 }))
      .resultado,
    "AMBIGUO"
  );
});

test("cancel uses POST /ORD/cancel with stable key and no Payments body", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url, init]);
    return Response.json({ id: "ORD101", status: "canceled" });
  });
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await app.mpPost.cancelarPagamentoMp("fake", "ORD101", "cancel-intent")).resultado,
      "SUCESSO"
    );
  assert.equal(calls[0][0], "https://api.mercadopago.com/v1/orders/ORD101/cancel");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].headers["X-Idempotency-Key"], calls[1][1].headers["X-Idempotency-Key"]);
});

// Each mutation is compiled successfully, then must fail a behavioral assertion.
const mutations = [
  [
    "unsafe external reference passes unchanged",
    "types.ts",
    "if (/^[A-Za-z0-9_-]{1,64}$/.test(reference)) return reference;",
    "if (reference.length <= 64) return reference;",
    async m =>
      assert.equal(
        await m.orderExternalReference("a1:op-1:pag"),
        "e38bba82ac8714f843b30fdbd330160b209a3427ecd66bd880a935828b36c813"
      )
  ],
  [
    "oversized idempotency key passes unchanged",
    "types.ts",
    "key.length <= 128",
    "key.length <= 256",
    async m =>
      assert.equal(
        await m.orderIdempotencyKey(`a1:${"A".repeat(128)}:mp`),
        "616aba27aa2c1513daf8409c8d0ffa4fcde1b5684e8b5b1ab73480002363888a"
      )
  ],
  [
    "legacy unreadable payment releases reserve",
    "../../paymentSync/ledgerSync.ts",
    '!/^ORD[A-Za-z0-9]+$/.test(atual.mp_order_id ?? "")',
    "false",
    async (m, t) => {
      const db = await fixture(t);
      await db
        .prepare("UPDATE pedido_pagamentos SET mp_order_id=NULL,mp_payment_id='101' WHERE id=1")
        .run();
      await assert.rejects(() => m.expireLocalPayment(db, 1), /LEGACY_MP_ORDER_ID_AUSENTE/);
    }
  ],
  [
    "unknown status becomes paid",
    "status.ts",
    "return null;",
    'return "PAGO";',
    m => assert.equal(m.mapOrderStatus("unknown", "unknown"), null)
  ],
  [
    "wrong cents scale",
    "types.ts",
    "value / 100n",
    "value / 10n",
    m => assert.equal(m.centsToDecimal(1001), "10.01")
  ],
  [
    "GET accepts wrong order",
    "client.ts",
    "order?.id !== orderId",
    "false",
    async m => {
      const order = wire();
      order.id = "ORD999";
      const previous = globalThis.fetch;
      globalThis.fetch = async () => Response.json(order);
      try {
        await assert.rejects(() => m.fetchMpOrder("fake", "ORD101"));
      } finally {
        globalThis.fetch = previous;
      }
    }
  ],
  [
    "snapshot gains authority without GET",
    "client.ts",
    "return verifiedOrders.has(order as VerifiedMpOrder);",
    "return true;",
    m => assert.equal(m.isVerifiedMpOrder(m.orderPaymentSnapshot(wire())), false)
  ],
  [
    "multiple refunds choose the first",
    "../../mpRefund.ts",
    "candidates.length !== 1",
    "candidates.length === 0",
    async m => {
      const previous = globalThis.fetch;
      globalThis.fetch = async () =>
        Response.json({
          id: "ORD101",
          status: "processed",
          transactions: {
            refunds: [
              { id: "REF1", transaction_id: "PAY101", amount: "1.01", status: "processed" },
              { id: "REF2", transaction_id: "PAY101", amount: "1.01", status: "processed" }
            ]
          }
        });
      try {
        assert.equal(
          (await m.postRefundMp("fake", "ORD101", "PAY101", "intent", { amountCentavos: 101 }))
            .resultado,
          "AMBIGUO"
        );
      } finally {
        globalThis.fetch = previous;
      }
    }
  ],
  [
    "refund amount becomes a numeric float",
    "../../mpRefund.ts",
    "centsToDecimal(options.amountCentavos)",
    "options.amountCentavos / 100",
    async m => {
      const previous = globalThis.fetch;
      let body;
      globalThis.fetch = async (_url, init) => {
        body = JSON.parse(init.body);
        return Response.json({
          id: "ORD101",
          status: "processed",
          transactions: {
            refunds: [{ id: "REF1", transaction_id: "PAY101", amount: "1.01", status: "processed" }]
          }
        });
      };
      try {
        await m.postRefundMp("fake", "ORD101", "PAY101", "intent", { amountCentavos: 101 });
        assert.deepEqual(body, { transactions: [{ id: "PAY101", amount: "1.01" }] });
      } finally {
        globalThis.fetch = previous;
      }
    }
  ]
];
for (const [name, file, anchor, replacement, check] of mutations)
  test(`negative control: ${name}`, async t => {
    const path = `functions/lib/mp/orders/${file}`;
    const original = await readFile(path, "utf8");
    assert.equal(original.split(anchor).length - 1, 1, "mutation anchor must exist exactly once");
    const compiled = await build({
      stdin: {
        contents: original.replace(anchor, replacement),
        resolveDir: resolve(dirname(path)),
        loader: "ts"
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm"
    });
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(`${compiled.outputFiles[0].text}\n//# sourceURL=orders-mutant-${file}`).toString("base64")}`
    );
    await assert.rejects(async () => check(module, t), { name: "AssertionError" });
  });

test("active functions contain no residual Payments endpoint", async () => {
  const inspect = async directory => {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${file.name}`;
      if (file.isDirectory()) await inspect(path);
      else if (file.isFile() && file.name.endsWith(".ts"))
        assert.doesNotMatch(await readFile(path, "utf8"), /\/v1\/payments|payments\/search/, path);
    }
  };
  await inspect("functions");
});

test("unknown refund status cannot acquire a legacy confirmation label", async t => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      id: "ORD101",
      status: "processed",
      transactions: {
        refunds: [{ id: "REF1", transaction_id: "PAY101", amount: "1.00", status: "approved" }]
      }
    })
  );
  const result = await app.mpRefund.postRefundMp("fake", "ORD101", "PAY101", "intent", {
    amountCentavos: 100
  });
  assert.equal(result.resultado, "SUCESSO");
  assert.equal(result.refund.status, "unknown:approved");
});

test("known legacy payment without ORD cannot release reserve through local expiration", async t => {
  const db = await fixture(t);
  await db
    .prepare("UPDATE pedido_pagamentos SET mp_order_id=NULL,mp_payment_id='101' WHERE id=1")
    .run();
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("no Payments fallback");
  });
  await assert.rejects(() => app.sync.expireLocalPayment(db, 1), /LEGACY_MP_ORDER_ID_AUSENTE/);
  const snapshot = await state(db);
  assert.equal(snapshot.pagamentos[0].status, "PENDENTE");
  assert.equal(snapshot.pedido.reserva_status, "ATIVA");
  assert.equal(snapshot.produtos[0].estoque_reservado, 2);
  assert.equal(network, 0);
});
