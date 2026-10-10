import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { app, fixture, state } from "./helpers/b3.mjs";

const CODE = "ANULACAO_EXPOSICAO_PIX_REMOTA";
const TRIGGER = "pedido_anulacoes_bloquear_exposicao_pix_remota";
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
const normalize = sql => sql.replace(/\s+/g, " ").trim();
const voidRows = async db => (await db.prepare("SELECT * FROM pedido_anulacoes").all()).results;
const requestVoid = (db, session, devolverEstoque = true) =>
  app.adminVoid.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: "1" },
    request: new Request("https://local.test/api/admin/pedidos/1/anulacao", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: session.cookie.split(";")[0],
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ devolverEstoque, motivo: "Inverse race containment" })
    })
  });
async function manual(t) {
  const db = await fixture(t);
  await db.prepare("UPDATE pedidos SET mp_payment_id=NULL WHERE id=1").run();
  await db
    .prepare(
      "UPDATE pedido_pagamentos SET metodo='DINHEIRO',status='FALHOU',mp_order_id=NULL,mp_payment_id=NULL WHERE id=1"
    )
    .run();
  return { db, session: await app.auth.createSession(db, 1) };
}
async function operation(db, tipo, fase) {
  await db
    .prepare(
      `INSERT INTO pedido_operacoes(operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,mp_idempotency_key,mp_request,mp_payment_id,ator_usuario_id)
      VALUES('historical-op',?,'ADMIN',1,'audit',?,1,1,'historical-key','{"external_reference":"historical"}','PAY999',1)`
    )
    .bind(tipo, fase)
    .run();
}
const prohibitNetwork = t =>
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected remote request");
  });

test("0040 exposure trigger exactly matches the application predicate", async t => {
  const { db } = await manual(t);
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE name=?").bind(TRIGGER).first();
  const when = row.sql.match(/FOR EACH ROW\s+WHEN ([\s\S]+)\s+BEGIN/)[1];
  assert.equal(normalize(when), normalize(exposicaoPixRemotaNoPedidoSql("NEW.pedido_id")));
  assert.match(row.sql, /BEFORE INSERT ON pedido_anulacoes/);
  assert.match(row.sql, /RAISE\(ABORT, 'ANULACAO_EXPOSICAO_PIX_REMOTA'\)/);
});

for (const local of ["CANCELADO", "FALHOU"]) {
  for (const ids of [false, true]) {
    test(`unknown capture: ${local}, remote ids=${ids} => no void or side effects`, async t => {
      const { db, session } = await manual(t);
      await db
        .prepare(
          "UPDATE pedido_pagamentos SET metodo='PIX_MP',status=?,mp_order_id=?,mp_payment_id=? WHERE id=1"
        )
        .bind(local, ids ? "ORD101" : null, ids ? "PAY101" : null)
        .run();
      prohibitNetwork(t);
      const before = await state(db);
      const response = await requestVoid(db, session);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, CODE);
      assert.deepEqual(await state(db), before);
      assert.deepEqual(await voidRows(db), []);
    });
  }
}

for (const tipo of ["CHECKOUT_SITE", "PIX_ADMIN", "PIX_ADMIN_REGENERACAO"]) {
  for (const fase of ["REMOTO_CONHECIDO", "CONCLUIDA", "RECUSADA"]) {
    test(`historical ${tipo}/${fase} alone blocks void without remote lookup`, async t => {
      const { db, session } = await manual(t);
      await operation(db, tipo, fase);
      prohibitNetwork(t);
      const before = await state(db);
      const response = await requestVoid(db, session);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, CODE);
      assert.deepEqual(await state(db), before);
      assert.deepEqual(await voidRows(db), []);
    });
  }
}

for (const column of ["mp_payment_id", "mp_qr_code", "mp_qr_code_base64", "mp_ticket_url"]) {
  test(`legacy ${column} with a manual ledger still blocks void`, async t => {
    const { db, session } = await manual(t);
    await db.prepare(`UPDATE pedidos SET ${column}='historical' WHERE id=1`).run();
    const response = await requestVoid(db, session);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, CODE);
    assert.deepEqual(await voidRows(db), []);
  });
}

