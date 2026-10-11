import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// C0 Pix expirado sem captura conhecida segue liberado; C1 preview; C2 criacao;
// C3 corrida na escrita; C4 finalizacao de cancelamento ja criado.

async function setup(t, { paid = 0 } = {}) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db
      .prepare(
        `UPDATE pedidos SET origem_pedido='MANUAL',status_pedido='NOVO',status_comanda='ABERTA',
      valor_total_centavos=1500,status_pagamento=? WHERE id=1`
      )
      .bind(paid ? "PAGO" : "PENDENTE"),
    db.prepare(
      `UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=1500,
      valor_total_centavos=1500,status_item='ATIVO',estoque_estado='RESERVADO',
      estoque_reservado_em=CURRENT_TIMESTAMP WHERE id=1`
    ),
    db.prepare(
      `UPDATE produtos SET nome='A',preco_centavos=1500,estoque=10,estoque_reservado=1 WHERE id=1`
    )
  ]);
  if (paid) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(1,1,'DINHEIRO','ADMIN',?,'PAGO','paid-1',CURRENT_TIMESTAMP)`
        )
        .bind(paid),
      db
        .prepare(
          `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,?)`
        )
        .bind(paid)
    ]);
  }
  return { db, session: await app.auth.createSession(db, 1) };
}

const addPix = (db, { status, mpStatus }) =>
  db
    .prepare(
      `INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key,mp_status)
    VALUES(1,'PIX_MP','ADMIN',100,?,'pix-'||?||'-'||COALESCE(?,'x'),?)`
    )
    .bind(status, status, mpStatus, mpStatus)
    .run();

const headers = session => ({
  Cookie: session.cookie.split(";")[0],
  Origin: "https://local.test",
  "Content-Type": "application/json"
});

const previewGet = (db, session) =>
  app.adminItemCancellationPreview.onRequestGet({
    env: { DB: db },
    params: { id: "1", itemId: "1" },
    request: new Request("https://local.test/api/admin/pedidos/1/itens/1/cancelamento-preview", {
      headers: headers(session)
    })
  });

const postCancel = (db, session, previewFingerprint, operationKey = "cancel-captura-01") =>
  app.adminItemCancellation.onRequestPost({
    env: { DB: db },
    params: { id: "1", itemId: "1" },
    request: new Request("https://local.test/api/admin/pedidos/1/itens/1/cancelamentos", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ operationKey, estoqueAcao: "LIBERAR_RESERVA", previewFingerprint })
    })
  });

const params = (previewFingerprint, operationKey = "cancel-captura-01") => ({
  pedidoId: 1,
  itemId: 1,
  usuarioId: 1,
  operationKey,
  motivo: "",
  estoqueAcao: "LIBERAR_RESERVA",
  previewFingerprint
});

const count = async (db, table) =>
  Number((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n);

async function semEfeito(db) {
  assert.equal(await count(db, "pedido_item_cancelamentos"), 0);
  assert.equal(await count(db, "pedido_operacoes"), 0);
  const item = await db
    .prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=1`)
    .first();
  assert.deepEqual({ ...item }, { status_item: "ATIVO", estoque_estado: "RESERVADO" });
  assert.equal(
    (await db.prepare(`SELECT estoque_reservado r FROM produtos WHERE id=1`).first()).r,
    1
  );
}

test("C0: Pix expirado sem captura conhecida continua cancelável e fingerprint não muda", async t => {
  const { db, session } = await setup(t);
  const antes = await (await previewGet(db, session)).json();
  await addPix(db, { status: "EXPIRADO", mpStatus: null });
  await addPix(db, { status: "CANCELADO", mpStatus: "cancelled" });
  const body = await (await previewGet(db, session)).json();
  assert.equal(body.cancelamentoExecutavel, true);
  assert.deepEqual(body.bloqueios, []);
  assert.equal(body.previewFingerprint, antes.previewFingerprint);
  const response = await postCancel(db, session, body.previewFingerprint);
  assert.ok([200, 201].includes(response.status));
  assert.equal((await response.json()).cancelamento.status, "CONCLUIDO");
});

test("C1: preview bloqueia captura approved/refunded não conciliada", async t => {
  for (const [status, mpStatus] of [
    ["EXPIRADO", "approved"],
    ["FALHOU", "refunded"],
    ["PENDENTE", "approved"]
  ]) {
    const { db, session } = await setup(t);
    await addPix(db, { status, mpStatus });
    const response = await previewGet(db, session);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.cancelamentoExecutavel, false);
    assert.ok(
      body.bloqueios.some(b => b.codigo === "CAPTURA_MP_NAO_CONCILIADA"),
      status
    );
  }
});

test("C2: criação recusa com 409 mesmo com fingerprint atual e não deixa efeito", async t => {
  const { db, session } = await setup(t);
  await addPix(db, { status: "EXPIRADO", mpStatus: "approved" });
  const body = await (await previewGet(db, session)).json();
  const response = await postCancel(db, session, body.previewFingerprint);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "CAPTURA_MP_NAO_CONCILIADA");
  await semEfeito(db);
});

