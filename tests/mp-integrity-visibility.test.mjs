import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";

// F1 da auditoria Orders: um Pix que o Mercado Pago confirma mas a conferência de integridade
// recusa continua NÃO pago (fail-closed, reserva retida) e precisa ficar visível ao operador a
// partir de fatos persistidos — lista administrativa e notificações —, não só em log.

const CHAVE = "pagamento:1:nao-conciliado:approved";
const CHAVE_DEVOLVIDA = "pagamento:1:nao-conciliado:refunded";
const DESTINO = "/admin/pedidos?pedido=1";

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

const refundedOrder = reference => ({
  id: "ORD101",
  type: "online",
  status: "refunded",
  status_detail: "refunded",
  external_reference: reference,
  total_amount: "100.00",
  country_code: "BRA",
  transactions: {
    payments: [
      {
        id: "PAY101",
        amount: "100.00",
        status: "refunded",
        status_detail: "refunded",
        payment_method: { id: "pix", type: "bank_transfer" }
      }
    ]
  }
});

// Todas as chamadas ao Mercado Pago respondem com `provider.order`: nenhuma rede real.
function mercadoPago(t) {
  const provider = { order: paidOrder() };
  t.mock.method(globalThis, "fetch", async () => Response.json(provider.order));
  return provider;
}

async function sync(db) {
  return app.sync.syncPaymentFromMp(db, 1, await app.orders.fetchMpOrder("fake", "ORD101"));
}

async function listaAdmin(db, query = "") {
  const session = await app.auth.createSession(db, 1);
  const response = await app.admin.onRequestGet({
    request: new Request(`https://local.test/api/admin/pedidos${query}`, {
      headers: { Cookie: session.cookie.split(";")[0] }
    }),
    env: { DB: db }
  });
  assert.equal(response.status, 200);
  return response.json();
}

const estoque = s => ({
  estoque: s.produtos[0].estoque,
  estoque_reservado: s.produtos[0].estoque_reservado,
  reserva_status: s.pedido.reserva_status
});
const RESERVA_RETIDA = { estoque: 10, estoque_reservado: 2, reserva_status: "ATIVA" };