for (const exposure of ["payment", "operation", "legacy"]) {
  for (const devolver of [false, true]) {
    test(`transaction catches late ${exposure}, stock return=${devolver}, rolls back whole batch`, async t => {
      const { db, session } = await manual(t);
      prohibitNetwork(t);
      let before;
      db.hook = async (statements, kind) => {
        if (kind !== "batch" || !statements[0].sql.includes("INSERT INTO pedido_anulacoes"))
          return statements;
        assert(!before);
        assert.match(statements.at(-1).sql, /UPDATE pedido_anulacoes SET efetivada=1/);
        if (devolver) {
          assert.match(statements[1].sql, /UPDATE produtos/);
          assert.match(statements[2].sql, /UPDATE pedido_itens/);
        }
        if (exposure === "payment") {
          await db
            .prepare(
              "UPDATE pedido_pagamentos SET metodo='PIX_MP',status='CANCELADO',mp_status=NULL WHERE id=1"
            )
            .run();
        } else if (exposure === "operation") {
          await operation(db, "PIX_ADMIN_REGENERACAO", "REMOTO_CONHECIDO");
        } else {
          await db.prepare("UPDATE pedidos SET mp_payment_id='PAY999' WHERE id=1").run();
        }
        before = await state(db);
        return [
          { sql: "UPDATE produtos SET estoque=estoque+1 WHERE id=1", args: [] },
          {
            sql: "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'DINHEIRO','ADMIN',1,'PAGO','rollback-sentinel')",
            args: []
          },
          ...statements
        ];
      };
      const response = await requestVoid(db, session, devolver);
      assert(before, "exposure must land after application checks and before the batch");
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, CODE);
      assert.deepEqual(await state(db), before);
      assert.deepEqual(await voidRows(db), []);
    });
  }
}

test("manual orders without remote exposure remain voidable and replay the original stock choice", async t => {
  const { db, session } = await manual(t);
  prohibitNetwork(t);
  const first = await requestVoid(db, session);
  assert.equal(first.status, 200);
  const committed = await first.json();
  const before = await state(db);
  const retry = await requestVoid(db, session, false);
  assert.equal(retry.status, 200);
  const replay = await retry.json();
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.anulacao, committed.anulacao);
  assert.deepEqual(await state(db), before);
});

test("historical effective Pix voids replay without touching their immutable financial history", async t => {
  const { db, session } = await manual(t);
  await db
    .prepare("UPDATE pedido_pagamentos SET metodo='PIX_MP',status='CANCELADO' WHERE id=1")
    .run();
  const definition = await db
    .prepare("SELECT sql FROM sqlite_master WHERE name=?")
    .bind(TRIGGER)
    .first();
  // Simulate a void committed before 0040, then restore the exact new trigger.
  await db.prepare(`DROP TRIGGER ${TRIGGER}`).run();
  await db
    .prepare(
      "INSERT INTO pedido_anulacoes(pedido_id,motivo,estoque_acao,criado_por_usuario_id,usuario_nome,total_original_centavos,bruto_original_centavos,reembolsado_original_centavos,liquido_original_centavos,estoque_snapshot,efetivada) VALUES(1,'Historical','MANTER',1,'Teste',10000,0,0,0,'[]',1)"
    )
    .run();
  await db.prepare(definition.sql).run();
  prohibitNetwork(t);
  const before = await state(db);
  const snapshot = await voidRows(db);
  const response = await requestVoid(db, session);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replay, true);
  assert.deepEqual(await state(db), before);
  assert.deepEqual(await voidRows(db), snapshot);
  await assert.rejects(
    db.prepare("UPDATE pedido_pagamentos SET mp_status='approved' WHERE id=1").run(),
    /PEDIDO_ANULADO/
  );
});