test("C3: captura que chega entre preview e escrita é recusada atomicamente com 409", async t => {
  const { db, session } = await setup(t);
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  let injetado = false;
  const racing = new Proxy(db, {
    get(target, prop) {
      if (prop === "batch") {
        return async statements => {
          if (!injetado) {
            injetado = true;
            await addPix(db, { status: "EXPIRADO", mpStatus: "approved" });
          }
          return db.batch(statements);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const direct = await app.itemCancellation.createItemCancellation(
    racing,
    params(preview.previewFingerprint)
  );
  assert.equal(injetado, true);
  assert.deepEqual(
    { ok: direct.ok, erro: direct.erro },
    { ok: false, erro: "CAPTURA_MP_NAO_CONCILIADA" }
  );
  await semEfeito(db);

  // Mesma corrida pelo handler: 409, nunca 500. (captura ja existe: recusa na leitura ou na escrita)
  const response = await postCancel(
    racing,
    session,
    preview.previewFingerprint,
    "cancel-captura-02"
  );
  assert.equal(response.status, 409);
  await semEfeito(db);
});

test("C4: captura após criar bloqueia a finalização; reembolso persiste e conclui após conciliar", async t => {
  const { db } = await setup(t, { paid: 1500 });
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const created = await app.itemCancellation.createItemCancellation(
    db,
    params(preview.previewFingerprint)
  );
  assert.equal(created.cancelamento.status, "AGUARDANDO_REEMBOLSO");
  await addPix(db, { status: "EXPIRADO", mpStatus: "approved" });
  const leg = created.cancelamento.pernasPendentes[0];
  const refunded = await app.itemCancellation.confirmCancellationRefund(db, {
    pedidoId: 1,
    cancellationId: created.cancelamento.id,
    usuarioId: 1,
    operationKey: "cancel-refund-captura",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true
  });
  assert.equal(refunded.ok, true);
  assert.notEqual(refunded.cancelamento.status, "CONCLUIDO");
  assert.equal(await count(db, "pedido_reembolsos"), 1);
  const item = await db
    .prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=1`)
    .first();
  assert.deepEqual({ ...item }, { status_item: "ATIVO", estoque_estado: "RESERVADO" });
  assert.equal(
    (await db.prepare(`SELECT estoque_reservado r FROM produtos WHERE id=1`).first()).r,
    1
  );

  await db.prepare(`UPDATE pedido_pagamentos SET status='REEMBOLSADO' WHERE metodo='PIX_MP'`).run();
  await app.itemCancellation.reconcileCancellationFinalization(db, created.cancelamento.id);
  const final = await db
    .prepare(`SELECT status FROM pedido_item_cancelamentos WHERE id=?`)
    .bind(created.cancelamento.id)
    .first();
  assert.equal(final.status, "CONCLUIDO");
  assert.equal(
    (await db.prepare(`SELECT estoque_reservado r FROM produtos WHERE id=1`).first()).r,
    0
  );
  assert.equal(await count(db, "pedido_reembolsos"), 1);
});

function falhando(db, { antes, erro }) {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "batch") {
        return async () => {
          await antes?.();
          throw erro;
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("falha de infra D1 não é mascarada como conflito, nem com captura presente", async t => {
  for (const injetar of [false, true]) {
    const { db, session } = await setup(t);
    const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
    const flaky = falhando(db, {
      antes: injetar ? () => addPix(db, { status: "EXPIRADO", mpStatus: "approved" }) : undefined,
      erro: new Error("D1_ERROR: D1 transient network failure")
    });
    await assert.rejects(
      app.itemCancellation.createItemCancellation(flaky, params(preview.previewFingerprint)),
      /transient/
    );
    t.mock.method(console, "error", () => {});
    const response = await postCancel(
      flaky,
      session,
      preview.previewFingerprint,
      "cancel-infra-02"
    );
    assert.equal(response.status, injetar ? 409 : 500, "handler: precheck relê captura já gravada");
    if (!injetar) await semEfeito(db);
  }
});

test("FK sem captura comprovada no estado também é relançada (não vira conflito)", async t => {
  const { db } = await setup(t);
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const fk = falhando(db, { erro: new Error("D1_ERROR: FOREIGN KEY constraint failed") });
  await assert.rejects(
    app.itemCancellation.createItemCancellation(fk, params(preview.previewFingerprint)),
    /FOREIGN KEY/
  );
  await semEfeito(db);
});

test("FK não relacionada é erro real com captura presente ou ausente; só o guard da transação vira 409", async t => {
  for (const comCaptura of [false, true]) {
    const { db } = await setup(t);
    const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
    const fk = falhando(db, {
      antes: comCaptura
        ? () => addPix(db, { status: "EXPIRADO", mpStatus: "approved" })
        : undefined,
      erro: new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT")
    });
    await assert.rejects(
      app.itemCancellation.createItemCancellation(fk, params(preview.previewFingerprint)),
      /FOREIGN KEY/
    );
    if (!comCaptura) await semEfeito(db);
  }
});

test("C3 real: o guard transacional (não a FK) recusa e reverte o batch sem claim nem efeito", async t => {
  const { db } = await setup(t);
  const preview = await app.itemCancellationPreview.getItemCancellationPreview(db, 1, 1);
  const erros = [];
  const racing = new Proxy(db, {
    get(target, prop) {
      if (prop === "batch") {
        return async statements => {
          await addPix(db, { status: "EXPIRADO", mpStatus: "approved" });
          return db.batch(statements).catch(error => {
            erros.push(error.message);
            throw error;
          });
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const result = await app.itemCancellation.createItemCancellation(
    racing,
    params(preview.previewFingerprint)
  );
  assert.equal(result.erro, "CAPTURA_MP_NAO_CONCILIADA");
  assert.equal(erros.length, 1);
  assert.match(erros[0], /malformed JSON/i);
  assert.doesNotMatch(erros[0], /FOREIGN KEY/i);
  await semEfeito(db);
});
