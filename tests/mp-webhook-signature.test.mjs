import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { build } from "esbuild";
import { fixture, state } from "./helpers/b3.mjs";

// Webhook do Mercado Pago Orders.
// 1) O simulador oficial assina `type=order` com um data.id fictício ("123456"): com assinatura
//    válida responde 200 sem GET e sem efeito (antes virava 502 por ORDER_ID_INVALIDO).
// 2) O 401 da assinatura real ganha um diagnóstico estrutural seguro (nunca valores), sem mexer
//    no algoritmo HMAC.
// 3) O manifest HMAC leva o data.id exatamente como recebido. Única exceção, provada em staging real: o
//    sandbox do Orders envia `ORDTST...` em maiúsculas mas assina com o data.id em minúsculas; só para
//    ids no formato Order, falhando o manifest oficial, vale também o mesmo manifest com o id em minúsculas.

const bundle = await build({
  stdin: {
    contents: `
      export * as webhook from './functions/api/webhooks/mercadopago';
      export * as context from './functions/lib/requestContext';
      export * as shape from './functions/lib/mpWebhookSignatureShape';
      export * as sync from './functions/lib/paymentSync';
      export * as orders from './functions/lib/mp/orders/client';
    `,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});
const { webhook, context, shape, sync, orders } = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${bundle.outputFiles[0].text}\n//# sourceURL=rp-doces-webhook-signature-bundle.mjs`
  ).toString("base64")}`
);

const SECRET = "segredo-do-webhook-so-para-teste";
const URL_BASE = "https://local.test/api/webhooks/mercadopago";
const env = db => ({ DB: db, MP_ACCESS_TOKEN: "token-so-para-teste", MP_WEBHOOK_SECRET: SECRET });

// Assina como o MP: manifest `id:<data.id exatamente como recebido>;request-id:<x-request-id>;ts:<ts>;`,
// sem as partes ausentes. Implementação independente da de produção.
const assinar = ({ id, requestId, ts = "1700000000", secret = SECRET }) =>
  createHmac("sha256", secret)
    .update(`${id ? `id:${id};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${ts};`)
    .digest("hex");

