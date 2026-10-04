import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// Fluxos de dinheiro com a resposta do Mercado Pago TRAVADA depois dos headers.
// O prazo de 20 s vale para a operação HTTP inteira: o corpo que não termina vira
// AMBIGUO/TIMEOUT e cai no mesmo desfecho seguro do timeout de headers, em vez de
// pendurar a requisição e quebrar a premissa de que o POST termina antes do corte
// de recuperação (60 s).
//
// CHECKOUT: operação ENVIO_INCONCLUSIVO, 502 MERCADO_PAGO_INDISPONIVEL com o token do
// pedido, ledger PENDENTE, reserva intacta e nenhum segundo POST (nem no replay).
// REFUND:   intenção INCONCLUSIVO, nenhum fato financeiro e nenhum segundo POST na
// mesma passada.

const PRAZO_POST = app.mpPost.MP_PAYMENT_POST_TIMEOUT_MS;
const PRAZO_REFUND = app.mpRefund.MP_REFUND_TIMEOUT_MS;

const pendenteAteAbortar = signal =>
  new Promise((_, rejeitar) =>
    signal.addEventListener("abort", () => rejeitar(signal.reason), { once: true })
  );

// Headers 201 chegam e o corpo nunca termina (rejeita quando o prazo aborta o fetch).
const corpoTravado = signal => ({
  ok: true,
  status: 201,
  json: () => pendenteAteAbortar(signal),
  text: () => pendenteAteAbortar(signal)
});
// Nem os headers chegam.
const headersTravados = signal => pendenteAteAbortar(signal);

// Espera a promessa assentar sem usar setTimeout (sob mock de relógio): cede o event
// loop até assentar ou até esgotar o limite em tempo real.
async function assentarAte(promessa, limiteMs) {
  let assentou = false;
  let valor;
  promessa.then(
    v => {
      assentou = true;
      valor = v;
    },
    erro => {
      assentou = true;
      valor = { erro };
    }
  );
  const inicio = Date.now();
  while (!assentou && Date.now() - inicio < limiteMs) await new Promise(setImmediate);
  return assentou ? valor : "PENDENTE";
}

// Resolve quando o fluxo chama o Mercado Pago; falha cedo se o fluxo terminar antes.
const aguardarChamada = (chamou, fluxo) =>
  Promise.race([
    chamou,
    fluxo.then(r => {
      throw new Error(`o fluxo terminou sem chamar o Mercado Pago: ${JSON.stringify(r)}`);
    })
  ]);

const uuid = n => `xtrv-${n}-4000-8000-000000000000`;
const contar = async (db, sql) => (await db.prepare(sql).first()).n;

/* ───────────────────────────── CHECKOUT ───────────────────────────── */

for (const [nome, resposta] of [
  ["corpo do POST travado", corpoTravado],
  ["headers do POST travados (controle)", headersTravados]
]) {
  test(`CHECKOUT, ${nome}: termina no prazo em ENVIO_INCONCLUSIVO/502, sem segundo POST`, async t => {
    const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
    await db.prepare("DELETE FROM pedidos WHERE id=1").run();
    await db
      .prepare(
        "DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_itens','pedido_pagamentos')"
      )
      .run();
    await db.prepare("UPDATE produtos SET estoque=10, estoque_reservado=0 WHERE id=1").run();

    const posts = [];
    let chegou;
    const noPost = new Promise(r => {
      chegou = r;
    });
    t.mock.method(globalThis, "fetch", (url, opcoes) => {
      posts.push({
        url: String(url),
        metodo: opcoes?.method,
        key: opcoes?.headers?.["X-Idempotency-Key"]
      });
      chegou();
      return resposta(opcoes.signal);
    });
    const env = { DB: db, MP_ACCESS_TOKEN: "fake" };
    const requisicao = ip =>
      new Request("https://local.test/api/checkout", {
        method: "POST",
        headers: { Origin: "https://local.test", "CF-Connecting-IP": ip },
        body: JSON.stringify({
          items: [{ id: 1, quantity: 2 }],
          cliente: { nome: "Cliente Travado", whatsapp: "11999999999" },
          operationKey: uuid("checkout")
        })
      });

    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const fluxo = app.checkout.onRequestPost({ env, request: requisicao("10.0.9.1") });
      await aguardarChamada(noPost, fluxo);

      t.mock.timers.tick(PRAZO_POST - 1);
      assert.equal(await assentarAte(fluxo, 200), "PENDENTE", "antes do prazo segue em voo");

      t.mock.timers.tick(1);
      const res = await assentarAte(fluxo, 10_000);
      assert.notEqual(res, "PENDENTE", "o prazo de 20 s precisa encerrar a requisição");
      assert.equal(res.status, 502);
      const corpo = await res.json();
      assert.equal(corpo.code, "MERCADO_PAGO_INDISPONIVEL");
      assert.ok(corpo.tokenPublico, "o cliente recebe o token para acompanhar o pedido");

      // Estado persistido: inconclusivo e recuperável; nada inventado.
      assert.deepEqual(await db.prepare("SELECT fase, erro FROM pedido_operacoes").first(), {
        fase: "ENVIO_INCONCLUSIVO",
        erro: "AMBIGUO:TIMEOUT"
      });
      assert.deepEqual(
        await db.prepare("SELECT status, mp_payment_id FROM pedido_pagamentos").first(),
        { status: "PENDENTE", mp_payment_id: null },
        "o ledger segue PENDENTE (nunca FALHOU)"
      );
      assert.equal(await contar(db, "SELECT COUNT(*) n FROM pedidos"), 1);
      assert.equal(await contar(db, "SELECT COUNT(*) n FROM pedido_pagamentos"), 1);
      assert.deepEqual(
        await db
          .prepare(
            "SELECT p.reserva_status AS reserva, pr.estoque_reservado AS reservado FROM pedidos p, produtos pr WHERE pr.id=1"
          )
          .first(),
        { reserva: "ATIVA", reservado: 2 },
        "a reserva de estoque continua intacta"
      );

      // Nenhum segundo POST: nem com o tempo passando, nem no replay da mesma operationKey.
      t.mock.timers.tick(PRAZO_POST * 3);
      const replay = await app.checkout.onRequestPost({ env, request: requisicao("10.0.9.2") });
      assert.equal(replay.status, 409);
      assert.equal((await replay.json()).code, "OPERACAO_EM_PROCESSAMENTO");
      assert.equal(posts.length, 1, "exatamente um POST ao Mercado Pago");
      assert.equal(posts[0].metodo, "POST");
      assert.ok(posts[0].key, "o POST leva a key de idempotência estável");
    } finally {
      t.mock.timers.reset();
    }
  });
}

