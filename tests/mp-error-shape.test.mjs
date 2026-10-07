import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fixture } from "./helpers/b3.mjs";

// Observabilidade temporária do corpo de erro 4xx do Mercado Pago: só ESTRUTURA
// (nomes de chaves, tipos, contagens) pode chegar ao log — nunca valores. Única exceção:
// `unsupportedPropertyPaths`, com caminhos de propriedade sob allowlist estrita.

const bundle = await build({
  stdin: {
    contents: `
      export * as shape from './functions/lib/mpErrorShape';
      export * as context from './functions/lib/requestContext';
      export * as mpPost from './functions/lib/mpPost';
      export * as checkout from './functions/api/checkout';
      export * as paths from './functions/lib/mpPropertyPaths';
    `,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});
const { shape, context, mpPost, checkout, paths } = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${bundle.outputFiles[0].text}\n//# sourceURL=rp-doces-mp-error-shape-bundle.mjs`
  ).toString("base64")}`
);

// Strings que jamais podem aparecer em saída/log. Fixtures independentes do código de produção.
const SECRET = {
  message: "MENSAGEM-SENSIVEL-DO-PROVEDOR",
  email: "cliente.secreto@example.com",
  cpf: "123.456.789-09",
  phone: "+5511999990000",
  token: "APP_USR-SEGREDO-0000",
  orderId: "ORDSEGREDO01ABC",
  paymentId: "PAYSEGREDO01ABC",
  qrCode: "000201SEGREDOQR",
  externalReference: "EXTREF-SEGREDA"
};
const leaked = text => Object.values(SECRET).filter(secret => text.includes(secret));

const STRUCTURED_FIELDS = ["cause", "details", "errors", "error", "data", "metadata"];
const TYPE_NAMES = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "null",
  "invalid_json"
]);
const ALLOWED_PROPERTIES = new Set([
  "bodyType",
  "topLevelKeys",
  "fieldTypes",
  ...STRUCTURED_FIELDS.flatMap(field => [`${field}Length`, `${field}ItemKeys`, `${field}Keys`])
]);

// Corpo rico: todos os campos estruturados, valores sensíveis em todo lugar.
const richBody = () => ({
  message: SECRET.message,
  status: 400,
  error: "bad_request",
  external_reference: SECRET.externalReference,
  payer: { email: SECRET.email, identification: { number: SECRET.cpf } },
  errors: [
    { code: "invalid_payer_email", message: SECRET.message, details: [SECRET.email] },
    { code: "other", field: "payer.email", data: { id: SECRET.orderId } }
  ],
  data: { id: SECRET.orderId, payment: SECRET.paymentId, qr_code: SECRET.qrCode },
  metadata: { token: SECRET.token },
  cause: [{ code: "x", description: SECRET.message }],
  details: [SECRET.phone, SECRET.cpf]
});

// Formato plausível do Orders (`errors[]`), em que o parser de `code` atual não olha.
const ordersBody = () => ({
  message: `${SECRET.message} para ${SECRET.email}`,
  errors: [{ code: "invalid_payer", message: SECRET.message, details: [SECRET.cpf] }],
  data: { id: SECRET.orderId, status: "failed" }
});
const ordersShape = {
  bodyType: "object",
  topLevelKeys: ["message", "errors", "data"],
  fieldTypes: { message: "string", errors: "array", data: "object" },
  errorsLength: 1,
  errorsItemKeys: ["code", "message", "details"],
  dataKeys: ["id", "status"]
};

function keyNamesDeep(value, names = new Set()) {
  if (Array.isArray(value)) for (const item of value) keyNamesDeep(item, names);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      names.add(key);
      keyNamesDeep(child, names);
    }
  return names;
}

const emittedStrings = result => [
  result.bodyType,
  ...result.topLevelKeys,
  ...Object.keys(result.fieldTypes),
  ...Object.values(result.fieldTypes),
  ...STRUCTURED_FIELDS.flatMap(field => [
    ...(result[`${field}ItemKeys`] ?? []),
    ...(result[`${field}Keys`] ?? [])
  ])
];

test("describeMpErrorShape emits only key names, types and counts", () => {
  const result = shape.describeMpErrorShape(JSON.stringify(richBody()));
  assert.deepEqual(result, {
    bodyType: "object",
    topLevelKeys: [
      "message",
      "status",
      "error",
      "external_reference",
      "payer",
      "errors",
      "data",
      "metadata",
      "cause",
      "details"
    ],
    fieldTypes: {
      message: "string",
      status: "number",
      error: "string",
      external_reference: "string",
      payer: "object",
      errors: "array",
      data: "object",
      metadata: "object",
      cause: "array",
      details: "array"
    },
    errorsLength: 2,
    errorsItemKeys: ["code", "message", "details", "field", "data"],
    dataKeys: ["id", "payment", "qr_code"],
    metadataKeys: ["token"],
    causeLength: 1,
    causeItemKeys: ["code", "description"],
    detailsLength: 2
  });
  assert.deepEqual(leaked(JSON.stringify(result)), []);
  // `payer` não é campo estruturado: nem as chaves aninhadas dele, nem as de `errors[].data`.
  assert.ok(!JSON.stringify(result).includes("identification"));
  assert.ok(!JSON.stringify(result).includes("payer.email"));
});

test("every emitted string is an input key name or a type name, every number a count", () => {
  const body = richBody();
  const result = shape.describeMpErrorShape(JSON.stringify(body));
  const inputKeys = keyNamesDeep(body);
  for (const text of emittedStrings(result))
    assert.ok(inputKeys.has(text) || TYPE_NAMES.has(text), `string inesperada na saída: ${text}`);
  for (const [property, value] of Object.entries(result)) {
    assert.ok(ALLOWED_PROPERTIES.has(property), `propriedade fora da allowlist: ${property}`);
    if (typeof value === "number") assert.match(property, /Length$/);
  }
});

test("arrays of objects expose only the union of item keys and the length", () => {
  const result = shape.describeMpErrorShape(
    JSON.stringify({
      errors: [
        { code: SECRET.message, message: SECRET.email, details: [SECRET.cpf] },
        { code: "x", extra: { nested: SECRET.token } },
        `item-${SECRET.phone}`,
        7,
        null
      ]
    })
  );
  assert.equal(result.errorsLength, 5);
  assert.deepEqual(result.errorsItemKeys, ["code", "message", "details", "extra"]);
  const serialized = JSON.stringify(result);
  assert.deepEqual(leaked(serialized), []);
  assert.ok(!serialized.includes("nested"), "chaves abaixo do primeiro nível dos itens não saem");
});

test("structured fields that are not arrays of objects report only type and size", () => {
  const result = shape.describeMpErrorShape(
    JSON.stringify({
      error: "bad_request",
      data: {},
      metadata: null,
      cause: [],
      details: [SECRET.phone, SECRET.cpf],
      errors: [1, [SECRET.token]]
    })
  );
  assert.deepEqual(result, {
    bodyType: "object",
    topLevelKeys: ["error", "data", "metadata", "cause", "details", "errors"],
    fieldTypes: {
      error: "string",
      data: "object",
      metadata: "null",
      cause: "array",
      details: "array",
      errors: "array"
    },
    dataKeys: [],
    causeLength: 0,
    detailsLength: 2,
    errorsLength: 2
  });
});

test("bodies that are not JSON objects only report their body type", () => {
  const cases = [
    [`<html>${SECRET.message}</html>`, "invalid_json"],
    ["   ", "invalid_json"],
    [JSON.stringify(SECRET.message), "string"],
    [JSON.stringify([{ code: SECRET.message }]), "array"],
    [JSON.stringify(42), "number"],
    ["true", "boolean"],
    ["null", "null"]
  ];
  for (const [corpo, bodyType] of cases) {
    const result = shape.describeMpErrorShape(corpo);
    assert.deepEqual(result, { bodyType, topLevelKeys: [], fieldTypes: {} });
    assert.deepEqual(leaked(JSON.stringify(result)), []);
  }
  assert.equal(shape.describeMpErrorShape(""), undefined, "corpo vazio não tem o que descrever");
});

test("unsafe key names are dropped and listed names are bounded", () => {
  const body = {
    [SECRET.email]: "v",
    "with space": 1,
    123456: 2,
    [`k${"x".repeat(70)}`]: 3,
    ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key_${index}`, index]))
  };
  const result = shape.describeMpErrorShape(JSON.stringify(body));
  const expectedKeys = Array.from({ length: 32 }, (_, index) => `key_${index}`);
  assert.deepEqual(result.topLevelKeys, expectedKeys);
  assert.deepEqual(Object.keys(result.fieldTypes), expectedKeys);

  const errors = Array.from({ length: 25 }, (_, index) => ({ [`item_${index}`]: index }));
  const arrayResult = shape.describeMpErrorShape(JSON.stringify({ errors }));
  assert.equal(arrayResult.errorsLength, 25, "o tamanho real é informado");
  assert.deepEqual(
    arrayResult.errorsItemKeys,
    Array.from({ length: 20 }, (_, index) => `item_${index}`),
    "só os 20 primeiros itens são inspecionados"
  );
  assert.deepEqual(leaked(JSON.stringify(result)), []);
});

