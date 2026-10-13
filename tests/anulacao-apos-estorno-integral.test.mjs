import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";

// Exclusão (anulação) após estorno integral de Pix Mercado Pago.
// A staging recusava QUALQUER histórico PIX_MP (ANULACAO_EXPOSICAO_PIX_REMOTA). O correto: liberar
// só quando cada perna Pix está paga E integralmente estornada (prova do ledger), sem pendência,
// sem captura não conciliada e sem operação/cobrança não resolvida. O resto continua bloqueado.

const EXPOSICAO = "ANULACAO_EXPOSICAO_PIX_REMOTA";
const CAPTURA = "CAPTURA_MP_NAO_CONCILIADA";

const anular = (db, session, devolverEstoque = true) =>
  app.adminVoid.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: "1" },
    waitUntil() {},
    request: new Request("https://local.test/api/admin/pedidos/1/anulacao", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: session.cookie.split(";")[0],
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ devolverEstoque, motivo: "Exclusão após estorno" })
    })
  });

async function pago(t) {
  const db = await fixture(t, { paid: true, reserve: "CONVERTIDA" });
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("rede inesperada: anulação não pode chamar o Mercado Pago aqui");
  });
  return { db, session: await app.auth.createSession(db, 1) };
}

let seq = 0;
const reembolso = (
  db,
  {
    pagamentoId = 1,
    valor,
    origem = "MERCADO_PAGO",
    metodo = "PIX_MP",
    status = "REEMBOLSADO",
    refundId = true
  }
) =>
  db
    .prepare(
      `INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,mp_refund_id,idempotency_key)
       VALUES(1,?,?,?,?,?,?,?)`
    )
    .bind(
      pagamentoId,
      origem,
      metodo,
      valor,
      status,
      refundId ? `refund-real-${++seq}` : null,
      `idem-refund-${++seq}`
    )
    .run();

const historico = async db => ({
  pagamentos: (await db.prepare("SELECT * FROM pedido_pagamentos ORDER BY id").all()).results,
  reembolsos: (await db.prepare("SELECT * FROM pedido_reembolsos ORDER BY id").all()).results,
  operacoes: (await db.prepare("SELECT * FROM pedido_operacoes ORDER BY id").all()).results,
  alocacoes: (await db.prepare("SELECT * FROM pedido_pagamento_alocacoes ORDER BY id").all())
    .results
});
const anulacoes = async db =>
  (await db.prepare("SELECT COUNT(*) n FROM pedido_anulacoes").first()).n;

async function bloqueado(db, session, codigo) {
  const antes = await state(db);
  const response = await anular(db, session);
  assert.equal(response.status, 409);
  if (codigo) assert.equal((await response.json()).code, codigo);
  assert.deepEqual(await state(db), antes, "recusa não altera nada");
  assert.equal(await anulacoes(db), 0);
}

test("estorno integral confirmado pelo Mercado Pago libera a exclusão e preserva todo o histórico", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  const antes = await historico(db);
  const response = await anular(db, session);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).anulacao.liquido_original_centavos, 0);
  assert.deepEqual(
    await historico(db),
    antes,
    "pagamentos, refunds, operações e alocações intocados"
  );
  assert.equal(await anulacoes(db), 1);
});

test("estorno manual PIX_MP integral ('devolvido por fora') também libera", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000, origem: "MANUAL", refundId: false });
  assert.equal((await anular(db, session)).status, 200);
});

test("estorno integral em duas parcelas confirmadas libera", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 6000 });
  await reembolso(db, { valor: 4000 });
  assert.equal((await anular(db, session)).status, 200);
});

test("duas pernas Pix, ambas integralmente estornadas, liberam; com uma parcial continua bloqueado", async t => {
  const { db, session } = await pago(t);
  await db.batch([
    db.prepare(`UPDATE pedidos SET valor_total_centavos=15000 WHERE id=1`),
    db.prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_order_id,mp_payment_id,idempotency_key,pago_em)
       VALUES(2,1,'PIX_MP','ADMIN',5000,'PAGO','ORD202','PAY202','pix-2',CURRENT_TIMESTAMP)`
    )
  ]);
  await reembolso(db, { pagamentoId: 1, valor: 10000 });
  await reembolso(db, { pagamentoId: 2, valor: 4000 });
  await bloqueado(db, session, EXPOSICAO);
  await reembolso(db, { pagamentoId: 2, valor: 1000 });
  assert.equal((await anular(db, session)).status, 200);
});

test("pedido misto: Pix integralmente estornado + dinheiro recebido continua anulável", async t => {
  const { db, session } = await pago(t);
  await db.batch([
    db.prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
       VALUES(2,1,'DINHEIRO','ADMIN',3000,'PAGO','dinheiro-2',CURRENT_TIMESTAMP)`
    )
  ]);
  await reembolso(db, { valor: 10000 });
  assert.equal((await anular(db, session)).status, 200);
});