for (const [codigo, alterar] of [
  ["VALOR_INVALIDO", o => (o.transactions.payments[0].amount = "abc")],
  ["VALOR_DIVERGENTE", o => (o.transactions.payments[0].amount = "99.00")],
  ["TOTAL_DIVERGENTE", o => (o.total_amount = "99.00")],
  ["METODO_DIVERGENTE", o => (o.transactions.payments[0].payment_method.id = "visa")],
  ["TIPO_METODO_DIVERGENTE", o => (o.transactions.payments[0].payment_method.type = "credit_card")],
  ["STATUS_ORDER_DIVERGENTE", o => (o.status_detail = "unexpected")],
  ["STATUS_TRANSACAO_DIVERGENTE", o => (o.transactions.payments[0].status_detail = "unexpected")],
  ["REFERENCIA_DIVERGENTE", o => (o.external_reference = "outro")],
  ["PAIS_DIVERGENTE", o => (o.country_code = "US")]
])
  test(`blocked ${codigo}: stays unpaid with the reserve held, yet is listed and notified`, async t => {
    const db = await fixture(t);
    const provider = mercadoPago(t);
    const alertas = t.mock.method(console, "error", () => {});
    provider.order = paidOrder(alterar);

    await sync(db);

    // Fail-closed intacto: nada de PAGO, baixa ou liberação.
    const s = await state(db);
    assert.equal(s.pagamentos[0].status, "PENDENTE");
    assert.equal(s.pagamentos[0].mp_status, "approved");
    assert.equal(s.pagamentos[0].mp_status_detail, `INTEGRIDADE_MP:${codigo}`);
    assert.equal(s.pedido.status_pagamento, "PENDENTE");
    assert.deepEqual(estoque(s), RESERVA_RETIDA);

    // Lista administrativa: o pedido do site aparece, sempre como NÃO pago.
    const lista = await listaAdmin(db);
    assert.deepEqual(
      lista.pedidos.map(p => [p.id, p.status_pagamento]),
      [[1, "PENDENTE"]]
    );
    assert.equal(lista.total, 1);
    assert.equal(lista.counts.todos, 1);

    // Notificação derivada do fato persistido, com destino e motivo; nenhuma de "pago".
    const { notificacoes, naoLidas } = await app.notificacoes.listarNotificacoes(db, 1);
    assert.deepEqual(
      notificacoes.map(n => [n.tipo, n.chave, n.destino, n.lida]),
      [["OPERACAO", CHAVE, DESTINO, false]]
    );
    assert.match(notificacoes[0].descricao, new RegExp(`RP-1 .*R\\$ 100,00.*${codigo}`));
    assert.equal(naoLidas, 1);

    // Sweeps e expiração local não mudam nada, não duplicam alerta e não soltam a reserva.
    await db
      .prepare("UPDATE pedidos SET reserva_expira_em=datetime('now','-1 hour') WHERE id=1")
      .run();
    await db
      .prepare("UPDATE pedido_pagamentos SET atualizado_em=datetime('now','-1 hour') WHERE id=1")
      .run();
    await app.sync.liberarReservasVencidasLocalmente({ DB: db });
    await app.sync.reconcilePendingPixPayments({ DB: db, MP_ACCESS_TOKEN: "fake" });
    const depois = await state(db);
    assert.equal(depois.pagamentos[0].status, "PENDENTE");
    assert.deepEqual(estoque(depois), RESERVA_RETIDA);
    assert.equal((await listaAdmin(db)).total, 1);
    assert.equal((await app.notificacoes.derivarNotificacoes(db)).length, 1);
    assert.equal(
      alertas.mock.calls.filter(c => c.arguments[1]?.code === "FINANCIAL_INTEGRITY_MISMATCH")
        .length,
      1
    );
  });

test("integrity pending is derived from durable facts and its read state persists", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  provider.order = paidOrder(o => (o.transactions.payments[0].amount = "99.00"));
  await sync(db);

  const leituras = () => db.prepare("SELECT COUNT(*) AS n FROM notificacao_leituras").first();
  assert.equal((await app.notificacoes.listarNotificacoes(db, 1)).naoLidas, 1);
  assert.equal((await leituras()).n, 0, "derivar não materializa nada");

  assert.equal(await app.notificacoes.marcarComoLidas(db, 1, [CHAVE]), 1);
  const lida = await app.notificacoes.listarNotificacoes(db, 1);
  assert.deepEqual(
    lida.notificacoes.map(n => [n.chave, n.lida]),
    [[CHAVE, true]]
  );
  assert.equal(lida.naoLidas, 0);
  assert.equal(
    await app.notificacoes.marcarComoLidas(db, 1, ["pagamento:999:nao-conciliado:approved"]),
    0
  );
});

test("once the verified GET passes the checks the payment is booked and the alert disappears", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  provider.order = paidOrder(o => (o.transactions.payments[0].amount = "99.00"));
  await sync(db);
  assert.equal((await app.notificacoes.derivarNotificacoes(db)).length, 1);

  provider.order = paidOrder();
  await sync(db);

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "PAGO");
  assert.equal(s.pedido.status_pagamento, "PAGO");
  assert.equal(s.produtos[0].estoque, 8);
  assert.equal(s.produtos[0].estoque_reservado, 0);
  const tipos = (await app.notificacoes.derivarNotificacoes(db)).map(n => n.tipo).sort();
  assert.deepEqual(tipos, ["PAGAMENTO", "PEDIDO"]);
  const lista = await listaAdmin(db);
  assert.deepEqual(
    lista.pedidos.map(p => [p.id, p.status_pagamento]),
    [[1, "PAGO"]]
  );
});

