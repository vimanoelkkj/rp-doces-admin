import test from "node:test";
import assert from "node:assert/strict";
import { mpResponse } from "./helpers/mp-orders.mjs";
import { app, fixture, state } from "./helpers/b3.mjs";

// Captura remota não conciliada: o Mercado Pago confirma (ou devolveu) o Pix do site, mas o ledger
// recusou a transição (INTEGRIDADE_MP:*). O dinheiro pode já ter entrado, então nenhuma cobrança NOVA
// nasce no pedido — pagamento manual, Pix administrativo novo ou regeneração — até um GET verificado
// conciliar o pagamento. Replay A1, reembolso e leitura seguem abertos. A recusa tem código estável
// (pré-checagem) e vale também dentro do CAS de capacidade, para a captura que chega no meio.

const CODIGO = "CAPTURA_MP_NAO_CONCILIADA";
const MENSAGEM =
  "Este pedido tem um pagamento do Mercado Pago confirmado e ainda não conciliado. Confira no Mercado Pago e atualize o pedido antes de cobrar de novo.";
const RESERVA_RETIDA = { estoque: 10, estoque_reservado: 2, reserva_status: "ATIVA" };

const estoque = s => ({
  estoque: s.produtos[0].estoque,
  estoque_reservado: s.produtos[0].estoque_reservado,
  reserva_status: s.pedido.reserva_status
});

const paidOrder = (change = () => {}) => {
  const order = {
    id: "ORD101",
    type: "online",
    status: "processed",
    status_detail: "accredited",
    external_reference: "token",
    total_amount: "100.00",
    country_code: "BRA",
    transactions: {
      payments: [
        {
          id: "PAY101",
          amount: "100.00",
          status: "processed",
          status_detail: "accredited",
          payment_method: { id: "pix", type: "bank_transfer" }
        }
      ]
    }
  };
  change(order);
  return order;
};

const refundedOrder = reference =>
  paidOrder(o => {
    o.status = o.status_detail = "refunded";
    o.external_reference = reference;
    Object.assign(o.transactions.payments[0], { status: "refunded", status_detail: "refunded" });
  });

// Provedor simulado por URL/método. O GET da ordem do site (ORD101) devolve `provedor.ordem`; o POST de
// criação devolve uma ordem nova (ORD201, ORD202...); o cancelamento é lembrado pelo GET seguinte.
// Toda chamada é registrada em `chamadas`: as recusas precisam provar ZERO chamadas novas.
function mercadoPago(t) {
  const provedor = { ordem: paidOrder(), chamadas: [], aoCriar: null };
  const canceladas = new Set();
  let ultima = 200;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const caminho = String(url).replace("https://api.mercadopago.com/v1/orders", "");
    const metodo = options?.method ?? "GET";
    provedor.chamadas.push(`${metodo} ${caminho || "/"}`);
    if (metodo === "POST" && caminho === "") {
      if (provedor.aoCriar) return provedor.aoCriar();
      return mpResponse({ id: ++ultima, status: "pending", date_of_expiration: "2099-01-01" });
    }
    const [, id, cancelar] = /^\/ORD(\d+)(\/cancel)?$/.exec(caminho) ?? [];
    if (metodo === "GET" && id === "101") return Response.json(provedor.ordem);
    if (metodo === "POST" && cancelar) {
      canceladas.add(id);
      return mpResponse({ id: Number(id), status: "cancelled" });
    }
    if (metodo === "GET" && id) {
      const status = canceladas.has(id) ? "cancelled" : "pending";
      return mpResponse({ id: Number(id), status, date_of_expiration: "2099-01-01" });
    }
    throw new Error(`requisição inesperada ao Mercado Pago: ${metodo} ${url}`);
  });
  return provedor;
}

async function pedidoComMp(t) {
  const db = await fixture(t);
  const provedor = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  return { db, provedor, session: await app.auth.createSession(db, 1) };
}

// Captura não conciliada como em mp-integrity-visibility.test.mjs: o provedor aprova R$ 99,00 para a
// cobrança local de R$ 100,00 (VALOR_DIVERGENTE). O Pix do site (pagamento 1) segue PENDENTE.
async function capturar(
  db,
  provedor,
  ordem = paidOrder(o => (o.transactions.payments[0].amount = "99.00"))
) {
  provedor.ordem = ordem;
  await app.sync.syncPaymentFromMp(db, 1, await app.orders.fetchMpOrder("fake", "ORD101"));
  const { status, mp_status } = (await state(db)).pagamentos[0];
  assert.equal(status, "PENDENTE");
  assert.ok(["approved", "refunded"].includes(mp_status), "setup: captura não conciliada");
}