// --- Controles negativos: dinheiro ainda exposto continua bloqueando -------------------------

test("sem estorno, estorno parcial e estorno que não prova devolução continuam bloqueados", async t => {
  const { db, session } = await pago(t);
  await bloqueado(db, session);
  await reembolso(db, { valor: 9999 });
  await bloqueado(db, session);
  await reembolso(db, { valor: 1, origem: "MANUAL", metodo: "DINHEIRO", refundId: false }); // não prova Pix
  await bloqueado(db, session);
  await reembolso(db, { valor: 1, refundId: false }); // MERCADO_PAGO sem mp_refund_id: sem correspondência
  await bloqueado(db, session);
  await reembolso(db, { valor: 1, status: "PENDENTE" }); // não confirmado
  await bloqueado(db, session);
});

test("refund em andamento ou inconclusivo bloqueia mesmo com parte já estornada", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 6000 });
  await db.batch([
    db.prepare(
      `INSERT INTO pedido_operacoes(operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,mp_idempotency_key,mp_request,mp_payment_id,ator_usuario_id)
       VALUES('refund-em-voo','REFUND_ADMIN','ADMIN',1,'fp','LOCAL_CRIADA',1,1,'key-voo','{"transactions":[]}','PAY101',1)`
    ),
    db.prepare(
      `INSERT INTO pedido_reembolso_pix_mp_intencoes(operacao_id,pedido_id,pagamento_id,valor_centavos,mp_payment_id,mp_idempotency_key,mp_request,status)
       SELECT id,1,1,4000,'PAY101','key-voo','{"transactions":[]}','INCONCLUSIVO' FROM pedido_operacoes WHERE operation_key='refund-em-voo'`
    )
  ]);
  await bloqueado(db, session);
});