test("__proto__ and constructor keys are described as plain names", () => {
  const result = shape.describeMpErrorShape('{"__proto__":{"polluted":true},"constructor":1}');
  assert.deepEqual(result.topLevelKeys, ["__proto__", "constructor"]);
  assert.deepEqual(Object.entries(result.fieldTypes), [
    ["__proto__", "object"],
    ["constructor", "number"]
  ]);
  assert.equal({}.polluted, undefined);
});

test("sanitizeMpErrorShape rejects arbitrary objects", () => {
  for (const arbitrary of [
    null,
    undefined,
    SECRET.message,
    42,
    [],
    [{ bodyType: "object" }],
    richBody(),
    { message: SECRET.message, bodyType: SECRET.message }
  ])
    assert.equal(shape.sanitizeMpErrorShape(arbitrary), undefined);
});

test("sanitizeMpErrorShape rebuilds a hand-built object keeping only the allowlisted parts", () => {
  const cleaned = shape.sanitizeMpErrorShape({
    bodyType: "object",
    topLevelKeys: ["message", SECRET.email, 42, { secret: SECRET.token }, "message"],
    fieldTypes: {
      message: "string",
      [SECRET.email]: "string",
      payer: { email: SECRET.email },
      status: SECRET.message,
      ok: "boolean"
    },
    detailsLength: SECRET.message,
    errorsLength: 3.5,
    causeLength: -1,
    dataLength: 2,
    dataKeys: ["id", { nested: SECRET.qrCode }, "with space"],
    metadataKeys: SECRET.token,
    payload: { secret: SECRET.token },
    authorization: `Bearer ${SECRET.token}`
  });
  assert.deepEqual(cleaned, {
    bodyType: "object",
    topLevelKeys: ["message"],
    fieldTypes: { message: "string", ok: "boolean" },
    dataLength: 2,
    dataKeys: ["id"]
  });
  assert.deepEqual(leaked(JSON.stringify(cleaned)), []);
});