// Entrega do webhook. `onde`: de onde vem o data.id ("query", "query-legacy", "body" ou "ambos").
function entrega({
  dataId = "",
  tipo = "order",
  onde = "query",
  requestId = "req-webhook-1",
  ts = "1700000000",
  valida = true,
  assinatura,
  extraQuery = {},
  extraBody = {},
  extraHeaders = {}
} = {}) {
  const query = new URLSearchParams({ type: tipo, ...extraQuery });
  if (dataId && (onde === "query" || onde === "ambos")) query.set("data.id", dataId);
  if (dataId && onde === "query-legacy") query.set("data_id", dataId);
  const body = {
    type: tipo,
    ...(dataId && (onde === "body" || onde === "ambos") ? { data: { id: dataId } } : {}),
    ...extraBody
  };
  const headers = { ...extraHeaders };
  if (requestId) headers["x-request-id"] = requestId;
  const v1 = valida ? assinar({ id: dataId, requestId, ts }) : "0".repeat(64);
  if (assinatura !== null) headers["x-signature"] = assinatura ?? `ts=${ts},v1=${v1}`;
  return new Request(`${URL_BASE}?${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

// Rede e D1 sob vigilância: nenhuma requisição externa e nenhum statement SQL.
function isolar(db, t) {
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url: String(url), init });
    throw new Error(`requisição externa inesperada: ${url}`);
  });
  const efeitos = [];
  db.hook = statements => {
    efeitos.push(...statements.map(s => s.sql));
    return statements;
  };
  return { chamadas, efeitos };
}

const silenciar = t => {
  const logs = [];
  for (const level of ["debug", "info", "log", "warn", "error"])
    t.mock.method(console, level, (...args) => logs.push([level, ...args]));
  return logs;
};

const FICTICIOS = ["123456", "abc123", "ord101", "ORD", "ORD-1", "ORD 1", "PAY101", "ORD1:PAY1"];

// Aviso do ramo "assinatura válida + type=order + data.id fora do formato ORD": só status e código fixo.
const IGNORADO = "Webhook do Mercado Pago ignorado: data.id fora do formato Orders";
const avisosIgnorados = logs => logs.filter(([, message]) => message === IGNORADO);

test("simulador oficial: assinatura válida + type=order + data.id fora do formato ORD responde 200 sem GET nem efeito, com um aviso seguro", async t => {
  const db = await fixture(t);
  const antes = await state(db);
  const { chamadas, efeitos } = isolar(db, t);
  const logs = silenciar(t);

  for (const dataId of FICTICIOS)
    for (const onde of ["query", "query-legacy", "body", "ambos"]) {
      const response = await webhook.onRequestPost({
        request: entrega({ dataId, onde }),
        env: env(db)
      });
      assert.equal(response.status, 200, `${dataId} (${onde})`);
      assert.deepEqual(await response.json(), { ok: true });
    }

  assert.deepEqual(chamadas, [], "nenhum GET remoto");
  assert.deepEqual(efeitos, [], "nenhum statement no D1");
  db.hook = null;
  assert.deepEqual(await state(db), antes);
  // Cada entrega ignorada gera exatamente um aviso, só com status e código fixo.
  assert.equal(logs.length, FICTICIOS.length * 4);
  for (const entrada of logs)
    assert.deepEqual(entrada, [
      "warn",
      IGNORADO,
      { httpStatus: 200, code: "ORDER_ID_FORMAT_INVALID" }
    ]);
});

test("assinatura inválida + data.id fictício continua 401, sem GET nem efeito", async t => {
  const db = await fixture(t);
  const antes = await state(db);
  const { chamadas, efeitos } = isolar(db, t);
  const logs = silenciar(t);

  for (const dataId of FICTICIOS) {
    const response = await webhook.onRequestPost({
      request: entrega({ dataId, valida: false }),
      env: env(db)
    });
    assert.equal(response.status, 401, dataId);
    assert.deepEqual(await response.json(), { erro: "Assinatura inválida." });
  }
  // Sem x-signature e com assinatura de outro secret: também 401.
  for (const request of [
    entrega({ dataId: "123456", assinatura: null }),
    entrega({
      dataId: "123456",
      assinatura: `ts=1700000000,v1=${assinar({ id: "123456", requestId: "req-webhook-1", secret: "outro" })}`
    })
  ])
    assert.equal((await webhook.onRequestPost({ request, env: env(db) })).status, 401);

  assert.deepEqual(chamadas, []);
  assert.deepEqual(efeitos, []);
  db.hook = null;
  assert.deepEqual(await state(db), antes);
  assert.deepEqual(avisosIgnorados(logs), [], "a assinatura é validada antes do ramo ignorado");
});

test("assinatura válida + id no formato ORD continua no fluxo autoritativo (GET /v1/orders/:id)", async t => {
  const db = await fixture(t);
  const logs = silenciar(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    chamadas.push({ url: String(url), init });
    return new Response("", { status: 404 });
  });

  for (const dataId of ["ORDTST01ABC", "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3", "ORDTst01Abc"]) {
    chamadas.length = 0;
    const response = await webhook.onRequestPost({
      request: entrega({ dataId }),
      env: env(db)
    });
    assert.equal(response.status, 200, dataId);
    assert.equal(chamadas.length, 1, `${dataId}: um GET`);
    assert.equal(chamadas[0].url, `https://api.mercadopago.com/v1/orders/${dataId}`);
    assert.equal(chamadas[0].init.method, undefined, "é um GET");
    assert.equal(chamadas[0].init.headers.Authorization, "Bearer token-so-para-teste");
  }
  assert.deepEqual(avisosIgnorados(logs), [], "id no formato ORD não é ignorado");
});