const post = (handler, db, session, pedidoId, recurso, body) =>
  handler({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: String(pedidoId) },
    request: new Request(`https://local.test/api/admin/pedidos/${pedidoId}/${recurso}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie.split(";")[0],
        Origin: "https://local.test"
      },
      body: JSON.stringify(body)
    })
  });
const pagar = (db, session, body, pedidoId = 1) =>
  post(app.adminPayment.onRequestPost, db, session, pedidoId, "pagamentos", {
    metodo: "DINHEIRO",
    ...body
  });
const gerarPix = (db, session, body) =>
  post(app.adminPix.onRequestPost, db, session, 1, "pix", body);
const estornar = (db, session, body) =>
  post(app.adminRefund.onRequestPost, db, session, 1, "reembolsos", body);

async function detalhe(db, session, pedidoId = 1) {
  const response = await app.adminOrder.onRequestGet({
    env: { DB: db },
    params: { id: String(pedidoId) },
    request: new Request(`https://local.test/api/admin/pedidos/${pedidoId}`, {
      headers: { Cookie: session.cookie.split(";")[0] }
    })
  });
  assert.equal(response.status, 200);
  return response.json();
}

for (const [mpStatus, ordem] of [
  ["approved", undefined],
  ["refunded", refundedOrder("outra-referencia")]
])
  test(`a. manual payment is refused while a ${mpStatus} capture is unreconciled`, async t => {
    const { db, provedor, session } = await pedidoComMp(t);
    await capturar(db, provedor, ordem);
    const antes = await state(db);

    const resposta = await pagar(db, session, {
      valorCentavos: 10000,
      operationKey: "manual-bloqueado-01"
    });

    assert.equal(resposta.status, 409);
    assert.deepEqual(await resposta.json(), { error: MENSAGEM, code: CODIGO });
    // Nada nasce: nenhum pagamento, nenhuma operação, pedido NÃO pago e reserva retida.
    const depois = await state(db);
    assert.equal(depois.pagamentos.length, 1);
    assert.equal(depois.operacoes.length, 0);
    assert.equal(depois.pedido.status_pagamento, "PENDENTE");
    assert.deepEqual(estoque(depois), RESERVA_RETIDA);
    assert.deepEqual(depois, antes);
  });

test("b. a new admin Pix is refused without calling Mercado Pago", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  await capturar(db, provedor);
  const antes = await state(db);
  const chamadas = [...provedor.chamadas];

  const resposta = await gerarPix(db, session, { operationKey: "pix-bloqueado-01" });

  assert.equal(resposta.status, 409);
  assert.deepEqual(await resposta.json(), { error: MENSAGEM, code: CODIGO });
  assert.deepEqual(provedor.chamadas, chamadas, "nenhuma chamada nova ao Mercado Pago");
  assert.deepEqual(await state(db), antes);
});

test("c. regenerating an admin Pix is refused before any claim or provider call", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const criado = await gerarPix(db, session, { operationKey: "pix-original-01" });
  assert.equal(criado.status, 201);
  const original = await criado.json();
  await capturar(db, provedor);
  const antes = await state(db);
  const chamadas = [...provedor.chamadas];

  const resposta = await gerarPix(db, session, {
    substituiId: original.pagamentoId,
    operationKey: "pix-regeneracao-01"
  });

  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).code, CODIGO);
  assert.deepEqual(provedor.chamadas, chamadas, "nem o cancelamento do Pix original é tentado");
  // O Pix original segue PENDENTE e nenhuma operação nova foi reivindicada.
  const depois = await state(db);
  assert.equal(depois.pagamentos.find(p => p.id === original.pagamentoId).status, "PENDENTE");
  assert.equal(depois.operacoes.length, 1);
  assert.deepEqual(depois, antes);
});

test("d. a partial payment does not unlock the rest: capacity is 0 and the balance is refused", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const parcial = await pagar(db, session, { valorCentavos: 4000, operationKey: "parcial-01" });
  assert.equal(parcial.status, 201);
  await capturar(db, provedor);

  assert.equal((await detalhe(db, session)).capacidadeCobravelCentavos, 0);
  const antes = await state(db);
  const resposta = await pagar(db, session, { valorCentavos: 6000, operationKey: "parcial-02" });

  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).code, CODIGO);
  assert.deepEqual(await state(db), antes);
  assert.deepEqual(
    antes.pagamentos.filter(p => p.status === "PAGO").map(p => p.valor_centavos),
    [4000]
  );
});