test("errorMeta logs the sanitized shape next to the existing operational fields", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const request = new Request("https://local.test/api/checkout");

  context.withRequestContext(request, () => {
    context.requestLogger.errorMeta("TEST_SHAPE", {
      httpStatus: 400,
      mpRequestId: "mp-req-shape-1",
      code: null,
      mpErrorShape: { ...ordersShape, payload: ordersBody() },
      body: ordersBody()
    });
    // Corpo bruto no lugar do shape: objeto arbitrário não é logado.
    context.requestLogger.errorMeta("TEST_RAW_BODY", {
      httpStatus: 400,
      mpErrorShape: ordersBody()
    });
    // `null` (corpo vazio) é preservado como nos demais campos.
    context.requestLogger.errorMeta("TEST_NULL_SHAPE", { httpStatus: 400, mpErrorShape: null });
  });

  const [shaped, raw, empty] = logs;
  const { requestId, ...payload } = shaped[1];
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, {
    httpStatus: 400,
    mpRequestId: "mp-req-shape-1",
    code: null,
    mpErrorShape: ordersShape
  });
  assert.equal("mpErrorShape" in raw[1], false);
  assert.equal(empty[1].mpErrorShape, null);
  assert.deepEqual(leaked(JSON.stringify(logs)), []);
});

const fetchMock = (t, body, { status = 400, requestId } = {}) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(requestId && { "x-request-id": requestId })
      }
    });
  });
  return calls;
};

