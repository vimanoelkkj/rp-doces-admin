import test from "node:test";
import assert from "node:assert/strict";
import { reconcileActiveReservationsForOrder } from "../functions/lib/stockReservation.js";
import { fakeDb } from "./helpers/fake-db.mjs";

test("reconstrói estoque_reservado a partir das reservas ativas", async () => {
  let batchStatements = [];
  const db = fakeDb(
    sql => {
      if (sql.includes("SELECT id, reserva_status") && sql.includes("FROM pedidos")) {
        return { first: () => ({ id: 7, reserva_status: "ATIVA" }) };
      }
      if (sql.includes("SELECT DISTINCT produto_id")) {
        return { all: () => ({ results: [{ produto_id: 2 }] }) };
      }
      if (sql.includes("AS reserva_esperada")) {
        return { first: () => ({ id: 2, estoque: 10, reserva_esperada: 3 }) };
      }
      return {};
    },
    async statements => {
      batchStatements = statements;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  const result = await reconcileActiveReservationsForOrder({ DB: db }, 7);

  assert.equal(result.ok, true);
  assert.equal(result.reconciliado, true);
  assert.equal(result.produtos, 1);
  assert.equal(batchStatements.length, 1);
  assert.match(batchStatements[0].sql, /SET estoque_reservado = \?/);
  assert.deepEqual(batchStatements[0].args, [3, 3, 2]);
});

test("não altera reserva quando o estoque físico não comporta as reservas ativas", async () => {
  let batches = 0;
  const db = fakeDb(
    sql => {
      if (sql.includes("SELECT id, reserva_status") && sql.includes("FROM pedidos")) {
        return { first: () => ({ id: 7, reserva_status: "ATIVA" }) };
      }
      if (sql.includes("SELECT DISTINCT produto_id")) {
        return { all: () => ({ results: [{ produto_id: 2 }] }) };
      }
      if (sql.includes("AS reserva_esperada")) {
        return { first: () => ({ id: 2, estoque: 2, reserva_esperada: 3 }) };
      }
      return {};
    },
    async statements => {
      batches += 1;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  const result = await reconcileActiveReservationsForOrder({ DB: db }, 7);

  assert.equal(result.ok, false);
  assert.equal(result.erro, "ESTOQUE_INSUFICIENTE");
  assert.equal(result.produto_id, 2);
  assert.equal(batches, 0);
});