test("e. a live admin Pix plus a capture leaves no capacity for another Pix", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const vivo = await gerarPix(db, session, { valorCentavos: 5000, operationKey: "pix-vivo-01" });
  assert.equal(vivo.status, 201);
  await capturar(db, provedor);

  assert.equal((await detalhe(db, session)).capacidadeCobravelCentavos, 0);
  const antes = await state(db);
  const chamadas = [...provedor.chamadas];
  const resposta = await gerarPix(db, session, {
    valorCentavos: 5000,
    operationKey: "pix-vivo-02"
  });

  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).code, CODIGO);
  assert.deepEqual(provedor.chamadas, chamadas, "nenhum segundo QR pagável é criado");
  assert.deepEqual(await state(db), antes);
});

test("f. an inconclusive Pix operation stays listed and a new charge is refused", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  provedor.aoCriar = () => {
    throw new Error("transport timeout");
  };
  const inconclusivo = await gerarPix(db, session, {
    valorCentavos: 5000,
    operationKey: "pix-inconclusivo-01"
  });
  assert.equal(inconclusivo.status, 502);
  assert.equal((await inconclusivo.json()).code, "MERCADO_PAGO_INDISPONIVEL");
  assert.equal((await state(db)).operacoes[0].fase, "ENVIO_INCONCLUSIVO");
  provedor.aoCriar = null;
  await capturar(db, provedor);
  const antes = await state(db);
  const chamadas = [...provedor.chamadas];

  const resposta = await gerarPix(db, session, {
    valorCentavos: 5000,
    operationKey: "pix-inconclusivo-02"
  });

  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).code, CODIGO);
  assert.deepEqual(provedor.chamadas, chamadas);
  assert.deepEqual(await state(db), antes);
  const { operacoesInconclusivas } = await detalhe(db, session);
  assert.deepEqual(
    operacoesInconclusivas.map(o => o.tipo),
    ["PIX_ADMIN", "PIX_MP_INTEGRIDADE"]
  );
});

test("g. A1 replay of a completed manual payment is untouched by the block", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const payload = { valorCentavos: 4000, operationKey: "replay-manual-01" };
  const original = await pagar(db, session, payload);
  assert.equal(original.status, 201);
  const { pagamentoId } = await original.json();
  await capturar(db, provedor);
  const antes = await state(db);

  const replay = await pagar(db, session, payload);

  assert.equal(replay.status, 201);
  const corpo = await replay.json();
  assert.equal(corpo.replay, true);
  assert.equal(corpo.pagamentoId, pagamentoId);
  assert.deepEqual(await state(db), antes, "nenhuma linha nova");
});

test("g. A1 replay of a completed admin Pix is untouched by the block", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const payload = { valorCentavos: 5000, operationKey: "replay-pix-01" };
  const original = await gerarPix(db, session, payload);
  assert.equal(original.status, 201);
  const criado = await original.json();
  await capturar(db, provedor);
  const antes = await state(db);
  const chamadas = [...provedor.chamadas];

  const replay = await gerarPix(db, session, payload);

  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), { ...criado, replay: true });
  assert.deepEqual(provedor.chamadas, chamadas, "replay não chama o Mercado Pago");
  assert.deepEqual(await state(db), antes, "nenhuma linha nova");
});

test("h. order detail exposes capturaMpNaoConciliada and zero capacity only while the capture exists", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const limpo = await detalhe(db, session);
  assert.equal(limpo.capturaMpNaoConciliada, false);
  assert.equal(limpo.capacidadeCobravelCentavos, 10000);

  await capturar(db, provedor);
  const bloqueado = await detalhe(db, session);
  assert.equal(bloqueado.capturaMpNaoConciliada, true);
  assert.equal(bloqueado.capacidadeCobravelCentavos, 0);
});

test("i. the block lifts on its own once a verified GET reconciles the payment", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  await capturar(db, provedor);
  const payload = { valorCentavos: 10000, operationKey: "libera-01" };
  const recusado = await pagar(db, session, payload);
  assert.equal(recusado.status, 409);
  assert.equal((await recusado.json()).code, CODIGO);

  // Identidade compatível: o GET verificado concilia a captura como REEMBOLSADO.
  provedor.ordem = refundedOrder("token");
  await app.sync.syncPaymentFromMp(db, 1, await app.orders.fetchMpOrder("fake", "ORD101"));
  assert.equal((await state(db)).pagamentos[0].status, "REEMBOLSADO");

  const liberado = await detalhe(db, session);
  assert.equal(liberado.capturaMpNaoConciliada, false);
  assert.equal(liberado.capacidadeCobravelCentavos, 10000);
  // A recusa não deixou claim: a MESMA intenção (mesma key) agora é aceita.
  const aceito = await pagar(db, session, payload);
  assert.equal(aceito.status, 201);
  assert.deepEqual(
    (await state(db)).pagamentos.map(p => [p.metodo, p.status, p.valor_centavos]),
    [
      ["PIX_MP", "REEMBOLSADO", 10000],
      ["DINHEIRO", "PAGO", 10000]
    ]
  );
});