test("postPagamentoMp keeps the 4xx result and request untouched, only adding errorShape", async t => {
  const legacy = {
    error: "invalid_email_for_sandbox",
    message: "Email format is invalid for sandbox environment.",
    status: 400,
    cause: [{ code: "x", description: SECRET.message }]
  };
  const sent = { total_amount: "10.00", external_reference: "ref-1" };
  const calls = fetchMock(t, JSON.stringify(legacy), { requestId: "mp-req-legacy" });

  const res = await mpPost.postPagamentoMp("fake-token", "key-1", sent);

  assert.deepEqual(res, {
    resultado: "RECUSA_DEFINITIVA",
    httpStatus: 400,
    code: "invalid_email_for_sandbox",
    mensagem: legacy.message,
    detalhe: JSON.stringify(legacy.cause),
    requestId: "mp-req-legacy",
    errorShape: {
      bodyType: "object",
      topLevelKeys: ["error", "message", "status", "cause"],
      fieldTypes: { error: "string", message: "string", status: "number", cause: "array" },
      causeLength: 1,
      causeItemKeys: ["code", "description"]
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mercadopago.com/v1/orders");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, JSON.stringify(sent));
  assert.deepEqual(calls[0].init.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer fake-token",
    "X-Idempotency-Key": "key-1"
  });
});

test("postPagamentoMp extracts the code from an Orders errors[] body and still attaches the shape", async t => {
  fetchMock(t, JSON.stringify(ordersBody()), { requestId: "mp-req-orders" });
  const res = await mpPost.postPagamentoMp("fake-token", "key-1", {});
  assert.equal(res.resultado, "RECUSA_DEFINITIVA");
  assert.equal(res.code, "invalid_payer");
  assert.equal(res.mensagem, ordersBody().message);
  assert.equal(res.detalhe, null);
  assert.deepEqual(res.errorShape, ordersShape);
});

test("postPagamentoMp: empty and non-JSON 4xx bodies, and ambiguous results", async t => {
  fetchMock(t, "");
  const empty = await mpPost.postPagamentoMp("fake-token", "key-1", {});
  assert.deepEqual(empty, {
    resultado: "RECUSA_DEFINITIVA",
    httpStatus: 400,
    code: null,
    mensagem: null,
    detalhe: null,
    requestId: undefined
  });
  assert.equal(Object.hasOwn(empty, "errorShape"), false);

  fetchMock(t, `<html>${SECRET.message}</html>`, { requestId: "mp-req-html" });
  const html = await mpPost.postPagamentoMp("fake-token", "key-1", {});
  assert.deepEqual(html.errorShape, { bodyType: "invalid_json", topLevelKeys: [], fieldTypes: {} });
  assert.equal(html.code, null);
  assert.deepEqual(leaked(JSON.stringify(html.errorShape)), []);

  fetchMock(t, JSON.stringify(ordersBody()), { status: 503, requestId: "mp-req-503" });
  assert.deepEqual(await mpPost.postPagamentoMp("fake-token", "key-1", {}), {
    resultado: "AMBIGUO",
    motivo: "HTTP_INDISPONIVEL",
    httpStatus: 503,
    requestId: "mp-req-503"
  });
});

const checkoutRequest = operationKey =>
  new Request("https://local.test/api/checkout", {
    method: "POST",
    headers: { Origin: "https://local.test", "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: 1, quantity: 1 }],
      cliente: { nome: "Cliente", whatsapp: "11999999999" },
      operationKey
    })
  });
const runCheckout = (db, request) =>
  context.withRequestContext(request, () =>
    checkout.onRequestPost({ request, env: { DB: db, MP_ACCESS_TOKEN: "fake-token" } })
  );

test("checkout HTTP 400 logs the safe shape with the existing fields and no values", async t => {
  const logs = [];
  for (const level of ["debug", "info", "log", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push([level, ...args]));
  const db = await fixture(t);
  fetchMock(t, JSON.stringify(ordersBody()), { requestId: "mp-req-shape-400" });

  const response = await runCheckout(db, checkoutRequest("op-shape-log-400"));

  assert.equal(response.status, 502);
  const entries = logs.filter(([, message]) => message === "Mercado Pago checkout error");
  assert.equal(entries.length, 1);
  const { requestId, ...payload } = entries[0][2];
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, {
    httpStatus: 400,
    mpRequestId: "mp-req-shape-400",
    code: "invalid_payer",
    mpErrorShape: ordersShape,
    unsupportedPropertyPaths: [],
    detailsShape: null
  });
  assert.deepEqual(leaked(JSON.stringify(logs)), []);
});

test("checkout HTTP 400 keeps the financial effects, MP request and idempotency identical", async t => {
  t.mock.method(console, "error", () => {});
  const db = await fixture(t);
  const reservedBefore = (
    await db.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").first()
  ).estoque_reservado;
  const calls = fetchMock(t, JSON.stringify(ordersBody()), { requestId: "mp-req-fin-400" });
  const key = "op-shape-financial-400";

  const first = await runCheckout(db, checkoutRequest(key));

  assert.equal(first.status, 502);
  assert.deepEqual(await first.json(), {
    error: "Falha ao criar pagamento Pix",
    code: "MERCADO_PAGO_RECUSOU"
  });
  const operacao = await db
    .prepare(
      "SELECT fase, erro, mp_request, mp_idempotency_key FROM pedido_operacoes WHERE operation_key = ?"
    )
    .bind(key)
    .first();
  assert.equal(operacao.fase, "RECUSADA");
  assert.equal(operacao.erro, "RECUSA_DEFINITIVA:400");
  // O POST ao MP saiu uma única vez, com o corpo e a key persistidos no claim A1.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mercadopago.com/v1/orders");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, operacao.mp_request);
  assert.equal(calls[0].init.headers["X-Idempotency-Key"], operacao.mp_idempotency_key);

  const pagamento = await db
    .prepare(
      "SELECT status, mp_status, mp_status_detail FROM pedido_pagamentos ORDER BY id DESC LIMIT 1"
    )
    .first();
  assert.deepEqual(pagamento, {
    status: "FALHOU",
    mp_status: ordersBody().message,
    mp_status_detail: null
  });
  const pedido = await db
    .prepare("SELECT reserva_status FROM pedidos ORDER BY id DESC LIMIT 1")
    .first();
  assert.equal(pedido.reserva_status, "LIBERADA");
  const reservedAfter = (
    await db.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").first()
  ).estoque_reservado;
  assert.equal(reservedAfter, reservedBefore, "a reserva do pedido recusado foi liberada");

  // Retry da MESMA key: mesma recusa, sem novo POST.
  const replay = await runCheckout(db, checkoutRequest(key));
  assert.equal(replay.status, 502);
  assert.deepEqual(await replay.json(), {
    error: "Falha ao criar pagamento Pix",
    code: "MERCADO_PAGO_RECUSOU"
  });
  assert.equal(calls.length, 1);
});

// --- unsupportedPropertyPaths: caminho da propriedade rejeitada, só de errors[].details ---

const unsupportedBody = (details, errorExtra = {}) => ({
  errors: [{ code: "unsupported_properties", message: SECRET.message, details, ...errorExtra }]
});
const manyPaths = Array.from({ length: 10 }, (_, index) => `payer.field_${index}`);

for (const [name, body, expected] of [
  [
    "details.property",
    unsupportedBody({ property: "transactions.payments[0].foo" }),
    ["transactions.payments[0].foo"]
  ],
  ["details.field", unsupportedBody({ field: "payer.foo" }), ["payer.foo"]],
  ["details.path", unsupportedBody({ path: "payment_method.foo" }), ["payment_method.foo"]],
  [
    "details as an array of objects",
    unsupportedBody([{ property: "a.b" }, { field: "c[1].d" }, { path: "e-f" }]),
    ["a.b", "c[1].d", "e-f"]
  ],
  [
    "details as an array of path strings",
    unsupportedBody(["transactions.payments[0].foo", "payer.bar"]),
    ["transactions.payments[0].foo", "payer.bar"]
  ],
  ["details as a single path string", unsupportedBody("payer.foo"), ["payer.foo"]],
  [
    "duplicates are removed",
    unsupportedBody([{ property: "a.b" }, { field: "a.b" }, "a.b"]),
    ["a.b"]
  ],
  ["at most 8 paths", unsupportedBody(manyPaths), manyPaths.slice(0, 8)],
  [
    "128 characters is the limit",
    unsupportedBody(["a".repeat(129), "a".repeat(128)]),
    ["a".repeat(128)]
  ],
  [
    "email, spaces and free text are discarded",
    unsupportedBody([
      { property: SECRET.email },
      { field: "free text with spaces" },
      { path: "The property 'foo' is not supported" },
      SECRET.email,
      "payer foo",
      "9starts.with.digit",
      "line\nbreak",
      "tabs\tand",
      "a/b",
      "x@y"
    ]),
    []
  ],
  [
    "arbitrary objects and values do not escape",
    unsupportedBody([
      { property: { nested: "a.b" } },
      { field: ["a.b"] },
      { email: SECRET.email, value: "a.b" },
      { other: "c.d" },
      [["nested.array"]],
      42,
      null,
      true
    ]),
    []
  ],
  [
    "message is never used (empty details)",
    unsupportedBody([], { message: "payer.from_message" }),
    []
  ],
  [
    "message is never used (no details)",
    { errors: [{ code: "unsupported_properties", message: "payer.from_message" }] },
    []
  ],
  [
    "message is ignored next to valid details",
    unsupportedBody({ property: "payer.from_details" }, { message: "payer.from_message" }),
    ["payer.from_details"]
  ],
  ["root message is never used", { message: "payer.root_message", ...unsupportedBody([]) }, []],
  [
    "only unsupported_properties items are read",
    {
      errors: [
        { code: "required_properties", details: ["payer.required"] },
        { details: ["payer.no_code"] },
        { code: "unsupported_properties", details: ["payer.foo"] }
      ]
    },
    ["payer.foo"]
  ],
  [
    "details outside errors[] are not read",
    {
      code: "unsupported_properties",
      details: ["a.b"],
      errors: { code: "unsupported_properties", details: ["c.d"] }
    },
    []
  ]
])
  test(`unsupportedPropertyPaths: ${name}`, async t => {
    fetchMock(t, JSON.stringify(body), { requestId: "mp-req-paths" });
    const res = await mpPost.postPagamentoMp("fake-token", "key-1", {});
    assert.equal(res.resultado, "RECUSA_DEFINITIVA");
    assert.deepEqual(res.unsupportedPropertyPaths ?? [], expected);
    assert.equal(Object.hasOwn(res, "unsupportedPropertyPaths"), expected.length > 0);
    assert.deepEqual(leaked(JSON.stringify(res.unsupportedPropertyPaths ?? [])), []);
  });

test("unsupported_properties 400 adds the paths and leaves code, mensagem, detalhe and errorShape unchanged", async t => {
  const body = {
    message: "Request validation failed",
    errors: [
      {
        code: "unsupported_properties",
        message: SECRET.message,
        details: [{ property: "transactions.payments[0].foo" }, SECRET.email]
      }
    ]
  };
  fetchMock(t, JSON.stringify(body), { requestId: "mp-req-unsupported" });
  const res = await mpPost.postPagamentoMp("fake-token", "key-1", {});
  assert.deepEqual(res, {
    resultado: "RECUSA_DEFINITIVA",
    httpStatus: 400,
    code: "unsupported_properties",
    mensagem: "Request validation failed",
    detalhe: null,
    requestId: "mp-req-unsupported",
    errorShape: {
      bodyType: "object",
      topLevelKeys: ["message", "errors"],
      fieldTypes: { message: "string", errors: "array" },
      errorsLength: 1,
      errorsItemKeys: ["code", "message", "details"]
    },
    unsupportedPropertyPaths: ["transactions.payments[0].foo"],
    detailsShape: {
      type: "array",
      length: 2,
      itemTypes: ["object", "string"],
      objectItemKeys: ["property"],
      objectItemFieldTypes: { property: "string" }
    }
  });
});

test("extractUnsupportedPropertyPaths never throws on unreadable bodies", () => {
  for (const corpo of ["", "   ", "<html>", "null", "[]", '"x"', "42", '{"errors":null}'])
    assert.deepEqual(paths.extractUnsupportedPropertyPaths(corpo), []);
});

test("errorMeta keeps only strict property paths in unsupportedPropertyPaths", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const request = new Request("https://local.test/api/checkout");

  context.withRequestContext(request, () => {
    context.requestLogger.errorMeta("TEST_PATHS", {
      httpStatus: 400,
      unsupportedPropertyPaths: [
        "transactions.payments[0].foo",
        "payer.foo",
        "payer.foo",
        SECRET.email,
        "free text",
        "9digit.first",
        { property: "a.b" },
        ["c.d"],
        42,
        null,
        "a".repeat(129)
      ],
      body: ordersBody()
    });
    context.requestLogger.errorMeta("TEST_PATHS_CAP", {
      unsupportedPropertyPaths: Array.from({ length: 12 }, (_, index) => `p.q_${index}`)
    });
    // Só array passa: string solta ou objeto com property/field/path não viram caminho.
    context.requestLogger.errorMeta("TEST_PATHS_STRING", { unsupportedPropertyPaths: "payer.foo" });
    context.requestLogger.errorMeta("TEST_PATHS_OBJECT", {
      unsupportedPropertyPaths: { property: "payer.foo" }
    });
  });

  const [filtered, capped, asString, asObject] = logs;
  assert.deepEqual(filtered[1].unsupportedPropertyPaths, [
    "transactions.payments[0].foo",
    "payer.foo"
  ]);
  assert.equal(filtered[1].body, undefined);
  assert.deepEqual(
    capped[1].unsupportedPropertyPaths,
    Array.from({ length: 8 }, (_, index) => `p.q_${index}`)
  );
  assert.equal("unsupportedPropertyPaths" in asString[1], false);
  assert.equal("unsupportedPropertyPaths" in asObject[1], false);
  assert.deepEqual(leaked(JSON.stringify(logs)), []);
});