test("an unpaid site cart, a pending Pix and a recognized refund are not flagged", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});

  // Carrinho do site sem nenhuma captura remota: continua fora da lista (B-1) e sem notificação.
  assert.equal((await listaAdmin(db)).total, 0);
  assert.deepEqual(await app.notificacoes.derivarNotificacoes(db), []);

  // Pix ainda pendente no provedor: idem.
  provider.order = paidOrder(o => {
    o.status = o.transactions.payments[0].status = "action_required";
    o.status_detail = o.transactions.payments[0].status_detail = "waiting_transfer";
  });
  await sync(db);
  assert.equal((await state(db)).pagamentos[0].mp_status, "pending");
  assert.equal((await listaAdmin(db)).total, 0);
  assert.deepEqual(await app.notificacoes.derivarNotificacoes(db), []);

  // Devolução reconhecida (identidade compatível): vira REEMBOLSADO e não é captura pendente.
  provider.order = refundedOrder("token");
  await sync(db);
  const s = await state(db);
  assert.equal(s.pagamentos[0].status, "REEMBOLSADO");
  assert.equal((await listaAdmin(db)).total, 0);
  assert.deepEqual(await app.notificacoes.derivarNotificacoes(db), []);
});

test("a refund that needs reconciliation and a transition refused by the matrix are flagged too", async t => {
  const refunded = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  provider.order = refundedOrder("outra-referencia");
  await sync(refunded);
  const a = await state(refunded);
  assert.equal(a.pagamentos[0].status, "PENDENTE");
  assert.equal(a.pagamentos[0].mp_status_detail, "INTEGRIDADE_MP:REFUNDED_REQUER_CONCILIACAO");
  assert.deepEqual(estoque(a), RESERVA_RETIDA);
  assert.deepEqual(
    (await app.notificacoes.derivarNotificacoes(refunded)).map(n => n.chave),
    [CHAVE_DEVOLVIDA]
  );
  assert.equal((await listaAdmin(refunded)).total, 1);

  // CANCELADO local não vira PAGO (matriz), mas o dinheiro confirmado no provedor não some.
  const cancelled = await fixture(t);
  await cancelled
    .prepare("UPDATE pedido_pagamentos SET status='CANCELADO', cancelado_em=CURRENT_TIMESTAMP")
    .run();
  provider.order = paidOrder();
  await sync(cancelled);
  const b = await state(cancelled);
  assert.equal(b.pagamentos[0].status, "CANCELADO");
  assert.equal(b.pagamentos[0].mp_status, "approved");
  assert.equal(b.pedido.status_pagamento, "PENDENTE");
  assert.deepEqual(estoque(b), RESERVA_RETIDA);
  assert.deepEqual(
    (await app.notificacoes.derivarNotificacoes(cancelled)).map(n => n.chave),
    [CHAVE]
  );
  assert.equal((await listaAdmin(cancelled)).total, 1);
});

test("an unreconciled capture is pinned first and never pushed out of the notification cap", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  // Captura bloqueada antiga (payment 1) contra eventos novos suficientes para estourar o teto.
  await db
    .prepare(
      `UPDATE pedido_pagamentos SET mp_status='approved',
         mp_status_detail='INTEGRIDADE_MP:VALOR_DIVERGENTE', criado_em='2020-01-01 00:00:00',
         atualizado_em='2020-01-01 00:00:00'
       WHERE id=1`
    )
    .run();
  for (let i = 0; i < 12; i++) {
    const id = 100 + i;
    await db.batch([
      db
        .prepare(
          `INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado)
           VALUES(?,?,'BOLO',100,1,0)`
        )
        .bind(id, `Produto ${id}`),
      db
        .prepare(
          `INSERT INTO pedidos(id,cliente_nome,cliente_whatsapp,token_publico,idempotency_key,
             valor_total_centavos,status_pagamento,status_pedido,reserva_status)
           SELECT ?,cliente_nome,cliente_whatsapp,?,?,valor_total_centavos,'PAGO','NOVO','CONVERTIDA'
           FROM pedidos WHERE id=1`
        )
        .bind(id, `tok-${id}`, `ped-${id}`),
      db
        .prepare(
          `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
             idempotency_key,pago_em)
           VALUES(?,?,'DINHEIRO','ADMIN',10000,'PAGO',?,datetime('now'))`
        )
        .bind(id, id, `pag-${id}`)
    ]);
  }

  const derivadas = await app.notificacoes.derivarNotificacoes(db);
  const tipos = derivadas.map(n => n.tipo);
  assert.equal(derivadas.length, 30);
  assert.equal(derivadas[0].chave, CHAVE);
  assert.equal(tipos.filter(tipo => tipo === "OPERACAO").length, 1);
  assert.ok(tipos.includes("PEDIDO") && tipos.includes("PAGAMENTO") && tipos.includes("ESTOQUE"));
});