/* ───────────────────────────── REFUND ───────────────────────────── */

// Pagamento PIX_MP de 2000 PAGO sobre um item de 500: sobra saldo de 1500 para a anulação.
async function cenarioRefund(t) {
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
       mp_payment_id,idempotency_key,pago_em)
       VALUES(1,1,'PIX_MP','ADMIN',2000,'PAGO','9001','pix-paid',CURRENT_TIMESTAMP)`
    ),
    db.prepare(
      `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
       VALUES(1,1,1,500)`
    )
  ]);
  return db;
}

for (const [nome, resposta, ultimoErro] of [
  ["corpo do POST travado", corpoTravado, "TIMEOUT:201"],
  ["headers do POST travados (controle)", headersTravados, "TIMEOUT:SEM_HTTP"]
]) {
  test(`REFUND, ${nome}: intenção fica INCONCLUSIVO no prazo, sem segundo POST na mesma passada`, async t => {
    const db = await cenarioRefund(t);
    const posts = [];
    let chegou;
    const noPost = new Promise(r => {
      chegou = r;
    });
    t.mock.method(globalThis, "fetch", (url, opcoes) => {
      if (opcoes?.method === "POST" && String(url).endsWith("/refunds")) {
        posts.push({ key: opcoes.headers["X-Idempotency-Key"] });
        chegou();
        return resposta(opcoes.signal);
      }
      throw new Error(`rede inesperada: ${url}`);
    });
    const estado = async () => ({
      intencao: await db
        .prepare("SELECT status, tentativas, mp_refund_id FROM pedido_reembolso_pix_mp_intencoes")
        .first(),
      fase: (await db.prepare("SELECT fase FROM pedido_operacoes").first())?.fase,
      reembolsos: await contar(db, "SELECT COUNT(*) n FROM pedido_reembolsos")
    });

    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const passada = app.mpRefundIntent.reconcilePixMpRefundIntent(db, {
        pedidoId: 1,
        pagamentoId: 1,
        usuarioId: 1,
        operationKey: "xrefund-corpo-travado",
        fingerprint: "fp-corpo-travado",
        valorCentavos: 1500,
        accessToken: "TEST_TOKEN"
      });
      await aguardarChamada(noPost, passada);

      assert.deepEqual(await estado(), {
        intencao: { status: "PROCESSANDO", tentativas: 1, mp_refund_id: null },
        fase: "LOCAL_CRIADA",
        reembolsos: 0
      });
      t.mock.timers.tick(PRAZO_REFUND - 1);
      assert.equal(await assentarAte(passada, 200), "PENDENTE", "antes do prazo segue em voo");

      t.mock.timers.tick(1);
      const visao = await assentarAte(passada, 10_000);
      assert.notEqual(visao, "PENDENTE", "o prazo de 20 s precisa encerrar a passada");
      assert.equal(visao.ok, true);
      assert.equal(visao.intencao.status, "INCONCLUSIVO");
      assert.match(visao.intencao.ultimoErro, new RegExp(`^${ultimoErro}$`));

      // Nenhum fato financeiro e nenhum segundo POST na mesma passada.
      assert.deepEqual(await estado(), {
        intencao: { status: "INCONCLUSIVO", tentativas: 1, mp_refund_id: null },
        fase: "ENVIO_INCONCLUSIVO",
        reembolsos: 0
      });
      assert.equal(posts.length, 1, "exatamente um POST ao Mercado Pago nesta passada");
    } finally {
      t.mock.timers.reset();
    }
  });
}