test("checkout HTTP 400 unsupported_properties logs the rejected property paths and nothing else", async t => {
  const logs = [];
  for (const level of ["debug", "info", "log", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push([level, ...args]));
  const db = await fixture(t);
  const reservedBefore = (
    await db.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").first()
  ).estoque_reservado;
  const body = {
    errors: [
      {
        code: "unsupported_properties",
        message: `${SECRET.message} ${SECRET.email}`,
        details: [
          { property: "transactions.payments[0].foo" },
          { field: SECRET.email },
          "payer.foo"
        ]
      }
    ],
    data: { id: SECRET.orderId }
  };
  const calls = fetchMock(t, JSON.stringify(body), { requestId: "mp-req-unsupported-400" });
  const key = "op-unsupported-paths-400";

  const response = await runCheckout(db, checkoutRequest(key));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Falha ao criar pagamento Pix",
    code: "MERCADO_PAGO_RECUSOU"
  });
  const entries = logs.filter(([, message]) => message === "Mercado Pago checkout error");
  assert.equal(entries.length, 1);
  const { requestId, ...payload } = entries[0][2];
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, {
    httpStatus: 400,
    mpRequestId: "mp-req-unsupported-400",
    code: "unsupported_properties",
    mpErrorShape: {
      bodyType: "object",
      topLevelKeys: ["errors", "data"],
      fieldTypes: { errors: "array", data: "object" },
      errorsLength: 1,
      errorsItemKeys: ["code", "message", "details"],
      dataKeys: ["id"]
    },
    unsupportedPropertyPaths: ["transactions.payments[0].foo", "payer.foo"],
    detailsShape: {
      type: "array",
      length: 3,
      itemTypes: ["object", "string"],
      objectItemKeys: ["property", "field"],
      objectItemFieldTypes: { property: "string", field: "string" }
    }
  });
  assert.deepEqual(leaked(JSON.stringify(logs)), []);

  // Mesmo efeito financeiro de qualquer recusa definitiva: status, reserva e retry intactos.
  const operacao = await db
    .prepare("SELECT fase, erro, mp_request FROM pedido_operacoes WHERE operation_key = ?")
    .bind(key)
    .first();
  assert.equal(operacao.fase, "RECUSADA");
  assert.equal(operacao.erro, "RECUSA_DEFINITIVA:400");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].init.body,
    operacao.mp_request,
    "o body enviado é o persistido no claim A1"
  );
  const pagamento = await db
    .prepare(
      "SELECT status, mp_status, mp_status_detail FROM pedido_pagamentos ORDER BY id DESC LIMIT 1"
    )
    .first();
  assert.deepEqual(pagamento, { status: "FALHOU", mp_status: null, mp_status_detail: null });
  const pedido = await db
    .prepare("SELECT reserva_status FROM pedidos ORDER BY id DESC LIMIT 1")
    .first();
  assert.equal(pedido.reserva_status, "LIBERADA");
  const reservedAfter = (
    await db.prepare("SELECT estoque_reservado FROM produtos WHERE id = 1").first()
  ).estoque_reservado;
  assert.equal(reservedAfter, reservedBefore);
  const replay = await runCheckout(db, checkoutRequest(key));
  assert.equal(replay.status, 502);
  assert.equal(calls.length, 1, "retry da mesma key não faz novo POST");
});