// Acima do teto de notificações por tipo (12), a lista administrativa continua sendo a fonte completa.
const NAO_CONCILIADOS = 15;
const idsEsperados = [1, ...Array.from({ length: NAO_CONCILIADOS - 1 }, (_, i) => 100 + i)];
const minutos = n =>
  new Date(Date.UTC(2026, 2, 10, 12, n)).toISOString().slice(0, 19).replace("T", " ");

// Pedido 1 (fixture, o mais antigo) + 14 pedidos de site com Pix aprovado no provedor e PENDENTE
// no ledger. `criado_em`/`atualizado_em` crescem com o id, ou coincidem todos se `empate`.
async function semearNaoConciliados(db, { empate = false } = {}) {
  const em = n => minutos(empate ? 0 : n);
  await db.batch([
    db.prepare("UPDATE pedidos SET criado_em=? WHERE id=1").bind(em(0)),
    db
      .prepare(
        `UPDATE pedido_pagamentos SET mp_status='approved', criado_em=?, atualizado_em=?,
           mp_status_detail='INTEGRIDADE_MP:VALOR_DIVERGENTE' WHERE id=1`
      )
      .bind(em(0), em(0))
  ]);
  for (let i = 1; i < NAO_CONCILIADOS; i++) {
    const id = 99 + i;
    await db.batch([
      db
        .prepare(
          `INSERT INTO pedidos(id,cliente_nome,cliente_whatsapp,token_publico,idempotency_key,
             valor_total_centavos,status_pagamento,status_pedido,reserva_status,criado_em)
           VALUES(?,?,'000',?,?,10000,'PENDENTE','NOVO','ATIVA',?)`
        )
        .bind(id, `Cliente ${id}`, `tok-${id}`, `ped-${id}`, em(i)),
      db
        .prepare(
          `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
             mp_order_id,mp_payment_id,mp_status,mp_status_detail,idempotency_key,criado_em,atualizado_em)
           VALUES(?,?,'PIX_MP','SITE',10000,'PENDENTE',?,?,'approved',
             'INTEGRIDADE_MP:VALOR_DIVERGENTE',?,?,?)`
        )
        .bind(id, id, `ORDT${id}`, `PAYT${id}`, `pagamento-${id}`, em(i), em(i))
    ]);
  }
}