test("o aviso do ramo ignorado não registra nenhum valor recebido", async t => {
  const db = await fixture(t);
  const { chamadas, efeitos } = isolar(db, t);
  const logs = silenciar(t);
  const SENTINELAS = {
    dataId: "SENTINELA-ID-0001",
    requestId: "REQID-SENTINELA-0002",
    externalReference: "EXTREF-SENTINELA",
    queryToken: "TOKEN-DA-QUERY-SENTINELA",
    authorization: "AUTH-SENTINELA",
    cookie: "COOKIE-SENTINELA",
    email: "cliente.sentinela@example.com",
    secret: SECRET
  };
  const v1 = assinar({ id: SENTINELAS.dataId, requestId: SENTINELAS.requestId });
  const request = entrega({
    dataId: SENTINELAS.dataId,
    requestId: SENTINELAS.requestId,
    extraQuery: { token: SENTINELAS.queryToken },
    extraBody: {
      external_reference: SENTINELAS.externalReference,
      payer: { email: SENTINELAS.email }
    },
    extraHeaders: {
      authorization: `Bearer ${SENTINELAS.authorization}`,
      cookie: `session=${SENTINELAS.cookie}`
    }
  });

  const response = await context.withRequestContext(request, () =>
    webhook.onRequestPost({ request, env: env(db) })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(chamadas, [], "nenhum GET remoto");
  assert.deepEqual(efeitos, [], "nenhum statement no D1");
  assert.equal(logs.length, 1, "nada além do aviso");
  const [aviso] = avisosIgnorados(logs);
  const { requestId, ...payload } = aviso[2];
  assert.equal(aviso[0], "warn");
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, { httpStatus: 200, code: "ORDER_ID_FORMAT_INVALID" });

  const serializado = JSON.stringify(logs);
  for (const [nome, valor] of Object.entries({
    ...SENTINELAS,
    v1,
    xSignature: `ts=1700000000,v1=${v1}`
  }))
    assert.ok(!serializado.includes(valor), `vazou ${nome}`);
});

test("o guard do webhook e fetchMpOrder aceitam exatamente os mesmos ids", async t => {
  const db = await fixture(t);
  silenciar(t);
  let chamadas = [];
  t.mock.method(globalThis, "fetch", async url => {
    chamadas.push(String(url));
    return new Response("", { status: 404 });
  });

  for (const dataId of [
    ...FICTICIOS,
    "ORD1",
    "ORDTST01ABC",
    "ORDTst01Abc",
    "ORD_1",
    "ORDÇ1",
    "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3"
  ]) {
    chamadas = [];
    await webhook.onRequestPost({ request: entrega({ dataId }), env: env(db) });
    const peloWebhook = chamadas.length > 0;
    chamadas = [];
    await orders.fetchMpOrder("token", dataId).catch(() => {});
    assert.equal(peloWebhook, chamadas.length > 0, `divergência para ${dataId}`);

    // A assinatura com o id em minúsculas só vale para esses mesmos ids (formato Order); nos demais é 401.
    if (dataId.toLowerCase() !== dataId) {
      const assinatura = `ts=1700000000,v1=${assinar({ id: dataId.toLowerCase(), requestId: "req-webhook-1" })}`;
      const response = await webhook.onRequestPost({
        request: entrega({ dataId, assinatura }),
        env: env(db)
      });
      assert.equal(
        response.status === 401,
        !peloWebhook,
        `minúsculas só para o formato Order: ${dataId}`
      );
    }
  }
});