// --- detailsShape: estrutura (nunca valores) de errors[].details de unsupported_properties ---

const describeDetails = details =>
  shape.describeUnsupportedDetailsShape(JSON.stringify(unsupportedBody(details)));
const DETAILS_PROPERTIES = new Set([
  "type",
  "length",
  "itemTypes",
  "objectItemKeys",
  "objectItemFieldTypes",
  "arrayItemLengths",
  "keys",
  "fieldTypes",
  "nested"
]);

test("detailsShape: array of objects reports item keys and field types, no values", () => {
  const result = describeDetails([{ property: SECRET.orderId, value: SECRET.email }]);
  assert.deepEqual(result, {
    type: "array",
    length: 1,
    itemTypes: ["object"],
    objectItemKeys: ["property", "value"],
    objectItemFieldTypes: { property: "string", value: "string" }
  });
  assert.deepEqual(leaked(JSON.stringify(result)), []);
});

test("detailsShape: object reports keys, field types and the shape of an array child", () => {
  const result = describeDetails({ unsupported_properties: [SECRET.paymentId] });
  assert.deepEqual(result, {
    type: "object",
    keys: ["unsupported_properties"],
    fieldTypes: { unsupported_properties: "array" },
    nested: { unsupported_properties: { type: "array", length: 1, itemTypes: ["string"] } }
  });
  assert.deepEqual(leaked(JSON.stringify(result)), []);
});

for (const [name, details, expected] of [
  [
    "array of strings reports only the type string",
    [SECRET.email, "payer.foo", SECRET.cpf],
    { type: "array", length: 3, itemTypes: ["string"] }
  ],
  ["string", SECRET.message, { type: "string" }],
  ["number", 42, { type: "number" }],
  ["boolean", true, { type: "boolean" }],
  ["null", null, { type: "null" }],
  ["empty array", [], { type: "array", length: 0, itemTypes: [] }],
  ["empty object", {}, { type: "object", keys: [], fieldTypes: {} }],
  [
    "array items that are arrays report only their length",
    [[SECRET.email, "a"], [SECRET.cpf], []],
    { type: "array", length: 3, itemTypes: ["array"], arrayItemLengths: [2, 1, 0] }
  ],
  [
    "mixed items: types in order of first appearance, first type per field",
    [SECRET.email, { a: 1 }, 7, null, [1], true, { a: SECRET.message, b: SECRET.message }],
    {
      type: "array",
      length: 7,
      itemTypes: ["string", "object", "number", "null", "array", "boolean"],
      objectItemKeys: ["a", "b"],
      objectItemFieldTypes: { a: "number", b: "string" },
      arrayItemLengths: [1]
    }
  ]
])
  test(`detailsShape: ${name}`, () => {
    const result = describeDetails(details);
    assert.deepEqual(result, expected);
    assert.deepEqual(leaked(JSON.stringify(result)), []);
  });