test("above the notification cap every unreconciled capture is still reachable in the admin list", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  await semearNaoConciliados(db);
  // Carrinho sem captura remota: continua fora, então o total é exatamente 15.
  await db
    .prepare(
      `INSERT INTO pedidos(id,cliente_nome,cliente_whatsapp,token_publico,idempotency_key,
         valor_total_centavos,reserva_status) VALUES(200,'Carrinho','000','tok-200','ped-200',100,'ATIVA')`
    )
    .run();

  // Notificações: teto de 12 por tipo; ficam de fora os 3 pedidos mais antigos (1, 100 e 101).
  const derivadas = await app.notificacoes.derivarNotificacoes(db);
  assert.deepEqual(
    derivadas.map(n => [n.tipo, n.destino]),
    Array.from({ length: 12 }, (_, i) => ["OPERACAO", `/admin/pedidos?pedido=${113 - i}`])
  );

  // Lista: as duas páginas somam os 15, sem repetir nem perder nenhum, do mais novo ao mais antigo.
  const [p1, p2] = [await listaAdmin(db, "?page=1"), await listaAdmin(db, "?page=2")];
  assert.deepEqual(
    [p1.total, p1.totalPages, p1.counts.todos, p1.counts.novos],
    [NAO_CONCILIADOS, 2, NAO_CONCILIADOS, NAO_CONCILIADOS]
  );
  assert.deepEqual(
    p1.pedidos.map(p => p.id),
    [113, 112, 111, 110, 109, 108, 107, 106]
  );
  assert.deepEqual(
    p2.pedidos.map(p => p.id),
    [105, 104, 103, 102, 101, 100, 1]
  );
  assert.ok([...p1.pedidos, ...p2.pedidos].every(p => p.status_pagamento === "PENDENTE"));

  // Os sem notificação também se acham pela busca e pela aba "novos".
  for (const [busca, id] of [
    ["RP-100", 100],
    ["RP-101", 101],
    ["Teste", 1]
  ])
    assert.deepEqual(
      (await listaAdmin(db, `?search=${busca}`)).pedidos.map(p => p.id),
      [id]
    );
  assert.equal((await listaAdmin(db, "?status=novos&page=2")).pedidos.length, 7);
});

test("pagination of unreconciled captures stays complete when every order shares the same second", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  await semearNaoConciliados(db, { empate: true });

  const paginas = [await listaAdmin(db, "?page=1"), await listaAdmin(db, "?page=2")];
  assert.deepEqual(
    paginas.map(p => p.pedidos.length),
    [8, 7]
  );
  assert.deepEqual(
    paginas.flatMap(p => p.pedidos.map(x => x.id)).sort((a, b) => a - b),
    idsEsperados
  );
});

test("every query that probes unreconciled captures is served by the partial index", async t => {
  const db = await fixture(t);
  const consultas = [];
  db.hook = async wire => {
    consultas.push(...wire);
    return wire;
  };
  await listaAdmin(db);
  await app.notificacoes.derivarNotificacoes(db);
  db.hook = null;

  // Contagem, página, contadores das abas e notificação; o índice só vale com o WHERE idêntico.
  const sondas = consultas.filter(c => c.sql.includes("IN ('approved', 'refunded')"));
  assert.equal(sondas.length, 4);
  for (const { sql, args } of sondas) {
    const plano = (
      await db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...args)
        .all()
    ).results
      .map(linha => linha.detail)
      .join(" | ");
    assert.match(plano, /idx_pedido_pagamentos_captura_nao_conciliada/, sql.slice(0, 80));
  }
});

test("the alert key follows mp_status: a refund after the capture is a new unread alert", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  provider.order = paidOrder(o => (o.transactions.payments[0].amount = "99.00"));
  await sync(db);
  assert.equal(await app.notificacoes.marcarComoLidas(db, 1, [CHAVE]), 1);
  assert.equal((await app.notificacoes.listarNotificacoes(db, 1)).naoLidas, 0);

  // O provedor devolve o Pix antes de qualquer conciliação: outro fato, outro alerta.
  provider.order = refundedOrder("outra-referencia");
  await sync(db);

  const { notificacoes, naoLidas } = await app.notificacoes.listarNotificacoes(db, 1);
  assert.deepEqual(
    notificacoes.map(n => [n.chave, n.lida]),
    [[CHAVE_DEVOLVIDA, false]]
  );
  assert.equal(naoLidas, 1);
  assert.equal(await app.notificacoes.marcarComoLidas(db, 1, [CHAVE]), 0);
});

