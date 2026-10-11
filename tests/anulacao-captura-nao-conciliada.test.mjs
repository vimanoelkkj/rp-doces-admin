import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { app, fixture, state } from "./helpers/b3.mjs";

const bundle = await build({
  stdin: {
    contents:
      "export { capturaNaoConciliadaNoPedidoSql } from './functions/lib/financialCoverage';",
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});
const { capturaNaoConciliadaNoPedidoSql } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const CODE = "CAPTURA_MP_NAO_CONCILIADA";
const TRIGGER = "pedido_anulacoes_bloquear_captura_nao_conciliada";
const normalize = sql => sql.replace(/\s+/g, " ").trim();
const voidRows = async db =>
  (await db.prepare("SELECT * FROM pedido_anulacoes ORDER BY id").all()).results;
const context = (db, session, devolverEstoque = true) => ({
  env: { DB: db, MP_ACCESS_TOKEN: "fake" },
  params: { id: "1" },
  request: new Request("https://local.test/api/admin/pedidos/1/anulacao", {
    method: "POST",
    headers: {
      Origin: "https://local.test",
      Cookie: session.cookie.split(";")[0],
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ devolverEstoque, motivo: "Capture audit" })
  })
});

function provider(t, remote = "approved", reference = "token", amount = "99.00") {
  const wire = {
    id: "ORD101",
    type: "online",
    status: remote === "approved" ? "processed" : "refunded",
    status_detail: remote === "approved" ? "accredited" : "refunded",
    external_reference: reference,
    total_amount: amount,
    country_code: "BRA",
    transactions: {
      payments: [
        {
          id: "PAY101",
          amount,
          status: remote === "approved" ? "processed" : "refunded",
          status_detail: remote === "approved" ? "accredited" : "refunded",
          payment_method: { id: "pix", type: "bank_transfer" }
        }
      ]
    }
  };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
    assert.equal(options?.method ?? "GET", "GET", "no remote mutation is permitted");
    calls++;
    return Response.json(wire);
  });
  return { wire, calls: () => calls };
}

async function capture(db) {
  const payment = await app.sync.fetchMpPayment("fake", "ORD101");
  await app.sync.syncPaymentFromMp(db, 1, payment);
  return payment;
}

async function prepare(t, local, remote, reserve = "ATIVA") {
  const db = await fixture(t, { reserve });
  const session = await app.auth.createSession(db, 1);
  await db.prepare("UPDATE pedido_pagamentos SET status=? WHERE id=1").bind(local).run();
  const mp = provider(t, remote, remote === "refunded" ? "divergent-reference" : "token");
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  return { db, session, mp };
}

test("0040 trigger exactly matches the shared F1 predicate and preserves prior schema", async t => {
  const db = await fixture(t);
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE name=?").bind(TRIGGER).first();
  assert(row, "the additive trigger must exist");
  const when = row.sql.match(/FOR EACH ROW\s+WHEN ([\s\S]+)\s+BEGIN/)[1];
  assert.equal(normalize(when), normalize(capturaNaoConciliadaNoPedidoSql("NEW.pedido_id")));
  assert.match(row.sql, /BEFORE INSERT ON pedido_anulacoes/);
  assert.match(row.sql, /RAISE\(ABORT, 'CAPTURA_MP_NAO_CONCILIADA'\)/);

  const previous = new DatabaseSync(":memory:");
  t.after(() => previous.close());
  const names = (await readdir("migrations")).filter(n => n.endsWith(".sql")).sort();
  for (const name of names.filter(n => n < "0040")) {
    previous.exec(await readFile(`migrations/${name}`, "utf8"));
  }
  const sql = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name";
  const actual = (await db.prepare(sql).all()).results.filter(
    r => ![TRIGGER, "pedido_anulacoes_bloquear_exposicao_pix_remota"].includes(r.name)
  );
  // D1 strips SQL comments; compare the same definitions without comment trivia.
  const canonical = rows =>
    rows.map(r => ({
      ...r,
      sql:
        r.sql === null
          ? null
          : normalize(
              r.sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\//g, token =>
                token.startsWith("--") || token.startsWith("/*") ? " " : token
              )
            )
    }));
  assert.deepEqual(canonical(actual), canonical(previous.prepare(sql).all()));
});