test("captura tardia não conciliada bloqueia mesmo com o Pix anterior integralmente estornado", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_status,mp_order_id,mp_payment_id,idempotency_key)
       VALUES(2,1,'PIX_MP','ADMIN',500,'EXPIRADO','approved','ORD303','PAY303','pix-tardio')`
    )
    .run();
  await bloqueado(db, session, CAPTURA);
});

for (const status of ["PENDENTE", "EXPIRADO", "CANCELADO", "FALHOU"]) {
  test(`outra cobrança Pix ${status} no pedido continua bloqueando (cobrança remota potencialmente ativa)`, async t => {
    const { db, session } = await pago(t);
    await reembolso(db, { valor: 10000 });
    await db
      .prepare(
        `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_order_id,mp_payment_id,idempotency_key)
         VALUES(2,1,'PIX_MP','ADMIN',500,?,'ORD404','PAY404','pix-outra')`
      )
      .bind(status)
      .run();
    await bloqueado(db, session);
  });
}

for (const fase of ["LOCAL_CRIADA", "ENVIO_INCONCLUSIVO", "REMOTO_CONHECIDO", "RECUSADA"]) {
  test(`operação Pix sem pagamento quitado (${fase}) continua bloqueando`, async t => {
    const { db, session } = await pago(t);
    await reembolso(db, { valor: 10000 });
    await db
      .prepare(
        `INSERT INTO pedido_operacoes(operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,mp_idempotency_key,mp_request,ator_usuario_id)
         VALUES('op-orfa','PIX_ADMIN','ADMIN',1,'fp',?,1,'key-orfa','{"external_reference":"x"}',1)`
      )
      .bind(fase)
      .run();
    await bloqueado(db, session);
  });
}

test("histórico legado em pedidos.mp_* sem pagamento correspondente quitado continua bloqueando", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await db.prepare(`UPDATE pedidos SET mp_payment_id='PAY-LEGADO-SEM-LEDGER' WHERE id=1`).run();
  await bloqueado(db, session);
});

test("o banco recusa a mesma exclusão dentro do batch quando uma cobrança chega entre a checagem e a escrita", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  let inserida = false;
  db.hook = async (statements, kind) => {
    if (kind !== "batch" || !statements[0].sql.includes("INSERT INTO pedido_anulacoes"))
      return statements;
    inserida = true;
    await db
      .prepare(
        `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key)
         VALUES(2,1,'PIX_MP','ADMIN',500,'CANCELADO','pix-corrida')`
      )
      .run();
    return statements;
  };
  const antes = await state(db);
  const response = await anular(db, session);
  db.hook = null;
  assert.equal(inserida, true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, EXPOSICAO, "o trigger 0041 (não o 0031) recusou");
  assert.equal(await anulacoes(db), 0, "o batch inteiro reverteu");
  const depois = await state(db);
  assert.equal(
    depois.produtos?.[0]?.estoque ?? antes.produtos?.[0]?.estoque,
    antes.produtos?.[0]?.estoque
  );
});

const INSERT_ANULACAO = `INSERT INTO pedido_anulacoes(pedido_id,motivo,estoque_acao,criado_por_usuario_id,usuario_nome,total_original_centavos,bruto_original_centavos,reembolsado_original_centavos,liquido_original_centavos,estoque_snapshot)
  VALUES(1,'direto no banco','MANTER',1,'Teste',10000,10000,10000,0,'[]')`;

test("trigger do banco decide igual à aplicação: recusa sem quitação e aceita com quitação integral", async t => {
  const { db } = await pago(t);
  await assert.rejects(
    db.prepare(INSERT_ANULACAO).run(),
    /ANULACAO_EXPOSICAO_PIX_REMOTA|ANULACAO_MP_RECEBIDO/
  );
  await reembolso(db, { valor: 9999 });
  await assert.rejects(
    db.prepare(INSERT_ANULACAO).run(),
    /ANULACAO_EXPOSICAO_PIX_REMOTA|ANULACAO_MP_RECEBIDO/
  );
  await reembolso(db, { valor: 1 });
  await db.prepare(INSERT_ANULACAO).run();
  assert.equal(await anulacoes(db), 1);
});

test("trigger do banco: outra cobrança Pix ou captura tardia recusam mesmo após quitação integral", async t => {
  for (const [sql, esperado] of [
    [
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(2,1,'PIX_MP','ADMIN',500,'CANCELADO','pix-extra')`,
      /ANULACAO_EXPOSICAO_PIX_REMOTA/
    ],
    [
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_status,idempotency_key) VALUES(2,1,'PIX_MP','ADMIN',500,'CANCELADO','approved','pix-tardio')`,
      // Os dois triggers BEFORE INSERT (0040/0041) recusam; qualquer um dos códigos interrompe o batch.
      /CAPTURA_MP_NAO_CONCILIADA|ANULACAO_EXPOSICAO_PIX_REMOTA/
    ]
  ]) {
    const { db } = await pago(t);
    await reembolso(db, { valor: 10000 });
    await db.prepare(sql).run();
    await assert.rejects(db.prepare(INSERT_ANULACAO).run(), esperado);
    assert.equal(await anulacoes(db), 0);
  }
});

test("migration 0041 é aditiva: só recria o trigger de exposição, com o mesmo nome e a mesma ação", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile("migrations/0041_anulacao_exposicao_pix_quitada.sql", "utf8");
  const codigo = sql.replace(/--[^\n]*/g, "");
  assert.equal((codigo.match(/\bDROP\b/gi) ?? []).length, 1);
  assert.match(codigo, /DROP TRIGGER IF EXISTS pedido_anulacoes_bloquear_exposicao_pix_remota;/);
  assert.equal((codigo.match(/\bCREATE\b/gi) ?? []).length, 1);
  assert.match(codigo, /BEFORE INSERT ON pedido_anulacoes/);
  assert.match(codigo, /RAISE\(ABORT, 'ANULACAO_EXPOSICAO_PIX_REMOTA'\)/);
  assert.doesNotMatch(codigo, /\b(ALTER|DELETE FROM|INSERT INTO|UPDATE\s+\w+\s+SET|DROP TABLE)\b/i);
});

// --- Associação operação ↔ pagamento quitado: pertencimento ao pedido e identidade remota -----

let opSeq = 0;
const operacaoPix = (
  db,
  {
    tipo = "CHECKOUT_SITE",
    fase = "CONCLUIDA",
    pedidoId = 1,
    pagamentoId = 1,
    mpPaymentId = "PAY101"
  } = {}
) =>
  db
    .prepare(
      `INSERT INTO pedido_operacoes(operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,mp_idempotency_key,mp_request,mp_payment_id,ator_usuario_id)
       VALUES(?,?,'ADMIN',1,'fp',?,?,?,?,'{"external_reference":"ref"}',?,1)`
    )
    .bind(
      `op-assoc-${++opSeq}`,
      tipo,
      fase,
      pedidoId,
      pagamentoId,
      `key-assoc-${opSeq}`,
      mpPaymentId
    )
    .run();

async function pedidoDois(db) {
  await db.batch([
    db.prepare(
      `INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key)
       VALUES(2,'token-dois','Outro','000',100,'pedido-2')`
    ),
    db.prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_order_id,mp_payment_id,idempotency_key,pago_em)
       VALUES(2,2,'PIX_MP','SITE',100,'PAGO','ORD202','PAY202','pix-pedido-2',CURRENT_TIMESTAMP)`
    ),
    db.prepare(
      `INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,mp_refund_id,idempotency_key)
       VALUES(2,2,'MERCADO_PAGO','PIX_MP',100,'REEMBOLSADO','refund-pedido-2','idem-pedido-2')`
    )
  ]);
}