test("the alert calls the local charge approved or refunded at the provider, never paid", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  // O provedor aprova outro valor (99,00): o texto não pode afirmar que R$ 100,00 foi pago.
  provider.order = paidOrder(o => (o.transactions.payments[0].amount = "99.00"));
  await sync(db);
  const [aprovada] = await app.notificacoes.derivarNotificacoes(db);
  assert.match(
    aprovada.descricao,
    /^RP-1 · cobrança Pix de R\$ 100,00 aprovada no Mercado Pago, não conciliada \(VALOR_DIVERGENTE\)/
  );
  assert.doesNotMatch(aprovada.descricao, /\bpago\b/);

  provider.order = refundedOrder("outra-referencia");
  await sync(db);
  const [devolvida] = await app.notificacoes.derivarNotificacoes(db);
  assert.match(
    devolvida.descricao,
    /^RP-1 · cobrança Pix de R\$ 100,00 devolvida no Mercado Pago, não conciliada \(REFUNDED_REQUER_CONCILIACAO\)/
  );
  assert.doesNotMatch(devolvida.descricao, /\bpago\b/);
});

test("alert order and age follow the charge creation, not the repoll that rewrites atualizado_em", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  await semearNaoConciliados(db);
  const antes = await app.notificacoes.derivarNotificacoes(db);

  // Um repoll do Mercado Pago sobre a captura mais antiga regrava atualizado_em, não o fato.
  await db.prepare("UPDATE pedido_pagamentos SET atualizado_em=datetime('now') WHERE id=1").run();

  const depois = await app.notificacoes.derivarNotificacoes(db);
  assert.deepEqual(depois, antes);
  assert.deepEqual(
    depois.map(n => n.em),
    Array.from({ length: 12 }, (_, i) => minutos(14 - i))
  );
});

test("reading the admin list and the notifications writes nothing", async t => {
  const db = await fixture(t);
  const provider = mercadoPago(t);
  t.mock.method(console, "error", () => {});
  provider.order = paidOrder(o => (o.transactions.payments[0].amount = "99.00"));
  await sync(db);
  const antes = await state(db);

  await listaAdmin(db);
  await app.notificacoes.derivarNotificacoes(db);
  await app.notificacoes.listarNotificacoes(db, 1);

  // Pagamentos, reembolsos, operações, alocações e estado de estoque dos itens ficam como estavam.
  assert.deepEqual(await state(db), antes);
});

test("a payment that is not an unreconciled PIX_MP capture is never flagged", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  for (const [caso, alterar] of [
    ["approved at another method", "metodo='PIX_EXTERNO', mp_status='approved'"],
    ["rejected at the provider", "metodo='PIX_MP', mp_status='rejected'"],
    ["cancelled at the provider", "metodo='PIX_MP', mp_status='cancelled'"],
    ["no provider status", "metodo='PIX_MP', mp_status=NULL"],
    ["empty provider status", "metodo='PIX_MP', mp_status=''"]
  ]) {
    await db.prepare(`UPDATE pedido_pagamentos SET ${alterar} WHERE id=1`).run();
    assert.equal((await listaAdmin(db)).total, 0, caso);
    assert.deepEqual(await app.notificacoes.derivarNotificacoes(db), [], caso);
  }
});

test("mp_status casing is irrelevant and several unreconciled rows of one order list it once", async t => {
  const db = await fixture(t);
  t.mock.method(console, "error", () => {});
  await db.batch([
    db.prepare(
      `UPDATE pedido_pagamentos SET mp_status='APPROVED', criado_em='2026-03-10 12:00:00',
         mp_status_detail='INTEGRIDADE_MP:VALOR_DIVERGENTE' WHERE id=1`
    ),
    db.prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_order_id,
         mp_payment_id,mp_status,mp_status_detail,idempotency_key,criado_em)
       VALUES(2,1,'PIX_MP','ADMIN',10000,'CANCELADO','ORD102','PAY102','Refunded',
         'INTEGRIDADE_MP:REFUNDED_REQUER_CONCILIACAO','pagamento-2','2026-03-10 12:05:00')`
    )
  ]);

  const lista = await listaAdmin(db);
  assert.deepEqual(
    lista.pedidos.map(p => p.id),
    [1]
  );
  assert.deepEqual([lista.total, lista.counts.todos], [1, 1]);
  assert.deepEqual(
    (await app.notificacoes.derivarNotificacoes(db)).map(n => n.chave),
    ["pagamento:2:nao-conciliado:refunded", "pagamento:1:nao-conciliado:approved"]
  );
});