for (const local of ["CANCELADO", "FALHOU"]) {
  for (const remote of ["approved", "refunded"]) {
    test(`application refuses an existing ${local}/${remote} capture without a void batch`, async t => {
      const { db, session, mp } = await prepare(t, local, remote);
      await capture(db);
      const before = await state(db);
      assert.equal(before.pagamentos[0].mp_status, remote);
      let batches = 0;
      db.hook = async (statements, operation) => {
        if (operation === "batch") batches++;
        return statements;
      };
      const response = await app.adminVoid.onRequestPost(context(db, session));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, CODE);
      assert.equal(batches, 0, "application guard must refuse before the void batch");
      assert.equal(mp.calls(), 1, "void must not dispatch or observe another payment");
      assert.deepEqual(await state(db), before);
      assert.deepEqual(await voidRows(db), []);
    });

    for (const devolver of [false, true]) {
      test(`transaction refuses late ${local}/${remote} capture; return stock=${devolver}`, async t => {
        const { db, session } = await prepare(t, local, remote, "CONVERTIDA");
        await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
        await db.prepare("UPDATE pedidos SET mp_payment_id=NULL WHERE id=1").run();
        let before;
        let injected = false;
        db.hook = async (statements, operation) => {
          if (operation === "batch" && statements[0].sql.includes("INSERT INTO pedido_anulacoes")) {
            assert.equal(injected, false);
            injected = true;
            assert.match(statements.at(-1).sql, /UPDATE pedido_anulacoes SET efetivada=1/);
            if (devolver) {
              assert.match(statements[1].sql, /UPDATE produtos SET/);
              assert.match(statements[2].sql, /UPDATE pedido_itens SET/);
            }
            assert(!statements.some(s => /INSERT INTO pedido_(pagamentos|reembolsos)/.test(s.sql)));
            await db.prepare("UPDATE pedido_pagamentos SET metodo='PIX_MP' WHERE id=1").run();
            await capture(db);
            before = await state(db);
          }
          return statements;
        };
        const response = await app.adminVoid.onRequestPost(context(db, session, devolver));
        assert.equal(injected, true, "capture lands after application checks and before D1 batch");
        assert.equal(response.status, 409);
        assert([CODE, "ANULACAO_EXPOSICAO_PIX_REMOTA"].includes((await response.json()).code));
        assert.deepEqual(
          await state(db),
          before,
          "stock, ledger, allocations and claims are unchanged"
        );
        assert.deepEqual(await voidRows(db), [], "no snapshot or immutability marker survives");
      });
    }
  }
}

test("trigger ABORT rolls back earlier financial and stock writes in the same D1 batch", async t => {
  const { db, session } = await prepare(t, "CANCELADO", "approved");
  await db.prepare("UPDATE pedido_pagamentos SET metodo='DINHEIRO' WHERE id=1").run();
  await db.prepare("UPDATE pedidos SET mp_payment_id=NULL WHERE id=1").run();
  let before;
  db.hook = async (statements, operation) => {
    if (operation !== "batch" || !statements[0].sql.includes("INSERT INTO pedido_anulacoes")) {
      return statements;
    }
    await db.prepare("UPDATE pedido_pagamentos SET metodo='PIX_MP' WHERE id=1").run();
    await capture(db);
    before = await state(db);
    // Sentinels prove transaction rollback, beyond merely refusing the first INSERT.
    return [
      { sql: "UPDATE produtos SET estoque=estoque+1 WHERE id=1", args: [] },
      {
        sql: "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'DINHEIRO','ADMIN',1,'PAGO','rollback-sentinel')",
        args: []
      },
      ...statements
    ];
  };
  const response = await app.adminVoid.onRequestPost(context(db, session));
  assert.equal(response.status, 409);
  assert([CODE, "ANULACAO_EXPOSICAO_PIX_REMOTA"].includes((await response.json()).code));
  assert(before);
  assert.deepEqual(await state(db), before);
  assert.deepEqual(await voidRows(db), []);
});

test("verified reconciliation remains available but refunded Pix history still prevents a new void", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const mp = provider(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  await capture(db);
  assert.equal((await state(db)).pagamentos[0].mp_status, "approved");
  Object.assign(mp.wire, { status: "refunded", status_detail: "refunded", total_amount: "100.00" });
  Object.assign(mp.wire.transactions.payments[0], {
    status: "refunded",
    status_detail: "refunded",
    amount: "100.00"
  });
  await capture(db);
  assert.equal((await state(db)).pagamentos[0].status, "REEMBOLSADO");
  const response = await app.adminVoid.onRequestPost(context(db, session));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  const beforeReplay = await state(db);
  const retry = await app.adminVoid.onRequestPost(context(db, session, false));
  assert.equal(retry.status, 409);
  assert.deepEqual(await voidRows(db), []);
  assert.deepEqual(await state(db), beforeReplay);
  assert.equal(mp.calls(), 2, "reconciliation uses GET only; void and replay do not dispatch");
});

test("inverse race: void before discovery is refused and the late capture can still be recorded", async t => {
  const { db, session } = await prepare(t, "CANCELADO", "approved");
  const response = await app.adminVoid.onRequestPost(context(db, session));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  const payment = await app.sync.fetchMpPayment("fake", "ORD101");
  await app.sync.syncPaymentFromMp(db, 1, payment);
  assert.equal((await state(db)).pagamentos[0].mp_status, "approved");
  assert.deepEqual(await voidRows(db), []);
  const retry = await app.adminVoid.onRequestPost(context(db, session));
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).code, CODE);
});

test("inverse race: an in-flight GET discovers an existing capture after void is safely refused", async t => {
  const { db, session, mp } = await prepare(t, "FALHOU", "approved");
  let release;
  let started;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const ready = new Promise(resolve => {
    started = resolve;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.mercadopago.com/v1/orders/ORD101");
    assert.equal(options?.method ?? "GET", "GET");
    calls++;
    started();
    await gate;
    return Response.json(mp.wire);
  });
  const delayed = capture(db);
  await ready;
  const before = await state(db);
  try {
    const response = await app.adminVoid.onRequestPost(context(db, session));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ANULACAO_EXPOSICAO_PIX_REMOTA");
    assert.deepEqual(await state(db), before);
    assert.deepEqual(await voidRows(db), []);
    assert.equal(calls, 1, "void adds no remote request while synchronization is in flight");
  } finally {
    release();
    await delayed;
  }
  assert.equal((await state(db)).pagamentos[0].mp_status, "approved");
  assert.deepEqual(await voidRows(db), []);
});
