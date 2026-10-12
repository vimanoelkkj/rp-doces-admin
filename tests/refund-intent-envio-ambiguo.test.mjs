import test from "node:test";
import assert from "node:assert/strict";
import { mpResponse } from "./helpers/mp-orders.mjs";
import { app, fixture } from "./helpers/b3.mjs";

// Refund Pix MP (Orders): falha ANTES do envio (GET de baseline) não é exposição ao POST remoto.
// `tentativas` conta processamentos; o marcador de possível envio (`refund_dispatch.posts`) é
// persistido, sob CAS, imediatamente antes do POST. Só ele decide se uma recusa 4xx posterior é
// definitiva (primeira exposição) ou ambígua (já houve POST possivelmente aplicado).

const URL_ORDER = "https://api.mercadopago.com/v1/orders/ORD9001";
const URL_REFUND = `${URL_ORDER}/refund`;

async function cenario(t) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db.prepare(
      `UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',
       valor_total_centavos=500,status_pagamento='PAGO' WHERE id=1`
    ),
    db.prepare(
      `UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=500,valor_total_centavos=500 WHERE id=1`
    ),
    db.prepare(`UPDATE produtos SET estoque_reservado=1 WHERE id=1`),
    db.prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
       mp_payment_id,mp_order_id,idempotency_key,pago_em)
       VALUES(1,1,'PIX_MP','ADMIN',2000,'PAGO','PAY9001','ORD9001','pix-paid',CURRENT_TIMESTAMP)`
    ),
    db.prepare(
      `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
       VALUES(1,1,1,500)`
    )
  ]);
  return db;
}

// Simula o provedor por roteiro: cada GET/POST consome o próximo passo da sua fila.
function provedor(t, { gets = [], posts = [] } = {}) {
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const metodo = init.method ?? "GET";
    const alvo = String(url);
    const fila =
      metodo === "GET" && alvo === URL_ORDER
        ? gets
        : metodo === "POST" && alvo === URL_REFUND
          ? posts
          : null;
    if (!fila) throw new Error(`rede inesperada: ${metodo} ${alvo}`);
    chamadas.push({ metodo, chave: init.headers?.["X-Idempotency-Key"], corpo: init.body });
    const passo = fila.shift();
    if (passo === undefined) throw new Error(`sem passo para ${metodo}`);
    return typeof passo === "function" ? passo() : passo;
  });
  return chamadas;
}

const getOk = () => mpResponse({ id: 9001, status: "approved", transaction_amount: 20 });
const getFalhaRede = () => {
  throw new TypeError("fetch failed");
};
const getIndisponivel = () => new Response("{}", { status: 503 });
const postRecusado = () => Response.json({ message: "refund rejected" }, { status: 400 });
const postPerdido = () => {
  throw new Error("resposta perdida depois do commit do provedor");
};
const reconciliar = (db, operationKey = "refund-orders-01") =>
  app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
    pedidoId: 1,
    pagamentoId: 1,
    usuarioId: 1,
    operationKey,
    fingerprint: `fp-${operationKey}`,
    valorCentavos: 1500,
    accessToken: "TEST_TOKEN"
  });

const intencao = db =>
  db
    .prepare(
      `SELECT status,tentativas,ultimo_erro,mp_refund_id,mp_idempotency_key
       FROM pedido_reembolso_pix_mp_intencoes ORDER BY id DESC LIMIT 1`
    )
    .first();
const dispatch = async db => {
  const { resultado } = await db
    .prepare(`SELECT resultado FROM pedido_operacoes ORDER BY id DESC LIMIT 1`)
    .first();
  return JSON.parse(resultado).refund_dispatch;
};
const reservado = async db =>
  (
    await db
      .prepare(
        `SELECT COALESCE(SUM(valor_centavos),0) AS r FROM pedido_reembolso_pix_mp_intencoes
         WHERE status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO')`
      )
      .first()
  ).r;
const fase = async db =>
  (await db.prepare(`SELECT fase FROM pedido_operacoes ORDER BY id DESC LIMIT 1`).first()).fase;

