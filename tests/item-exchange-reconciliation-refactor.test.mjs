import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { app, fixture, state } from "./helpers/b3.mjs";
import { exchangeContractState } from "./helpers/exchange-contract-state.mjs";

// Captured before extraction. Hashes cover full SQL, bindings, batch boundaries and
// persisted records without embedding large snapshots or a duplicate implementation.
const expected = JSON.parse(
  await readFile(
    new URL("./fixtures/item-exchange-reconciliation-contract.json", import.meta.url),
    "utf8"
  )
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

async function snapshot(db) {
  return normalizeClock({
    ...exchangeContractState(await state(db)),
    exchanges: (await db.prepare("SELECT * FROM pedido_item_trocas ORDER BY id").all()).results,
    refundAllocations: (
      await db.prepare("SELECT * FROM pedido_item_troca_reembolso_alocacoes ORDER BY id").all()
    ).results
  });
}

async function scenario(t, price, count = 1) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db
      .prepare(
        "UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',valor_total_centavos=?,status_pagamento='PAGO' WHERE id=1"
      )
      .bind(count * 1500),
    db.prepare(
      "UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=1500,valor_total_centavos=1500 WHERE id=1"
    ),
    db.prepare("UPDATE produtos SET nome='A',estoque_reservado=? WHERE id=1").bind(count),
    db
      .prepare(
        "INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel) VALUES(2,'B','BOLO',?,10,0,1,1)"
      )
      .bind(price)
  ]);
  for (let id = 1; id <= count; id++) {
    if (id > 1)
      await db
        .prepare(
          "INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em) VALUES(?,1,1,'A',1,1500,1500,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)"
        )
        .bind(id)
        .run();
    await db.batch([
      db
        .prepare(
          "INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em) VALUES(?,1,'DINHEIRO','ADMIN',1500,'PAGO',?,CURRENT_TIMESTAMP)"
        )
        .bind(id, `contract-payment-${id}`),
      db
        .prepare(
          "INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(?,?,?,1500)"
        )
        .bind(id, id, id)
    ]);
  }
  const views = [];
  for (let id = 1; id <= count; id++) {
    const input = {
      pedidoId: 1,
      itemId: id,
      produtoDestinoId: 2,
      quantidadeDestino: 1,
      precoEsperadoCentavos: price,
      estoqueAcaoOrigem: "LIBERAR_RESERVA"
    };
    const preview = await app.itemExchange.getItemExchangePreview(db, input);
    const created = await app.itemExchange.createItemExchange(db, {
      ...input,
      usuarioId: 1,
      motivo: "",
      operationKey: `contract-exchange-${id}`,
      previewFingerprint: preview.previewFingerprint
    });
    assert.equal(created.ok, true);
    views.push(created.troca);
  }
  return { db, views };
}

async function measure(db, run) {
  const calls = [];
  db.hook = async (statements, operation) => {
    calls.push({ operation, statements });
  };
  let result;
  try {
    result = await run();
  } finally {
    db.hook = null;
  }
  const lookups = calls
    .flatMap(call => call.statements)
    .filter(statement => statement.sql.includes("FROM pedido_item_trocas WHERE id=? LIMIT 1"))
    .map(statement => statement.args[0]);
  const limits = calls
    .flatMap(call => call.statements)
    .filter(statement => statement.sql.includes("ORDER BY id LIMIT ?"))
    .map(statement => statement.args[1]);
  return {
    trace: digest(calls),
    records: digest(await snapshot(db)),
    result: digest(result ?? null),
    queries: calls.filter(call => call.operation !== "batch").length,
    batches: calls.filter(call => call.operation === "batch").map(call => call.statements.length),
    lookups,
    limits
  };
}

for (const label of [
  "last refund",
  "waiting charge",
  "paid charge",
  "missing exchange",
  "ordered limited exchanges"
])
  test(`reconciliation structural contract: ${label}`, async t => {
    const { db, views } = await scenario(
      t,
      label.includes("charge") ? 2000 : 1200,
      label === "ordered limited exchanges" ? 3 : 1
    );
    if (label === "paid charge")
      await db
        .prepare(
          "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'DINHEIRO','ADMIN',500,'PAGO','contract-charge')"
        )
        .run();
    const actual = [];
    if (label === "last refund") {
      const leg = views[0].refundsPendentes[0];
      actual.push(
        await measure(db, () =>
          app.itemExchange.confirmExchangeRefund(db, {
            pedidoId: 1,
            exchangeId: views[0].id,
            usuarioId: 1,
            operationKey: "contract-refund-1",
            pagamentoId: leg.pagamentoId,
            pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
            valorCentavos: leg.valorCentavos,
            confirmacao: true
          })
        )
      );
      actual.push(
        await measure(db, () => app.itemExchange.reconcileExchangeFinalization(db, views[0].id))
      );
    } else if (label === "ordered limited exchanges") {
      for (const limit of [undefined, 0, 2, 999])
        actual.push(
          await measure(db, () =>
            app.itemExchange.reconcileExchangeFinalizationsForPedido(db, 1, limit)
          )
        );
      assert.deepEqual(
        actual.map(step => step.lookups),
        [[1, 2, 3], [1], [1, 2], [1, 2, 3]]
      );
      assert.deepEqual(
        actual.map(step => step.limits),
        [[8], [1], [2], [20]]
      );
    } else if (label === "missing exchange") {
      actual.push(await measure(db, () => app.itemExchange.reconcileExchangeFinalization(db, 999)));
    } else {
      actual.push(await measure(db, () => app.itemExchange.reconcileExchangeCharges(db, 1)));
      actual.push(await measure(db, () => app.itemExchange.reconcileExchangeCharges(db, 1)));
    }
    assert.deepEqual(actual, expected[label]);
  });