test("detailsShape: goes two levels below details and no further", () => {
  const nestedObjects = describeDetails({
    a: { b: { deep_c: SECRET.email } },
    list: [{ deep_x: SECRET.email }],
    s: SECRET.message
  });
  assert.deepEqual(nestedObjects, {
    type: "object",
    keys: ["a", "list", "s"],
    fieldTypes: { a: "object", list: "array", s: "string" },
    nested: {
      a: { type: "object", keys: ["b"], fieldTypes: { b: "object" } },
      list: { type: "array", length: 1, itemTypes: ["object"] }
    }
  });
  const itemFields = describeDetails([{ x: { deep_y: SECRET.email }, list: [SECRET.cpf] }]);
  assert.deepEqual(itemFields, {
    type: "array",
    length: 1,
    itemTypes: ["object"],
    objectItemKeys: ["x", "list"],
    objectItemFieldTypes: { x: "object", list: "array" }
  });
  assert.ok(!JSON.stringify([nestedObjects, itemFields]).includes("deep_"));
});

test("detailsShape: inspects at most 20 items and lists at most 32 keys per level", () => {
  const items = [
    ...Array.from({ length: 20 }, () => SECRET.email),
    7,
    { late_key: SECRET.message }
  ];
  assert.deepEqual(describeDetails(items), { type: "array", length: 22, itemTypes: ["string"] });

  const names = Array.from({ length: 32 }, (_, index) => `key_${index}`);
  const manyKeys = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`key_${index}`, index])
  );
  const object = describeDetails(manyKeys);
  assert.deepEqual(object.keys, names);
  assert.deepEqual(Object.keys(object.fieldTypes), names);

  const arrayItem = describeDetails([manyKeys]);
  assert.deepEqual(arrayItem.objectItemKeys, names);
  assert.deepEqual(Object.keys(arrayItem.objectItemFieldTypes), names);

  const manyChildren = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`child_${index}`, { leaf: index }])
  );
  assert.equal(Object.keys(describeDetails(manyChildren).nested).length, 32);
});

test("detailsShape: key names that are not identifier-like are dropped", () => {
  const result = describeDetails({
    [SECRET.email]: { leaf: 1 },
    "with space": 1,
    "9digit": 2,
    [`k${"x".repeat(70)}`]: 3,
    ok_key: SECRET.message
  });
  assert.deepEqual(result, { type: "object", keys: ["ok_key"], fieldTypes: { ok_key: "string" } });
  assert.deepEqual(leaked(JSON.stringify(result)), []);
});

test("detailsShape: only unsupported_properties items that have details are described", () => {
  const describe = errors => shape.describeUnsupportedDetailsShape(JSON.stringify({ errors }));
  assert.equal(describe([{ code: "required_properties", details: ["x"] }]), undefined);
  assert.equal(describe([{ details: ["x"] }]), undefined);
  assert.equal(describe([{ code: "unsupported_properties" }]), undefined);
  assert.deepEqual(
    describe([
      { code: "required_properties", details: ["x"] },
      { code: "unsupported_properties" },
      { code: "unsupported_properties", details: { k: 1 } },
      { code: "unsupported_properties", details: ["later"] }
    ]),
    { type: "object", keys: ["k"], fieldTypes: { k: "number" } }
  );
  const outside = [
    { code: "unsupported_properties", details: ["x"] },
    { errors: { code: "unsupported_properties", details: ["x"] } },
    { errors: null }
  ];
  for (const body of outside)
    assert.equal(shape.describeUnsupportedDetailsShape(JSON.stringify(body)), undefined);
  for (const corpo of ["", "   ", "<html>", "null", "[]", '"x"', "42"])
    assert.equal(shape.describeUnsupportedDetailsShape(corpo), undefined);
});

test("detailsShape: no value of details or message appears, only key names and type names", () => {
  const details = {
    property: SECRET.orderId,
    list: [SECRET.email, { field: SECRET.cpf, deep: { token: SECRET.token } }, [SECRET.phone]],
    obj: { id: SECRET.paymentId, arr: [{ q: SECRET.qrCode }] },
    note: SECRET.message
  };
  const body = {
    errors: [
      {
        code: "unsupported_properties",
        message: `${SECRET.message} ${SECRET.externalReference}`,
        details
      }
    ]
  };
  const result = shape.describeUnsupportedDetailsShape(JSON.stringify(body));
  assert.deepEqual(leaked(JSON.stringify(result)), []);

  const inputKeys = keyNamesDeep(details);
  const check = node => {
    for (const property of Object.keys(node))
      assert.ok(DETAILS_PROPERTIES.has(property), `propriedade fora da allowlist: ${property}`);
    const strings = [
      node.type,
      ...(node.itemTypes ?? []),
      ...(node.objectItemKeys ?? []),
      ...Object.entries(node.objectItemFieldTypes ?? {}).flat(),
      ...(node.keys ?? []),
      ...Object.entries(node.fieldTypes ?? {}).flat(),
      ...Object.keys(node.nested ?? {})
    ];
    for (const text of strings)
      assert.ok(inputKeys.has(text) || TYPE_NAMES.has(text), `string inesperada: ${text}`);
    for (const child of Object.values(node.nested ?? {})) check(child);
  };
  check(result);
});