for (const [nome, falha] of [
  ["rede", getFalhaRede],
  ["HTTP 503", getIndisponivel]
]) {
  test(`falha no GET de baseline (${nome}) não conta como exposição: 400 posterior é recusa definitiva`, async t => {
    const db = await cenario(t);
    const chamadas = provedor(t, { gets: [falha, getOk], posts: [postRecusado] });

    const primeira = await reconciliar(db);
    assert.equal(primeira.intencao.status, "INCONCLUSIVO");
    assert.equal(
      chamadas.filter(c => c.metodo === "POST").length,
      0,
      "nenhum POST antes do baseline"
    );
    assert.equal(await dispatch(db), undefined, "sem marcador: nunca houve possível envio");

    const segunda = await reconciliar(db);
    assert.equal(
      segunda.intencao.status,
      "RECUSADO",
      "primeira exposição recusada com 400 é definitiva"
    );
    const linha = await intencao(db);
    assert.equal(linha.status, "RECUSADO");
    assert.equal(linha.tentativas, 2, "tentativas continua contando processamentos");
    assert.match(linha.ultimo_erro, /^HTTP_400:/);
    assert.deepEqual(await dispatch(db), { posts: 1 });
    assert.equal(await fase(db), "RECUSADA");
    assert.equal(await reservado(db), 0, "recusa definitiva libera a capacidade");
    assert.equal(chamadas.filter(c => c.metodo === "POST").length, 1);
  });
}

test("duas falhas de GET antes do primeiro POST recusado: ainda recusa definitiva", async t => {
  const db = await cenario(t);
  provedor(t, { gets: [getFalhaRede, getIndisponivel, getOk], posts: [postRecusado] });
  await reconciliar(db);
  await reconciliar(db);
  const final = await reconciliar(db);
  assert.equal(final.intencao.status, "RECUSADO");
  assert.equal((await intencao(db)).tentativas, 3);
  assert.deepEqual(await dispatch(db), { posts: 1 });
});

test("POST recusado na primeira exposição é definitivo e o replay não chama o provedor", async t => {
  const db = await cenario(t);
  const chamadas = provedor(t, { gets: [getOk], posts: [postRecusado] });
  const recusado = await reconciliar(db);
  assert.equal(recusado.intencao.status, "RECUSADO");
  assert.equal((await intencao(db)).tentativas, 1);
  const total = chamadas.length;
  const replay = await reconciliar(db);
  assert.equal(replay.intencao.status, "RECUSADO");
  assert.equal(chamadas.length, total, "replay de intenção RECUSADA não toca a rede");
});

test("envio ambíguo seguido de 400 permanece inconclusivo, com a MESMA chave e capacidade reservada", async t => {
  const db = await cenario(t);
  const chamadas = provedor(t, { gets: [getOk, getOk], posts: [postPerdido, postRecusado] });

  const primeira = await reconciliar(db);
  assert.equal(primeira.intencao.status, "INCONCLUSIVO");
  assert.deepEqual(await dispatch(db), { posts: 1 });

  const segunda = await reconciliar(db);
  assert.equal(segunda.intencao.status, "INCONCLUSIVO", "o primeiro POST pode ter sido aplicado");
  assert.match((await intencao(db)).ultimo_erro, /^RECUSA_APOS_ENVIO_AMBIGUO:HTTP_400$/);
  assert.deepEqual(await dispatch(db), { posts: 2 });
  const posts = chamadas.filter(c => c.metodo === "POST");
  assert.equal(posts.length, 2);
  assert.equal(
    posts[0].chave,
    posts[1].chave,
    "a chave de idempotência de um POST possivelmente enviado nunca muda"
  );
  assert.equal(posts[0].corpo, posts[1].corpo);
  assert.equal(await reservado(db), 1500, "resultado remoto desconhecido não libera capacidade");
  assert.equal(await fase(db), "ENVIO_INCONCLUSIVO");
});