test("type não suportado e demais caminhos mantêm o comportamento atual", async t => {
  const db = await fixture(t);
  const { chamadas, efeitos } = isolar(db, t);
  const logs = silenciar(t);

  // Assinatura válida + type diferente de "order": 200 sem GET, qualquer que seja o id.
  for (const [tipo, dataId] of [
    ["payment", "ORDTST01ABC"],
    ["payment", "123456"],
    ["merchant_order", "ORDTST01ABC"],
    ["", "ORDTST01ABC"]
  ]) {
    const response = await webhook.onRequestPost({
      request: entrega({ dataId, tipo }),
      env: env(db)
    });
    assert.equal(response.status, 200, `${tipo || "(vazio)"} ${dataId}`);
    assert.deepEqual(await response.json(), { ok: true });
  }
  // type=order sem data.id (manifest sem a parte id): 200 sem GET.
  assert.equal(
    (await webhook.onRequestPost({ request: entrega({ dataId: "" }), env: env(db) })).status,
    200
  );
  assert.deepEqual(chamadas, []);
  assert.deepEqual(efeitos, []);
  assert.deepEqual(logs, []);

  // A assinatura segue exigida antes de qualquer decisão sobre o type.
  assert.equal(
    (
      await webhook.onRequestPost({
        request: entrega({ dataId: "ORDTST01ABC", tipo: "payment", valida: false }),
        env: env(db)
      })
    ).status,
    401
  );
  // Sem MP_WEBHOOK_SECRET: 503, antes de olhar a assinatura.
  const semSecret = await webhook.onRequestPost({
    request: entrega({ dataId: "ORDTST01ABC" }),
    env: { ...env(db), MP_WEBHOOK_SECRET: " " }
  });
  assert.equal(semSecret.status, 503);
  assert.deepEqual(chamadas, []);
});

// --- Diagnóstico estrutural do 401 ---------------------------------------------------------

const AVISO = "Webhook do Mercado Pago: assinatura inválida";
const avisos = logs => logs.filter(([level, message]) => level === "warn" && message === AVISO);

async function falhar(db, request) {
  return context.withRequestContext(request, () =>
    webhook.onRequestPost({ request, env: env(db) })
  );
}

const forma = (sobrescreve = {}, partes = {}) => ({
  hasSignature: true,
  hasRequestId: true,
  hasTs: true,
  hasV1: true,
  signatureSegments: 2,
  signatureSegmentNames: ["ts", "v1"],
  dataIdSource: "query-data.id",
  dataIdLength: 11,
  dataIdFormat: "order",
  dataIdCase: "upper",
  manifestParts: { id: true, requestId: true, ts: true, ...partes },
  ...sobrescreve
});

test("401 loga só a estrutura da entrada: presenças, origem, tamanho, formato e caixa do data.id", async t => {
  const db = await fixture(t);
  const logs = silenciar(t);
  const casos = [
    [
      "request realista (ts + v1, request-id, data.id na query)",
      entrega({ dataId: "ORDTST01ABC", valida: false }),
      forma()
    ],
    [
      "sem x-request-id",
      entrega({ dataId: "ORDTST01ABC", requestId: "", valida: false }),
      forma({ hasRequestId: false }, { requestId: false })
    ],
    [
      "data_id na query",
      entrega({ dataId: "ORDTST01ABC", onde: "query-legacy", valida: false }),
      forma({ dataIdSource: "query-data_id" })
    ],
    [
      "data.id só no body",
      entrega({ dataId: "ORDTST01ABC", onde: "body", valida: false }),
      forma({ dataIdSource: "body" })
    ],
    [
      "data.id na query e no body: a query tem precedência",
      entrega({ dataId: "ORDTST01ABC", onde: "ambos", valida: false }),
      forma()
    ],
    [
      "ORD com caixa mista",
      entrega({ dataId: "ORDtst01ABC", valida: false }),
      forma({ dataIdCase: "mixed" })
    ],
    [
      "minúsculas fora do formato ORD",
      entrega({ dataId: "ordtst01abc", valida: false }),
      forma({ dataIdFormat: "other", dataIdCase: "lower" })
    ],
    [
      "simulador: numérico",
      entrega({ dataId: "123456", valida: false }),
      forma({ dataIdLength: 6, dataIdFormat: "numeric", dataIdCase: "neutral" })
    ],
    [
      "sem data.id",
      entrega({ dataId: "", valida: false }),
      forma(
        { dataIdSource: "none", dataIdLength: 0, dataIdFormat: "empty", dataIdCase: "neutral" },
        { id: false }
      )
    ],
    [
      "x-signature sem '=' (malformada)",
      entrega({ dataId: "ORDTST01ABC", assinatura: "lixo" }),
      forma(
        { hasTs: false, hasV1: false, signatureSegments: 1, signatureSegmentNames: [] },
        { ts: false }
      )
    ],
    [
      "só ts",
      entrega({ dataId: "ORDTST01ABC", assinatura: "ts=1700000000" }),
      forma({ hasV1: false, signatureSegments: 1, signatureSegmentNames: ["ts"] })
    ],
    [
      "v1 e ts vazio",
      entrega({ dataId: "ORDTST01ABC", assinatura: "v1=abc,ts=" }),
      forma({ hasTs: false }, { ts: false })
    ],
    [
      "segmento extra: só ts/v1 têm nome registrado",
      entrega({ dataId: "ORDTST01ABC", assinatura: "ts=1,v1=abc,segredo=ZZZ" }),
      forma({ signatureSegments: 3 })
    ],
    [
      "sem x-signature",
      entrega({ dataId: "ORDTST01ABC", assinatura: null }),
      forma(
        {
          hasSignature: false,
          hasTs: false,
          hasV1: false,
          signatureSegments: 0,
          signatureSegmentNames: []
        },
        { ts: false }
      )
    ],
    [
      "x-signature vazio",
      entrega({ dataId: "ORDTST01ABC", assinatura: "" }),
      forma(
        {
          hasSignature: false,
          hasTs: false,
          hasV1: false,
          signatureSegments: 0,
          signatureSegmentNames: []
        },
        { ts: false }
      )
    ]
  ];

  for (const [nome, request, esperada] of casos) {
    logs.length = 0;
    const response = await falhar(db, request);
    assert.equal(response.status, 401, nome);
    assert.deepEqual(await response.json(), { erro: "Assinatura inválida." }, nome);
    const [aviso, ...outros] = avisos(logs);
    assert.equal(outros.length, 0, `${nome}: um único aviso`);
    const { requestId, ...payload } = aviso[2];
    assert.match(requestId, /^req-[a-f0-9]{24}$/, nome);
    assert.deepEqual(payload, { httpStatus: 401, webhookSignature: esperada }, nome);
  }
});