for (const tipo of ["CHECKOUT_SITE", "PIX_ADMIN"]) {
  test(`operação ${tipo} CONCLUIDA com a identidade da perna quitada do próprio pedido libera`, async t => {
    const { db, session } = await pago(t);
    await reembolso(db, { valor: 10000 });
    await operacaoPix(db, { tipo });
    assert.equal((await anular(db, session)).status, 200);
  });
}

test("operação que aponta para pagamento quitado de OUTRO pedido continua bloqueando", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await pedidoDois(db);
  await operacaoPix(db, { pagamentoId: 2, mpPaymentId: "PAY202" });
  await bloqueado(db, session, EXPOSICAO);
});

test("operação com mp_payment_id divergente do pagamento quitado continua bloqueando", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await operacaoPix(db, { mpPaymentId: "PAY-OUTRO" });
  await bloqueado(db, session, EXPOSICAO);
});

test("operação sem identidade remota registrada (mp_payment_id nulo) continua bloqueando", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await operacaoPix(db, { mpPaymentId: null });
  await bloqueado(db, session, EXPOSICAO);
});

for (const fase of ["LOCAL_CRIADA", "ENVIO_INCONCLUSIVO", "REMOTO_CONHECIDO", "RECUSADA"]) {
  test(`operação com a identidade certa mas fase ${fase} (não concluída) continua bloqueando`, async t => {
    const { db, session } = await pago(t);
    await reembolso(db, { valor: 10000 });
    await operacaoPix(db, { fase });
    await bloqueado(db, session, EXPOSICAO);
  });
}

test("regeneração Pix nunca é isentada, nem apontando para a perna quitada com identidade correta", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await operacaoPix(db, { tipo: "PIX_ADMIN_REGENERACAO" });
  await bloqueado(db, session, EXPOSICAO);
});