test("queda depois do marcador e antes do resultado é tratada conservadoramente", async t => {
  const db = await cenario(t);
  provedor(t, { gets: [getOk, getOk], posts: [postPerdido, postRecusado] });
  await reconciliar(db); // marcador posts=1 persistido, resultado perdido
  // Simula a queda do worker: a intenção ficou PROCESSANDO e a lease venceu.
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes SET status='PROCESSANDO',
       ultima_tentativa_em=datetime('now','-10 minutes'),atualizado_em=datetime('now','-10 minutes')`
    )
    .run();
  const expirada = await reconciliar(db);
  assert.equal(
    expirada.intencao.status,
    "INCONCLUSIVO",
    "lease vencida não reenvia POST cegamente"
  );
  assert.deepEqual(await dispatch(db), { posts: 1 });
  const final = await reconciliar(db);
  assert.equal(
    final.intencao.status,
    "INCONCLUSIVO",
    "recusa depois de marcador persistido é ambígua"
  );
  assert.equal(await reservado(db), 1500);
});

test("passadas sobrepostas da mesma operação: o claim barra a segunda e há um único POST e um único marcador", async t => {
  const db = await cenario(t);
  let liberar;
  const travado = new Promise(resolve => {
    liberar = resolve;
  });
  let noGet;
  const chegouNoGet = new Promise(resolve => {
    noGet = resolve;
  });
  const chamadas = provedor(t, {
    gets: [
      async () => {
        noGet();
        await travado; // a passada A fica parada no GET de baseline, já com o claim
        return getOk();
      }
    ],
    posts: [postPerdido, postPerdido]
  });
  const passadaA = reconciliar(db);
  await chegouNoGet;
  const passadaB = await reconciliar(db); // sobreposição real: A ainda está no GET
  assert.equal((await intencao(db)).status, "PROCESSANDO", "A detém o claim");
  assert.equal(passadaB.intencao.status, "PROCESSANDO", "B não adquire o claim nem dispara POST");
  assert.equal(chamadas.filter(c => c.metodo === "POST").length, 0);
  liberar();
  await passadaA;
  assert.equal(chamadas.filter(c => c.metodo === "POST").length, 1, "um único POST");
  assert.deepEqual(await dispatch(db), { posts: 1 });
  assert.equal(
    await reservado(db),
    1500,
    "efeito remoto desconhecido mantém a capacidade reservada"
  );
});

test("linha legada com baseline salvo mas sem marcador: exposições anteriores são presumidas (conservador)", async t => {
  const db = await cenario(t);
  const chamadas = provedor(t, { gets: [getOk], posts: [postRecusado] });
  await reconciliar(db); // cria a intenção; o POST é recusado de primeira
  // Reconstrói o estado anterior à mudança: baseline salvo, 2 tentativas, sem marcador.
  await db
    .prepare(
      `UPDATE pedido_operacoes SET fase='ENVIO_INCONCLUSIVO',
       resultado=json_object('refund_association',json_object('version',1,'before_ids',json('[]'),
         'order_id','ORD9001','payment_id','PAY9001'))`
    )
    .run();
  await db
    .prepare(
      `UPDATE pedido_reembolso_pix_mp_intencoes SET status='INCONCLUSIVO',tentativas=2,
       ultimo_erro='TIMEOUT:SEM_HTTP',recusado_em=NULL`
    )
    .run();
  provedor(t, { gets: [], posts: [postRecusado] });
  const final = await reconciliar(db);
  assert.equal(
    final.intencao.status,
    "INCONCLUSIVO",
    "presume que a tentativa anterior pode ter enviado"
  );
  // 2 tentativas anteriores presumidas como exposições + a atual.
  assert.deepEqual(await dispatch(db), { posts: 3 });
  assert.equal(chamadas.filter(c => c.metodo === "POST").length, 1);
});

test("sem baseline salvo (o GET nunca teve sucesso): a primeira exposição real recusada é definitiva", async t => {
  const db = await cenario(t);
  provedor(t, { gets: [getFalhaRede], posts: [] });
  await reconciliar(db); // tentativas=1, sem baseline, sem marcador
  provedor(t, { gets: [getOk], posts: [postRecusado] });
  const final = await reconciliar(db);
  assert.equal(final.intencao.status, "RECUSADO");
});

test("nova tentativa após recusa definitiva usa outra operationKey, preserva a intenção recusada e não reabre a antiga", async t => {
  const db = await cenario(t);
  const chamadas = provedor(t, { gets: [getOk, getOk], posts: [postRecusado, postPerdido] });

  const recusada = await reconciliar(db, "refund-orders-recusado");
  assert.equal(recusada.intencao.status, "RECUSADO");
  const antes = await db
    .prepare(
      `SELECT i.id,i.status,i.mp_idempotency_key,i.mp_request,i.tentativas,i.ultimo_erro
       FROM pedido_reembolso_pix_mp_intencoes i`
    )
    .first();

  const nova = await reconciliar(db, "refund-orders-nova-tentativa");
  assert.equal(nova.intencao.status, "INCONCLUSIVO", "nova operação, nova exposição");
  const todas = (
    await db
      .prepare(
        `SELECT id,status,mp_idempotency_key,mp_request,tentativas,ultimo_erro
         FROM pedido_reembolso_pix_mp_intencoes ORDER BY id`
      )
      .all()
  ).results;
  assert.equal(todas.length, 2);
  assert.deepEqual(
    { ...todas[0] },
    { ...antes },
    "a intenção recusada (chave, corpo, histórico) fica intocada"
  );
  assert.notEqual(todas[1].mp_idempotency_key, todas[0].mp_idempotency_key);
  const posts = chamadas.filter(c => c.metodo === "POST");
  assert.equal(posts.length, 2);
  assert.notEqual(
    posts[0].chave,
    posts[1].chave,
    "nova operação usa nova chave de idempotência remota"
  );

  // Replay da operationKey antiga continua RECUSADO e não toca a rede.
  const total = chamadas.length;
  const replay = await reconciliar(db, "refund-orders-recusado");
  assert.equal(replay.intencao.status, "RECUSADO");
  assert.equal(chamadas.length, total);
  assert.equal(
    await reservado(db),
    1500,
    "só a nova intenção (resultado desconhecido) reserva capacidade"
  );
});