test("sanitizeMpDetailsShape rejects arbitrary objects and rebuilds hand-built ones", () => {
  for (const arbitrary of [
    null,
    undefined,
    SECRET.message,
    42,
    [],
    [{ type: "array" }],
    { property: SECRET.orderId, value: SECRET.email },
    { type: SECRET.message }
  ])
    assert.equal(shape.sanitizeMpDetailsShape(arbitrary), undefined);

  const cleaned = shape.sanitizeMpDetailsShape({
    type: "object",
    keys: ["ok", SECRET.email, 42, { secret: SECRET.token }, "ok"],
    fieldTypes: {
      ok: "string",
      [SECRET.email]: "string",
      bad: SECRET.message,
      obj: { value: SECRET.token }
    },
    length: 3.5,
    itemTypes: ["string", SECRET.message, "string", "object"],
    objectItemKeys: ["a", "with space"],
    arrayItemLengths: [1, -1, 2.5, "3", 4],
    nested: {
      child: {
        type: "array",
        length: 2,
        itemTypes: ["string"],
        nested: { too_deep: { type: "string" } },
        payload: SECRET.token
      },
      [SECRET.email]: { type: "string" },
      bad_child: { type: SECRET.message },
      scalar: SECRET.message
    },
    payload: { secret: SECRET.token },
    authorization: `Bearer ${SECRET.token}`
  });
  assert.deepEqual(cleaned, {
    type: "object",
    itemTypes: ["string", "object"],
    objectItemKeys: ["a"],
    arrayItemLengths: [1, 4],
    keys: ["ok"],
    fieldTypes: { ok: "string" },
    nested: { child: { type: "array", length: 2, itemTypes: ["string"] } }
  });
  assert.deepEqual(leaked(JSON.stringify(cleaned)), []);
});

test("errorMeta logs detailsShape through the allowlist and keeps null", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const request = new Request("https://local.test/api/checkout");

  context.withRequestContext(request, () => {
    context.requestLogger.errorMeta("TEST_DETAILS", {
      httpStatus: 400,
      detailsShape: {
        type: "array",
        length: 1,
        itemTypes: ["object"],
        objectItemKeys: ["property", "value"],
        objectItemFieldTypes: { property: "string", value: "string" },
        payload: { secret: SECRET.token },
        raw: SECRET.message
      }
    });
    // O próprio `details` no lugar do shape: objeto arbitrário não é logado.
    context.requestLogger.errorMeta("TEST_DETAILS_RAW", {
      detailsShape: { property: SECRET.orderId, value: SECRET.email }
    });
    context.requestLogger.errorMeta("TEST_DETAILS_NULL", { detailsShape: null });
  });

  const [shaped, raw, empty] = logs;
  assert.deepEqual(shaped[1].detailsShape, {
    type: "array",
    length: 1,
    itemTypes: ["object"],
    objectItemKeys: ["property", "value"],
    objectItemFieldTypes: { property: "string", value: "string" }
  });
  assert.equal("detailsShape" in raw[1], false);
  assert.equal(empty[1].detailsShape, null);
  assert.deepEqual(leaked(JSON.stringify(logs)), []);
});

test("postPagamentoMp: unrecognised unsupported_properties details leave the paths empty and expose the structure", async t => {
  const body = {
    errors: [
      {
        code: "unsupported_properties",
        message: SECRET.message,
        details: [{ name: SECRET.orderId, reason: SECRET.message }]
      }
    ]
  };
  fetchMock(t, JSON.stringify(body), { requestId: "mp-req-unrecognised" });
  const res = await mpPost.postPagamentoMp("fake-token", "key-1", {});
  assert.deepEqual(res, {
    resultado: "RECUSA_DEFINITIVA",
    httpStatus: 400,
    code: "unsupported_properties",
    mensagem: null,
    detalhe: null,
    requestId: "mp-req-unrecognised",
    errorShape: {
      bodyType: "object",
      topLevelKeys: ["errors"],
      fieldTypes: { errors: "array" },
      errorsLength: 1,
      errorsItemKeys: ["code", "message", "details"]
    },
    detailsShape: {
      type: "array",
      length: 1,
      itemTypes: ["object"],
      objectItemKeys: ["name", "reason"],
      objectItemFieldTypes: { name: "string", reason: "string" }
    }
  });
});

test("checkout HTTP 400 unsupported_properties with unrecognised details logs the structure, no values", async t => {
  const logs = [];
  for (const level of ["debug", "info", "log", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push([level, ...args]));
  const db = await fixture(t);
  const body = {
    errors: [
      {
        code: "unsupported_properties",
        message: `${SECRET.message} ${SECRET.email}`,
        details: [
          `${SECRET.email} is not supported`,
          { name: SECRET.paymentId, hint: [SECRET.cpf], extra: { token: SECRET.token } }
        ]
      }
    ]
  };
  fetchMock(t, JSON.stringify(body), { requestId: "mp-req-details-shape" });

  const response = await runCheckout(db, checkoutRequest("op-details-shape-400"));

  assert.equal(response.status, 502);
  const entries = logs.filter(([, message]) => message === "Mercado Pago checkout error");
  assert.equal(entries.length, 1);
  const { requestId, ...payload } = entries[0][2];
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, {
    httpStatus: 400,
    mpRequestId: "mp-req-details-shape",
    code: "unsupported_properties",
    mpErrorShape: {
      bodyType: "object",
      topLevelKeys: ["errors"],
      fieldTypes: { errors: "array" },
      errorsLength: 1,
      errorsItemKeys: ["code", "message", "details"]
    },
    unsupportedPropertyPaths: [],
    detailsShape: {
      type: "array",
      length: 2,
      itemTypes: ["string", "object"],
      objectItemKeys: ["name", "hint", "extra"],
      objectItemFieldTypes: { name: "string", hint: "array", extra: "object" }
    }
  });
  assert.deepEqual(leaked(JSON.stringify(logs)), []);
});