test("401 não registra nenhum valor sensível da entrega", async t => {
  const db = await fixture(t);
  const logs = silenciar(t);
  const V1 = "d34db33f".repeat(8);
  const SENTINELAS = {
    secret: SECRET,
    v1: V1,
    requestId: "REQID-SENTINELA-0001",
    dataId: "ORDTSTSENTINELA0001",
    externalReference: "EXTREF-SENTINELA",
    queryToken: "TOKEN-DA-QUERY-SENTINELA",
    authorization: "AUTH-SENTINELA",
    cookie: "COOKIE-SENTINELA",
    email: "cliente.sentinela@example.com"
  };
  const request = entrega({
    dataId: SENTINELAS.dataId,
    requestId: SENTINELAS.requestId,
    assinatura: `ts=1700000000,v1=${V1}`,
    extraQuery: { token: SENTINELAS.queryToken },
    extraBody: {
      external_reference: SENTINELAS.externalReference,
      payer: { email: SENTINELAS.email }
    },
    extraHeaders: {
      authorization: `Bearer ${SENTINELAS.authorization}`,
      cookie: `session=${SENTINELAS.cookie}`
    }
  });

  const response = await falhar(db, request);
  assert.equal(response.status, 401);

  const serializado = JSON.stringify(logs);
  for (const [nome, valor] of Object.entries(SENTINELAS))
    assert.ok(!serializado.includes(valor), `vazou ${nome}`);
  // Só o tamanho do data.id aparece, nunca o valor nem prefixos reconhecíveis.
  const [aviso] = avisos(logs);
  assert.equal(aviso[2].webhookSignature.dataIdLength, SENTINELAS.dataId.length);
  assert.deepEqual(
    Object.keys(aviso[2]).sort(),
    ["httpStatus", "requestId", "webhookSignature"],
    "nada além de requestId, status e a forma estrutural"
  );
});

