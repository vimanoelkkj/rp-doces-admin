import { mpResponse } from "./helpers/mp-orders.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// Onda 9C · ETAPA 2 — prova determinística do rate limit público do checkout
// (6 tentativas por minuto por IP, functions/lib/checkoutRateLimit.ts).
//
// O relógio é congelado no meio de uma janela: nenhuma requisição do teste
// pode atravessar a fronteira do minuto, então o bucket usado pela chave
// `checkout:<ip>:<bucket>` é estável e o teste não depende de sorte nem de
// sleep. O Mercado Pago é simulado localmente; nenhuma chamada externa ocorre.

const LIMITE = 6;
const JANELA_MS = 60_000;
const AGORA = Date.parse("2026-09-29T12:00:30Z");
const SEGUNDOS_RESTANTES = 30;
const IP_A = "203.0.113.10";
const IP_B = "203.0.113.11";

const chave = n => `rl-checkout-${n}`;

async function siteLimpo(t) {
  t.mock.timers.enable({ apis: ["Date"], now: AGORA });
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM pedidos WHERE id=1").run();
  await db.prepare("UPDATE produtos SET estoque=10, estoque_reservado=0 WHERE id=1").run();
  return db;
}

function mpPost(t) {
  let id = 100;
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.mercadopago.com/v1/orders");
    assert.equal(options.method, "POST");
    return mpResponse({
      id: ++id,
      status: "pending",
      date_of_expiration: "2099-01-01T00:00:00Z",
      point_of_interaction: { transaction_data: { qr_code: `qr-${id}` } }
    });
  });
}

const checkout = (db, ip, operationKey, extraHeaders = {}) =>
  app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { Origin: "https://local.test", "CF-Connecting-IP": ip, ...extraHeaders },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 1 }],
        cliente: { nome: "Teste", whatsapp: "11999999999" },
        operationKey
      })
    })
  });

async function contagens(db) {
  const n = async tabela => (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).first()).n;
  return {
    pedidos: await n("pedidos"),
    itens: await n("pedido_itens"),
    pagamentos: await n("pedido_pagamentos"),
    operacoes: await n("pedido_operacoes"),
    reservado: (await db.prepare("SELECT estoque_reservado FROM produtos WHERE id=1").first())
      .estoque_reservado
  };
}

// Consome exatamente o limite com tentativas reais e distintas, comprovando o
// contrato normal de cada uma antes do bloqueio.
async function saturar(db, ip, mp) {
  const respostas = [];
  for (let i = 1; i <= LIMITE; i++) {
    const response = await checkout(db, ip, chave(i));
    assert.equal(response.status, 200, `tentativa ${i} dentro do limite`);
    const body = await response.json();
    assert.ok(body.pedidoId, `tentativa ${i} cria pedido`);
    assert.ok(body.tokenPublico, `tentativa ${i} devolve token público`);
    assert.equal(body.totalCentavos, 5000, `tentativa ${i} precificada no servidor`);
    respostas.push(body);
  }
  assert.equal(mp.mock.callCount(), LIMITE, "uma cobrança MP por tentativa permitida");
  assert.deepEqual(await contagens(db), {
    pedidos: LIMITE,
    itens: LIMITE,
    pagamentos: LIMITE,
    operacoes: LIMITE,
    reservado: LIMITE
  });
  const tentativas = await db.prepare("SELECT tentativas FROM checkout_rate_limits").all();
  assert.equal(tentativas.results.length, 1, "uma única janela para este IP");
  assert.equal(tentativas.results[0].tentativas, LIMITE);
  return respostas;
}

test("9C: 6 tentativas do mesmo IP seguem o contrato; a 7ª recebe 429 antes de criar pedido ou cobrança", async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);
  await saturar(db, IP_A, mp);
  const antes = await contagens(db);

  const response = await checkout(db, IP_A, chave(7));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Muitas tentativas de pedido em pouco tempo. Aguarde alguns instantes.",
    code: "CHECKOUT_RATE_LIMIT"
  });
  // Retry-After presente e honesto: exatamente o que falta para a janela virar.
  assert.equal(response.headers.get("Retry-After"), String(SEGUNDOS_RESTANTES));

  assert.equal(mp.mock.callCount(), LIMITE, "nenhuma nova cobrança no Mercado Pago");
  assert.deepEqual(
    await contagens(db),
    antes,
    "nenhum pedido, item, pagamento, operação ou reserva"
  );
});