test("j. the recovery path stays open: a cash payment can still be refunded", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const pago = await pagar(db, session, { valorCentavos: 10000, operationKey: "recupera-pago-01" });
  assert.equal(pago.status, 201);
  const { pagamentoId } = await pago.json();
  await capturar(db, provedor);

  const reembolso = await estornar(db, session, {
    pagamentoId,
    valorCentavos: 10000,
    operationKey: "recupera-reembolso-01"
  });

  assert.equal(reembolso.status, 201);
  const depois = await state(db);
  assert.deepEqual(
    depois.refunds.map(r => [r.pagamento_id, r.valor_centavos, r.status]),
    [[pagamentoId, 10000, "REEMBOLSADO"]]
  );
  // Só o reembolso foi aceito: a captura segue exatamente como estava.
  assert.deepEqual(
    depois.pagamentos.map(p => p.status),
    ["PENDENTE", "PAGO"]
  );
});

test("k. the block belongs to the order: another order is still chargeable", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  await db.batch([
    db.prepare(
      `INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,
         idempotency_key,reserva_status) VALUES(2,'token-2','Outro','000',5000,'pedido-2','SEM_RESERVA')`
    ),
    db.prepare(
      `INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
         valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
       VALUES(2,2,NULL,'Avulso',1,5000,5000,'ATIVO','NAO_APLICAVEL')`
    )
  ]);
  await capturar(db, provedor);

  // O pedido 2 não tem captura: capacidade e cobrança seguem intactas.
  assert.equal((await detalhe(db, session, 2)).capacidadeCobravelCentavos, 5000);
  const resposta = await pagar(db, session, { valorCentavos: 5000, operationKey: "outro-01" }, 2);
  assert.equal(resposta.status, 201);
  assert.equal((await detalhe(db, session, 2)).capturaMpNaoConciliada, false);
  assert.equal((await detalhe(db, session)).capturaMpNaoConciliada, true);
});

test("l. the capacity CAS refuses a manual payment when the capture lands after the pre-check", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  db.hook = async (statements, operation) => {
    if (
      operation === "batch" &&
      statements.some(s => s.sql.includes("INSERT INTO pedido_pagamentos"))
    ) {
      db.hook = null;
      await capturar(db, provedor);
    }
    return statements;
  };

  const resposta = await pagar(db, session, {
    valorCentavos: 10000,
    operationKey: "cas-manual-01"
  });
  db.hook = null;

  assert.equal(resposta.status, 409);
  assert.equal((await resposta.json()).code, "SALDO_INSUFICIENTE_CONCORRENCIA");
  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, "só o Pix do site; nenhum pagamento nasceu");
  assert.equal(s.operacoes.length, 0);
  assert.equal(s.pedido.status_pagamento, "PENDENTE");
  assert.deepEqual(estoque(s), RESERVA_RETIDA);
});

test("suspended regeneration replays its refusal and rejects a changed A1 payload without network", async t => {
  const { db, session } = await pedidoComMp(t);
  const original = await (
    await gerarPix(db, session, { valorCentavos: 5000, operationKey: "suspended-original-01" })
  ).json();
  const payload = {
    valorCentavos: 5000,
    substituiId: original.pagamentoId,
    operationKey: "suspended-retry-01"
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(String(url));
    throw new Error("transport unavailable");
  });
  const refused = await gerarPix(db, session, payload);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, "PIX_REGENERACAO_SUSPENSA");
  const before = await state(db);
  const replay = await gerarPix(db, session, payload);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).code, "PIX_REGENERACAO_SUSPENSA");
  const conflict = await gerarPix(db, session, { ...payload, valorCentavos: 4000 });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "OPERACAO_CONFLITO_PAYLOAD");
  assert.deepEqual(await state(db), before);
  assert.deepEqual(calls, [], "transport failure cannot turn suspension into an ambiguous send");
});

test("l. the capacity CAS refuses a new Pix when the capture lands after the pre-check", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  db.hook = async (statements, operation) => {
    if (
      operation === "batch" &&
      statements.some(s => s.sql.includes("INSERT INTO pedido_pagamentos"))
    ) {
      db.hook = null;
      await capturar(db, provedor);
    }
    return statements;
  };

  const resposta = await gerarPix(db, session, { valorCentavos: 5000, operationKey: "cas-pix-01" });
  db.hook = null;

  assert.notEqual(resposta.status, 201);
  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, "só o Pix do site; nenhuma cobrança nova nasceu");
  assert.equal(s.operacoes.length, 0);
  assert.ok(!provedor.chamadas.includes("POST /"), "nenhum Pix foi criado no Mercado Pago");
  assert.deepEqual(estoque(s), RESERVA_RETIDA);
});