test("a instrumentação não altera a validação: o protocolo HMAC segue o mesmo", async () => {
  const id = "ORDTST01ABC";
  const assinatura = (...args) => `ts=1,v1=${assinar({ id, ts: "1", ...args[0] })}`;
  const pedido = headers => new Request(URL_BASE, { method: "POST", headers, body: "{}" });
  const manifestMinusculo = createHmac("sha256", SECRET)
    .update(`id:${id.toLowerCase()};request-id:r1;ts:1;`)
    .digest("hex");

  const casos = [
    [
      "manifest com o id exato (como recebido) e request-id",
      { "x-signature": assinatura({ requestId: "r1" }), "x-request-id": "r1" },
      true
    ],
    ["sem request-id (a parte sai do manifest)", { "x-signature": assinatura({}) }, true],
    [
      "v1 em maiúsculas (comparado em minúsculas)",
      {
        "x-signature": assinatura({ requestId: "r1" })
          .toUpperCase()
          .replace("TS=", "ts=")
          .replace("V1=", "v1="),
        "x-request-id": "r1"
      },
      true
    ],
    [
      "assinado com o id em minúsculas (sandbox do Orders; id no formato Order)",
      { "x-signature": `ts=1,v1=${manifestMinusculo}`, "x-request-id": "r1" },
      true
    ],
    [
      "id em minúsculas com request-id de outra caixa",
      {
        "x-signature": `ts=1,v1=${assinar({ id: id.toLowerCase(), requestId: "R1", ts: "1" })}`,
        "x-request-id": "r1"
      },
      false
    ],
    [
      "request-id diferente",
      { "x-signature": assinatura({ requestId: "r1" }), "x-request-id": "r2" },
      false
    ],
    [
      "request-id com maiúsculas assinado como recebido (sem normalizar)",
      { "x-signature": assinatura({ requestId: "Req-1" }), "x-request-id": "Req-1" },
      true
    ],
    [
      "secret diferente",
      { "x-signature": assinatura({ requestId: "r1", secret: "outro" }), "x-request-id": "r1" },
      false
    ],
    [
      "ts diferente do assinado",
      {
        "x-signature": `ts=2,v1=${assinar({ id, requestId: "r1", ts: "1" })}`,
        "x-request-id": "r1"
      },
      false
    ],
    [
      "sem ts",
      { "x-signature": `v1=${assinar({ id, requestId: "r1" })}`, "x-request-id": "r1" },
      false
    ],
    ["sem v1", { "x-signature": "ts=1", "x-request-id": "r1" }, false],
    ["sem x-signature", { "x-request-id": "r1" }, false]
  ];

  for (const [nome, headers, esperado] of casos) {
    const direto = await sync.validateMpWebhookSignature(pedido(headers), SECRET, id);
    assert.equal(direto, esperado, nome);

    // Descrever a entrada antes não muda o resultado, não consome o corpo e não toca nos headers.
    const request = pedido(headers);
    const antes = [...request.headers];
    shape.describeWebhookSignatureInput(request, id, "query-data.id");
    assert.equal(request.bodyUsed, false, `${nome}: corpo intacto`);
    assert.deepEqual([...request.headers], antes, `${nome}: headers intactos`);
    assert.equal(await sync.validateMpWebhookSignature(request, SECRET, id), esperado, nome);
  }
  assert.equal(await sync.validateMpWebhookSignature(pedido(casos[0][1]), "", id), false);
});

// --- Caixa do data.id no manifest ----------------------------------------------------------
// O manifest oficial leva o data.id exatamente como recebido. Única exceção, provada em staging real: o
// sandbox do Orders envia `ORDTST...` em maiúsculas mas assina com o data.id em minúsculas. Só para ids no
// formato Order (`^ORD[A-Za-z0-9]+$`), falhando o oficial, vale também o manifest com o id em minúsculas;
// nenhuma outra variante. O HMAC destes testes vem de node:crypto sobre o manifest literal, não de `assinar`.