test("9C: IP diferente não herda o bloqueio do IP saturado", async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);
  await saturar(db, IP_A, mp);
  assert.equal((await checkout(db, IP_A, chave(7))).status, 429, "IP saturado segue bloqueado");

  const response = await checkout(db, IP_B, chave(7));
  assert.equal(response.status, 200, "outro IP tem sua própria janela");
  const body = await response.json();
  assert.ok(body.pedidoId);
  assert.equal(mp.mock.callCount(), LIMITE + 1);

  const chaves = (await db.prepare("SELECT chave, tentativas FROM checkout_rate_limits").all())
    .results;
  assert.equal(chaves.length, 2, "chaves distintas por IP");
  assert.deepEqual(chaves.map(c => c.tentativas).sort(), [1, LIMITE + 1]);
});

test("9C: a mesma janela continua bloqueada; a janela seguinte libera sem sleep real", async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);
  await saturar(db, IP_A, mp);

  assert.equal((await checkout(db, IP_A, chave(7))).status, 429);
  assert.equal((await checkout(db, IP_A, chave(8))).status, 429, "bloqueio persiste na janela");

  // Avanço determinístico do relógio mockado: nenhum sleep real, nenhum efeito
  // colateral em produção. A chave muda porque o bucket mudou.
  t.mock.timers.setTime(AGORA + JANELA_MS);
  const response = await checkout(db, IP_A, chave(7));
  assert.equal(response.status, 200, "novo minuto, novo orçamento de tentativas");
  assert.equal(mp.mock.callCount(), LIMITE + 1);

  const janelas = (
    await db.prepare("SELECT tentativas FROM checkout_rate_limits ORDER BY tentativas").all()
  ).results.map(r => r.tentativas);
  assert.deepEqual(janelas, [1, LIMITE + 2], "a janela antiga fica intacta e a nova recomeça");
});

test("9C: retry idempotente com a mesma operationKey não é punido pelo limite", async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);
  const [primeira] = await saturar(db, IP_A, mp);
  assert.equal((await checkout(db, IP_A, chave(7))).status, 429);

  // O replay sai ANTES do contador: um cliente que perdeu a resposta HTTP não
  // perde também o acesso ao pedido que já existe.
  const response = await checkout(db, IP_A, chave(1));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), primeira, "mesmo resultado lógico, inclusive o QR");
  assert.equal(mp.mock.callCount(), LIMITE, "nenhum segundo POST lógico");
  assert.deepEqual(await contagens(db), {
    pedidos: LIMITE,
    itens: LIMITE,
    pagamentos: LIMITE,
    operacoes: LIMITE,
    reservado: LIMITE
  });
});

test("checkout rejeita requisição de origem cruzada ou sem origem válida com 403 (sameOrigin)", async t => {
  const db = await siteLimpo(t);
  const mp = mpPost(t);

  // 1. Origem cruzada (tentativa de CSRF vinda de outro domínio)
  const cruzada = await app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { Origin: "https://evil.test", "CF-Connecting-IP": IP_A },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 1 }],
        cliente: { nome: "Ataque", whatsapp: "11999999999" },
        operationKey: "csrf-cruzada"
      })
    })
  });
  assert.equal(cruzada.status, 403);
  assert.deepEqual(await cruzada.json(), { error: "Origem inválida" });

  // 2. Sem cabeçalhos Origin ou Referer em POST
  const semOrigem = await app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { "CF-Connecting-IP": IP_A },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 1 }],
        cliente: { nome: "Ataque", whatsapp: "11999999999" },
        operationKey: "csrf-sem-origem"
      })
    })
  });
  assert.equal(semOrigem.status, 403);
  assert.deepEqual(await semOrigem.json(), { error: "Origem inválida" });

  // 3. Referer da mesma origem é aceito
  const comReferer = await app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { Referer: "https://local.test/checkout", "CF-Connecting-IP": IP_A },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 1 }],
        cliente: { nome: "Legitimo Referer", whatsapp: "11999999999" },
        operationKey: "csrf-referer-valido"
      })
    })
  });
  assert.equal(comReferer.status, 200);

  // 4. Origin da mesma origem é aceito
  const comOrigin = await app.checkout.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    request: new Request("https://local.test/api/checkout", {
      method: "POST",
      headers: { Origin: "https://local.test", "CF-Connecting-IP": IP_A },
      body: JSON.stringify({
        items: [{ id: 1, quantity: 1 }],
        cliente: { nome: "Legitimo Origin", whatsapp: "11999999999" },
        operationKey: "csrf-origin-valido"
      })
    })
  });
  assert.equal(comOrigin.status, 200);

  // Comprova que as requisições bloqueadas não criaram nada nem chamaram o Mercado Pago
  assert.equal(mp.mock.callCount(), 2, "apenas os 2 checkouts legítimos chamaram o Mercado Pago");
  assert.deepEqual(await contagens(db), {
    pedidos: 2,
    itens: 2,
    pagamentos: 2,
    operacoes: 2,
    reservado: 2
  });
});