test("operação ligada a pagamento que não é Pix (DINHEIRO) continua bloqueando", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key,pago_em)
       VALUES(2,1,'DINHEIRO','ADMIN',100,'PAGO','PAY101-DIN','dinheiro-op',CURRENT_TIMESTAMP)`
    )
    .run();
  await operacaoPix(db, { pagamentoId: 2, mpPaymentId: "PAY101-DIN" });
  await bloqueado(db, session, EXPOSICAO);
});

test("mp_payment_id duplicado em outro pagamento (identidade ambígua) bloqueia", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await pedidoDois(db);
  await db.prepare(`UPDATE pedido_pagamentos SET mp_payment_id='PAY101' WHERE id=2`).run();
  await operacaoPix(db);
  await bloqueado(db, session, EXPOSICAO);
});

test("identidade da perna incoerente (sem ids, ou mistura Orders/Payments) não conta como quitada", async t => {
  for (const [orderId, paymentId] of [
    [null, null],
    ["ORD101", "9001"],
    [null, "PAY101"],
    ["ORD101", null]
  ]) {
    const { db, session } = await pago(t);
    await db
      .prepare("UPDATE pedido_pagamentos SET mp_order_id=?,mp_payment_id=? WHERE id=1")
      .bind(orderId, paymentId)
      .run();
    await reembolso(db, { valor: 10000 });
    await bloqueado(db, session, EXPOSICAO);
  }
});

test("pagamento histórico Payments (id numérico, sem ORD) integralmente estornado libera", async t => {
  const { db, session } = await pago(t);
  await db
    .prepare("UPDATE pedido_pagamentos SET mp_order_id=NULL,mp_payment_id='9001' WHERE id=1")
    .run();
  await db.prepare("UPDATE pedidos SET mp_payment_id='9001' WHERE id=1").run();
  await reembolso(db, { valor: 10000 });
  await operacaoPix(db, { mpPaymentId: "9001" });
  assert.equal((await anular(db, session)).status, 200);
});

// --- Teto: refunds somando acima do pago são anomalia, não quitação ----------------------------

test("refunds confirmados somando MAIS que o pago são divergência financeira e bloqueiam", async t => {
  const { db, session } = await pago(t);
  await reembolso(db, { valor: 10000 });
  await reembolso(db, { valor: 5000, origem: "MANUAL", refundId: false });
  await bloqueado(db, session, EXPOSICAO);
});

test("refund de outro pedido apontando para o pagamento não conta na quitação", async t => {
  const { db, session } = await pago(t);
  await pedidoDois(db);
  await db
    .prepare(
      `INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,mp_refund_id,idempotency_key)
       VALUES(2,1,'MERCADO_PAGO','PIX_MP',10000,'REEMBOLSADO','refund-cruzado','idem-cruzado')`
    )
    .run();
  await bloqueado(db, session, EXPOSICAO);
});

test("guard de migrations: o sqlite_master.sql REAL instalado casa com a definição extraída da 0041", async t => {
  const { readFile } = await import("node:fs/promises");
  const { schemaMarkers, normalizeDefinition } = await import("../scripts/check-d1-migrations.mjs");
  const { db } = await pago(t);
  const instalado = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='pedido_anulacoes_bloquear_exposicao_pix_remota'"
    )
    .first();
  const esperado = schemaMarkers(
    await readFile("migrations/0041_anulacao_exposicao_pix_quitada.sql", "utf8")
  ).objects.find(o => o.name === "pedido_anulacoes_bloquear_exposicao_pix_remota");
  assert.ok(esperado.definition, "marcador carrega a definição do trigger");
  assert.equal(normalizeDefinition(instalado.sql), esperado.definition);
  const antiga = schemaMarkers(
    await readFile("migrations/0040_anulacao_captura_nao_conciliada.sql", "utf8")
  ).objects.find(o => o.name === "pedido_anulacoes_bloquear_exposicao_pix_remota");
  assert.notEqual(antiga.definition, esperado.definition, "0040 e 0041 são distinguíveis");
});

// --- Lógica de três valores do SQLite: identidade incompleta é AUSÊNCIA de prova -------------
// NOT (NULL) é NULL; sem COALESCE o EXISTS deixava de enxergar a perna e a exclusão passava.
// Pedido de Pix administrativo não grava pedidos.mp_*, então o braço legado não mascara o defeito.

const IDENTIDADES_INCOMPLETAS = [
  ["order=NULL, payment=NULL", null, null],
  ["order='ORD101', payment=NULL", "ORD101", null],
  ["order=NULL, payment='PAY101'", null, "PAY101"]
];

async function semColunasLegadas(db) {
  await db
    .prepare(
      "UPDATE pedidos SET mp_payment_id=NULL,mp_qr_code=NULL,mp_qr_code_base64=NULL,mp_ticket_url=NULL WHERE id=1"
    )
    .run();
}

for (const [nome, orderId, paymentId] of IDENTIDADES_INCOMPLETAS) {
  test(`endpoint: Pix PAGO e estornado com identidade incompleta (${nome}) bloqueia`, async t => {
    const { db, session } = await pago(t);
    await semColunasLegadas(db);
    await db
      .prepare("UPDATE pedido_pagamentos SET mp_order_id=?,mp_payment_id=? WHERE id=1")
      .bind(orderId, paymentId)
      .run();
    await reembolso(db, { valor: 10000 });
    await bloqueado(db, session, EXPOSICAO);
  });

  test(`trigger direto: identidade incompleta (${nome}) recusa a anulação no banco`, async t => {
    const { db } = await pago(t);
    await semColunasLegadas(db);
    await db
      .prepare("UPDATE pedido_pagamentos SET mp_order_id=?,mp_payment_id=? WHERE id=1")
      .bind(orderId, paymentId)
      .run();
    await reembolso(db, { valor: 10000 });
    await assert.rejects(db.prepare(INSERT_ANULACAO).run(), /ANULACAO_EXPOSICAO_PIX_REMOTA/);
    assert.equal(await anulacoes(db), 0);
  });

  test(`corrida: identidade apagada (${nome}) depois da checagem e antes do batch aborta tudo`, async t => {
    const { db, session } = await pago(t);
    await semColunasLegadas(db);
    await reembolso(db, { valor: 10000 });
    let disparou = false;
    db.hook = async (statements, kind) => {
      if (kind !== "batch" || !statements[0].sql.includes("INSERT INTO pedido_anulacoes"))
        return statements;
      disparou = true;
      await db
        .prepare("UPDATE pedido_pagamentos SET mp_order_id=?,mp_payment_id=? WHERE id=1")
        .bind(orderId, paymentId)
        .run();
      return statements;
    };
    const antes = await state(db);
    const response = await anular(db, session);
    db.hook = null;
    assert.equal(disparou, true, "a identidade mudou depois da checagem da aplicação");
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, EXPOSICAO);
    assert.equal(await anulacoes(db), 0, "o batch inteiro reverteu");
    assert.equal((await state(db)).produtos?.[0]?.estoque, antes.produtos?.[0]?.estoque);
  });
}

test("controle positivo: a mesma perna com ORD/PAY válidos e sem colunas legadas libera", async t => {
  const { db, session } = await pago(t);
  await semColunasLegadas(db);
  await reembolso(db, { valor: 10000 });
  assert.equal((await anular(db, session)).status, 200);
});

test("controle positivo: Payments histórico numérico sem colunas legadas libera", async t => {
  const { db, session } = await pago(t);
  await semColunasLegadas(db);
  await db
    .prepare("UPDATE pedido_pagamentos SET mp_order_id=NULL,mp_payment_id='9001' WHERE id=1")
    .run();
  await reembolso(db, { valor: 10000 });
  assert.equal((await anular(db, session)).status, 200);
});

test("NULL na prova também não esconde operação nem identidade legada (sem mascarar pelo outro braço)", async t => {
  // Operação CONCLUIDA com mp_payment_id NULL: igualdade com NULL não pode virar 'sem exposição'.
  const { db, session } = await pago(t);
  await semColunasLegadas(db);
  await reembolso(db, { valor: 10000 });
  await operacaoPix(db, { mpPaymentId: null });
  await bloqueado(db, session, EXPOSICAO);
});

// Matriz exaustiva: o predicado SQL (a mesma string do trigger) contra uma referência em JS.
// Qualquer NULL que escape como "sem exposição" aparece como divergência.
test("matriz identidade × soma de estornos: SQL === referência, e NULL nunca vira 'sem exposição'", async t => {
  const { build } = await import("esbuild");
  const bundle = await build({
    stdin: {
      contents:
        "export { exposicaoPixRemotaNoPedidoSql } from './functions/lib/pedidoFinanceiroSql';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node"
  });
  const { exposicaoPixRemotaNoPedidoSql } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  const { db } = await pago(t);
  await semColunasLegadas(db);
  const consulta = `SELECT ${exposicaoPixRemotaNoPedidoSql("1")} AS exposto`;
  const ordens = [null, "ORD101", "ORD-1", "", "ord101", "ORD"];
  const pagamentos = [null, "PAY101", "9001", "PAY-1", "", "09001", "PAY", "pay101"];
  const somas = [0, 9999, 10000, 10001];
  const valido = (ord, pay) =>
    (/^ORD[A-Za-z0-9]+$/.test(ord ?? "") && /^PAY[A-Za-z0-9]+$/.test(pay ?? "")) ||
    (ord === null && /^[1-9][0-9]*$/.test(pay ?? ""));
  let nulos = 0;
  for (const ord of ordens)
    for (const pay of pagamentos)
      for (const soma of somas) {
        await db.prepare("DELETE FROM pedido_reembolsos").run();
        await db
          .prepare("UPDATE pedido_pagamentos SET mp_order_id=?,mp_payment_id=? WHERE id=1")
          .bind(ord, pay)
          .run();
        if (soma) await reembolso(db, { valor: soma });
        const linha = await db.prepare(consulta).first();
        if (linha.exposto === null) nulos++;
        const quitado = valido(ord, pay) && soma === 10000;
        assert.equal(
          linha.exposto,
          quitado ? 0 : 1,
          `ord=${JSON.stringify(ord)} pay=${JSON.stringify(pay)} soma=${soma}`
        );
      }
  assert.equal(nulos, 0, "o predicado é estritamente booleano");
});