const hmacDe = manifest => createHmac("sha256", SECRET).update(manifest).digest("hex");
const inverterCaixa = texto =>
  [...texto].map(c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");

const ID_ORDERS = "ORDTST01M4CBMGQJER7FRW8784GHYS6X";
const comV1 = manifest => `ts=1700000000,v1=${hmacDe(manifest)}`;
const manifestOrders = id => `id:${id};request-id:req-webhook-1;ts:1700000000;`;

test("webhook real do Orders: data.id em MAIÚSCULAS valida com o manifest exato e com o id em minúsculas (200)", async t => {
  const db = await fixture(t);
  silenciar(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async url => {
    chamadas.push(String(url));
    return new Response("", { status: 404 });
  });
  const exato = manifestOrders(ID_ORDERS);
  const minusculo = manifestOrders(ID_ORDERS.toLowerCase());
  assert.notEqual(hmacDe(exato), hmacDe(minusculo));

  for (const [nome, manifest] of [
    ["manifest exato", exato],
    ["data.id em minúsculas (sandbox)", minusculo]
  ]) {
    chamadas.length = 0;
    const response = await webhook.onRequestPost({
      request: entrega({ dataId: ID_ORDERS, assinatura: comV1(manifest) }),
      env: env(db)
    });
    assert.equal(response.status, 200, nome);
    assert.deepEqual(
      chamadas,
      [`https://api.mercadopago.com/v1/orders/${ID_ORDERS}`],
      `${nome}: GET com o id como recebido`
    );
  }
});

test("webhook real do Orders: qualquer outro manifest ou secret é 401, sem GET nem efeito", async t => {
  const db = await fixture(t);
  const antes = await state(db);
  const { chamadas, efeitos } = isolar(db, t);
  silenciar(t);
  const minusculo = ID_ORDERS.toLowerCase();
  const comOutroSecret = manifest =>
    `ts=1700000000,v1=${createHmac("sha256", "outro-secret").update(manifest).digest("hex")}`;
  const entregas = [
    ["sem data.id", comV1("request-id:req-webhook-1;ts:1700000000;")],
    ["sem request-id", comV1(`id:${ID_ORDERS};ts:1700000000;`)],
    ["sem request-id, id em minúsculas", comV1(`id:${minusculo};ts:1700000000;`)],
    ["só ts", comV1("ts:1700000000;")],
    ["id com o prefixo em minúsculas", comV1(manifestOrders(`ord${ID_ORDERS.slice(3)}`))],
    [
      "id parcialmente em minúsculas",
      comV1(manifestOrders(`${ID_ORDERS.slice(0, 12)}${minusculo.slice(12)}`))
    ],
    [
      "id em minúsculas com request-id de outra caixa",
      comV1(`id:${minusculo};request-id:Req-Webhook-1;ts:1700000000;`)
    ],
    [
      "id em minúsculas com outro ts",
      comV1(`id:${minusculo};request-id:req-webhook-1;ts:1700000001;`)
    ],
    ["manifest exato com outro secret", comOutroSecret(manifestOrders(ID_ORDERS))],
    ["manifest em minúsculas com outro secret", comOutroSecret(manifestOrders(minusculo))],
    ["v1 sem relação com o manifest", `ts=1700000000,v1=${"0".repeat(64)}`]
  ];

  for (const [nome, assinatura] of entregas) {
    const request = entrega({ dataId: ID_ORDERS, assinatura });
    assert.equal(await sync.validateMpWebhookSignature(request, SECRET, ID_ORDERS), false, nome);
    const response = await webhook.onRequestPost({ request, env: env(db) });
    assert.equal(response.status, 401, nome);
    assert.deepEqual(await response.json(), { erro: "Assinatura inválida." }, nome);
  }

  assert.deepEqual(chamadas, [], "nenhum GET ao Mercado Pago");
  assert.deepEqual(efeitos, [], "nenhum statement no D1");
  db.hook = null;
  assert.deepEqual(await state(db), antes, "estado financeiro intacto");
});

test("o manifest aceita o data.id exato e, só no formato Order, em minúsculas; nenhuma outra caixa", async () => {
  // [id, está no formato Order (^ORD[A-Za-z0-9]+$)]
  const ids = {
    "maiúsculas (Order)": ["ORDTST01M4CBMGQJER7FRW8784GHYS6X", true],
    "mista (Order)": ["ORDtst01M4cbMGQJer7FRW8784ghYS6x", true],
    "minúsculas (fora do formato Order)": ["ordtst01m4cbmgqjer7frw8784ghys6x", false],
    "PAY (fora do formato Order)": ["PAY101ABC", false],
    "só o prefixo (fora do formato Order)": ["ORD", false],
    "numérico (simulador)": ["123456", false]
  };
  const pedido = assinadoCom =>
    new Request(URL_BASE, {
      method: "POST",
      headers: {
        "x-signature": `ts=1,v1=${hmacDe(`id:${assinadoCom};request-id:r1;ts:1;`)}`,
        "x-request-id": "r1"
      },
      body: "{}"
    });

  for (const [nome, [id, formatoOrder]] of Object.entries(ids)) {
    assert.equal(
      await sync.validateMpWebhookSignature(pedido(id), SECRET, id),
      true,
      `${nome}: id exato`
    );
    // Outras caixas do mesmo id (minúsculas, maiúsculas, invertida): só as minúsculas, e só no formato Order.
    const outras = new Set([id.toLowerCase(), id.toUpperCase(), inverterCaixa(id)]);
    outras.delete(id);
    for (const outra of outras)
      assert.equal(
        await sync.validateMpWebhookSignature(pedido(outra), SECRET, id),
        formatoOrder && outra === id.toLowerCase(),
        `${nome}: manifest assinado com ${outra}`
      );
  }
});

test("o logger só aceita a forma estrutural da allowlist", async t => {
  const logs = silenciar(t);
  const valida = forma();
  context.withRequestContext(new Request(URL_BASE), () => {
    context.requestLogger.warnMeta("TEST_WEBHOOK_OK", {
      httpStatus: 401,
      webhookSignature: {
        ...valida,
        signatureSegmentNames: ["ts", "v1", "segredo", "v1"],
        v1: "d34db33f",
        xSignature: "ts=1,v1=d34db33f",
        dataId: "ORDTSTSENTINELA0001",
        manifestParts: { ...valida.manifestParts, expected: "hash-esperado" }
      }
    });
    for (const [nome, invalida] of Object.entries({
      "fonte fora do domínio": { ...valida, dataIdSource: "headers" },
      "formato fora do domínio": { ...valida, dataIdFormat: "ORDTST01ABC" },
      "tamanho não inteiro": { ...valida, dataIdLength: 11.5 },
      "booleano trocado por texto": { ...valida, hasV1: "d34db33f" },
      "sem manifestParts": { ...valida, manifestParts: undefined },
      "o próprio corpo da entrega": { type: "order", data: { id: "ORDTSTSENTINELA0001" } },
      "string solta": "ts=1,v1=d34db33f"
    }))
      context.requestLogger.warnMeta(`TEST_WEBHOOK_${nome}`, { webhookSignature: invalida });
  });

  const [aceito, ...rejeitados] = logs.map(([, , payload]) => payload);
  const { requestId, ...payload } = aceito;
  assert.match(requestId, /^req-[a-f0-9]{24}$/);
  assert.deepEqual(payload, { httpStatus: 401, webhookSignature: valida });
  for (const rejeitado of rejeitados) assert.equal("webhookSignature" in rejeitado, false);
  assert.ok(!JSON.stringify(logs).includes("d34db33f"));
  assert.ok(!JSON.stringify(logs).includes("SENTINELA"));
});

test("o data.id do corpo só é consultado sem data.id na query (derivação como antes)", async t => {
  const db = await fixture(t);
  silenciar(t);
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async url => {
    chamadas.push(String(url));
    return new Response("", { status: 404 });
  });

  // Com data.id na query, um corpo cujo data.id não vira string nem é lido: segue para o GET.
  const request = entrega({
    dataId: "ORDTST01ABC",
    extraBody: { data: { id: { toString: 1 } } }
  });
  const response = await webhook.onRequestPost({ request, env: env(db) });
  assert.equal(response.status, 200);
  assert.deepEqual(chamadas, ["https://api.mercadopago.com/v1/orders/ORDTST01ABC"]);
});