test("regeneration cannot dispatch B when another capture arrives after the A1 claim", async t => {
  const { db, provedor, session } = await pedidoComMp(t);
  const originalResponse = await gerarPix(db, session, {
    valorCentavos: 5000,
    operationKey: "race-original-01"
  });
  assert.equal(originalResponse.status, 201);
  const original = await originalResponse.json();
  const callsBefore = [...provedor.chamadas];
  let captureInjected = false;

  // Pause the first database access AFTER the claim commits. The old flow reads A;
  // the suspended flow records its refusal. Both must see the same concurrent fact.
  db.hook = async (statements, operation) => {
    if (
      (operation === "first" &&
        statements.some(s => s.sql.includes("SELECT id, pedido_id, metodo"))) ||
      (operation === "run" && statements.some(s => s.sql.includes("UPDATE pedido_operacoes")))
    ) {
      db.hook = null;
      const claim = await db
        .prepare("SELECT fase FROM pedido_operacoes WHERE operation_key = ?")
        .bind("race-regenerate-01")
        .first();
      assert.equal(claim.fase, "LOCAL_CRIADA", "capture arrives after the A1 claim");
      await capturar(db, provedor);
      captureInjected = true;
    }
    return statements;
  };

  const response = await gerarPix(db, session, {
    valorCentavos: 5000,
    substituiId: original.pagamentoId,
    operationKey: "race-regenerate-01"
  });
  db.hook = null;
  assert.equal(captureInjected, true);
  const s = await state(db);
  assert.equal(s.pagamentos[0].mp_status, "approved");
  assert.equal(s.pagamentos[0].status, "PENDENTE");
  assert.equal(s.pagamentos.length, 2, "no successor B is persisted");
  assert.deepEqual(
    provedor.chamadas,
    [...callsBefore, "GET /ORD101"],
    "no remote dispatch of B or cancellation of A"
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PIX_REGENERACAO_SUSPENSA");
  assert.equal(s.pagamentos.find(p => p.id === original.pagamentoId).status, "PENDENTE");
  assert.equal(s.operacoes.find(o => o.operation_key === "race-regenerate-01").fase, "RECUSADA");
  assert.deepEqual(estoque(s), RESERVA_RETIDA);
});

test("failure to persist suspension keeps the claim recoverable without dispatch or retry POST", async t => {
  const { db, session } = await pedidoComMp(t);
  const original = await (
    await gerarPix(db, session, { valorCentavos: 5000, operationKey: "refusal-failure-original" })
  ).json();
  const before = await state(db);
  const payload = {
    valorCentavos: 5000,
    substituiId: original.pagamentoId,
    operationKey: "refusal-failure-regen"
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? "GET" });
    assert.equal(options?.method, undefined, "recovery must never send a POST");
    assert.ok(String(url).includes("/v1/orders?"));
    return Response.json({ data: [], paging: { total: 0 } });
  });
  db.hook = async (statements, operation) => {
    if (operation === "run" && statements.some(s => s.sql.includes("UPDATE pedido_operacoes"))) {
      db.hook = null;
      throw new Error("simulated D1 refusal write failure");
    }
    return statements;
  };
  assert.equal((await gerarPix(db, session, payload)).status, 500);
  const retry = await gerarPix(db, session, payload);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).code, "OPERACAO_EM_PROCESSAMENTO");
  assert.deepEqual(calls, []);
  await db
    .prepare(
      "UPDATE pedido_operacoes SET atualizado_em=datetime('now','-70 seconds') WHERE operation_key=?"
    )
    .bind(payload.operationKey)
    .run();
  await app.sync.recuperarOperacoesInconclusivas({ DB: db, MP_ACCESS_TOKEN: "fake" });
  const after = await state(db);
  assert.equal(calls.length, 1, "one observation, no remote creation");
  assert.deepEqual(after.pagamentos, before.pagamentos);
  assert.deepEqual(estoque(after), estoque(before));
  const claim = after.operacoes.find(o => o.operation_key === payload.operationKey);
  assert.equal(claim.fase, "LOCAL_CRIADA");
  assert.equal(claim.erro, "BUSCA:NENHUM");
  assert.equal(claim.expirado_em, null, "absence in search is not a definitive refusal");
});
