import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { app, fixture, state } from "./helpers/b3.mjs";

const expected = JSON.parse(
  await readFile(
    new URL("./fixtures/item-exchange-statements-contract.json", import.meta.url),
    "utf8"
  )
);
const bundle = await build({
  stdin: {
    contents: "export * from './functions/lib/itemExchangeStatements';",
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm"
});
const builders = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function normalizeClock(value) {
  if (Array.isArray(value)) return value.map(normalizeClock);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /_em$/.test(key) && typeof entry === "string" ? "<timestamp>" : normalizeClock(entry)
      ])
    );
  return value;
}

async function records(db) {
  return normalizeClock({
    ...(await state(db)),
    exchanges: (await db.prepare("SELECT * FROM pedido_item_trocas ORDER BY id").all()).results
  });
}

test("all builders preserve statement count, literal SQL, bindings and array order", async t => {
  const db = await fixture(t, { ledger: false });
  const row = {
    id: 17,
    pedido_id: 3,
    item_origem_id: 9,
    item_destino_id: 22,
    status: "INCONCLUSIVA",
    estoque_acao_origem: "LIBERAR_RESERVA",
    snapshot_financeiro: JSON.stringify({ financeiro: { totalProjetadoCentavos: 1200 } })
  };
  const actual = {};
  const record = (label, statements) => {
    const list = Array.isArray(statements) ? statements : [statements];
    actual[label] = {
      count: list.length,
      contract: digest(list.map(({ sql, args }) => ({ sql, args })))
    };
  };
  db.hook = async () => {
    assert.fail("assembling statements must not execute D1 requests");
  };
  for (const action of ["LIBERAR_RESERVA", "REPOR", "NAO_REPOR", "NENHUMA"]) {
    for (const guard of ["", "AND 1=1"])
      record(`origin/${action}/${guard}`, builders.originPhysicalStatements(db, 9, action, guard));
    record(
      `complete/${action}`,
      builders.completeExchangeStatements(db, { ...row, estoque_acao_origem: action })
    );
    for (const balance of [0, 500])
      record(
        `initial/${action}/${balance}`,
        builders.completeInitialExchangeStatements(db, {
          pedidoId: 3,
          itemId: 9,
          operationKey: "statements-key",
          action,
          projectedBalance: balance
        })
      );
  }
  for (const selector of [{ exchangeId: 17 }, { operationKey: "statements-key" }]) {
    for (const guard of ["", "AND 1=1"])
      record(
        `destination/${JSON.stringify(selector)}/${guard}`,
        builders.destinationPhysicalStatements(db, selector, guard)
      );
  }
  record(
    "complete/invalid snapshot",
    builders.completeExchangeStatements(db, { ...row, snapshot_financeiro: "{invalid" })
  );
  record("completed invariant", builders.completedExchangeInvariant(db, row));
  for (const expectation of [
    { originStatus: "ATIVO", destinationStatus: "TROCA_PENDENTE", destinationStock: "RESERVADO" },
    { originStatus: "CANCELADO", destinationStatus: "ATIVO", destinationStock: "RESERVADO" },
    { originStatus: "CANCELADO", destinationStatus: "ATIVO", destinationStock: "BAIXADO" }
  ])
    record(
      `invariant/${JSON.stringify(expectation)}`,
      builders.exchangeInvariant(db, 3, "statements-key", expectation)
    );
  db.hook = null;
  assert.deepEqual(actual, expected.builders);
});

async function scenario(t, price) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db.prepare(
      "UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',valor_total_centavos=1500,status_pagamento='PAGO' WHERE id=1"
    ),
    db.prepare(
      "UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=1500,valor_total_centavos=1500 WHERE id=1"
    ),
    db.prepare("UPDATE produtos SET estoque_reservado=1 WHERE id=1"),
    db
      .prepare(
        "INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel) VALUES(2,'B','BOLO',?,10,0,1,1)"
      )
      .bind(price),
    db.prepare(
      "INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em) VALUES(1,1,'DINHEIRO','ADMIN',1500,'PAGO','statements-paid',CURRENT_TIMESTAMP)"
    ),
    db.prepare(
      "INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,1500)"
    )
  ]);
  return db;
}

for (const label of [
  "immediate",
  "waiting charge",
  "destination deduction",
  "physical rollback",
  "total rollback",
  "completed invariant rollback"
])
  test(`statement integration contract: ${label}`, async t => {
    const db = await scenario(
      t,
      label === "immediate" || label === "completed invariant rollback" ? 1500 : 2000
    );
    const price = label === "immediate" || label === "completed invariant rollback" ? 1500 : 2000;
    const input = {
      pedidoId: 1,
      itemId: 1,
      produtoDestinoId: 2,
      quantidadeDestino: 1,
      precoEsperadoCentavos: price,
      estoqueAcaoOrigem: "LIBERAR_RESERVA"
    };
    const preview = await app.itemExchange.getItemExchangePreview(db, input);
    const created = await app.itemExchange.createItemExchange(db, {
      ...input,
      usuarioId: 1,
      operationKey: "statements-exchange",
      previewFingerprint: preview.previewFingerprint
    });
    assert.equal(created.ok, true);
    assert.equal(created.troca.estoqueOrigemEstado, "LIBERADO");
    assert.equal(created.troca.estoqueDestinoEstado, price === 1500 ? "BAIXADO" : "RESERVADO");
    assert.equal(created.troca.status, price === 1500 ? "CONCLUIDA" : "AGUARDANDO_COBRANCA");
    if (label.endsWith("rollback")) {
      const before = await records(db);
      const row = await db.prepare("SELECT * FROM pedido_item_trocas WHERE id=1").first();
      const violation =
        label === "total rollback"
          ? db.prepare("UPDATE pedidos SET valor_total_centavos=2001 WHERE id=1")
          : db.prepare("UPDATE produtos SET estoque_reservado=1 WHERE id=2");
      const invariant =
        label === "completed invariant rollback"
          ? builders.completedExchangeInvariant(db, row)
          : builders.exchangeInvariant(db, 1, "statements-exchange", {
              originStatus: "CANCELADO",
              destinationStatus: "ATIVO",
              destinationStock: "RESERVADO"
            });
      // For the reserved destination, lower the product reservation instead of increasing it.
      const physicalViolation =
        label === "physical rollback"
          ? db.prepare("UPDATE produtos SET estoque_reservado=0 WHERE id=2")
          : violation;
      await assert.rejects(db.batch([physicalViolation, invariant]), /CHECK constraint failed/);
      assert.deepEqual(await records(db), before, "the entire D1 batch rolls back");
    } else if (label === "destination deduction") {
      await db
        .prepare(
          "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'DINHEIRO','ADMIN',500,'PAGO','statements-charge')"
        )
        .run();
      await app.itemExchange.reconcileExchangeCharges(db, 1);
      assert.equal(
        (await app.itemExchange.getExchangeView(db, 1, 1)).estoqueDestinoEstado,
        "BAIXADO"
      );
      const completed = await records(db);
      await app.itemExchange.reconcileExchangeCharges(db, 1);
      assert.deepEqual(await records(db), completed, "destination deduction is idempotent");
    }
    const actual = digest({ created, records: await records(db) });
    assert.deepEqual(actual, expected[label]);
  });
