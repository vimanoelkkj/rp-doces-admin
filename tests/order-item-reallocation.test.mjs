import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as reallocateItem } from "../functions/api/admin/orders/[id]/items/[itemId]/reallocate.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function request(targetItemId = 12) {
  return new Request("https://loja.test/api/admin/orders/7/items/11/reallocate", {
    method: "POST",
    headers: {
      Origin: "https://loja.test",
      Cookie: "rp_admin_session=sessao",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ destino_item_id: targetItemId })
  });
}

function pedido(overrides = {}) {
  return {
    id: 7,
    status_pedido: "NOVO",
    status_comanda: "ABERTA",
    reserva_status: "ATIVA",
    estoque_baixado_em: null,
    valor_total_centavos: 4000,
    ...overrides
  };
}

function sourceItem(overrides = {}) {
  return {
    id: 11,
    pedido_id: 7,
    produto_id: 1,
    produto_nome: "Encanto de frutas vermelhas",
    quantidade: 1,
    valor_total_centavos: 2000,
    estoque_baixado_em: "2026-09-06 12:00:00",
    ...overrides
  };
}

function targetItem(overrides = {}) {
  return {
    id: 12,
    pedido_id: 7,
    produto_id: 2,
    produto_nome: "Tentação de maracujá",
    quantidade: 1,
    valor_unitario_centavos: 2000,
    valor_total_centavos: 2000,
    estoque_baixado_em: null,
    ...overrides
  };
}

function reallocationDb({
  order = pedido(),
  source = sourceItem(),
  target = targetItem(),
  sourcePaid = 2000,
  targetPaid = 0,
  pendingSourceAllocation = false,
  paymentTotal = 2000
} = {}) {
  let deleted = false;
  let targetDeducted = Boolean(target.estoque_baixado_em);

  const db = fakeDb(
    sql => {
      if (sql.includes("FROM admin_sessoes")) {
        return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
      }
      if (sql === "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1") {
        return { first: () => ({ id: 90 }) };
      }
      if (sql.includes("SELECT id, status_pedido, status_comanda, reserva_status, estoque_baixado_em")) {
        return { first: () => order };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("WHERE id = ? AND pedido_id = ?") && sql.includes("LIMIT 1")) {
        return {
          first: statement => Number(statement.args[0]) === source.id
            ? (deleted ? null : source)
            : target
        };
      }
      if (sql.includes("p.status = 'PENDENTE'") && sql.includes("COUNT(*) AS total")) {
        return { first: () => ({ total: pendingSourceAllocation ? 1 : 0 }) };
      }
      if (sql.includes("SELECT a.id, a.pagamento_id, a.valor_centavos")) {
        return {
          all: () => ({
            results: sourcePaid > 0
              ? [{ id: 300, pagamento_id: 90, valor_centavos: sourcePaid }]
              : []
          })
        };
      }
      if (sql.includes("SELECT COALESCE(SUM(a.valor_centavos), 0) AS total")) {
        return {
          first: statement => ({ total: Number(statement.args[0]) === target.id ? targetPaid : sourcePaid })
        };
      }
      if (sql.includes("SELECT * FROM pedidos WHERE id = ? LIMIT 1")) {
        return { first: () => order };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("ORDER BY id") && !sql.includes("WHERE id = ?")) {
        return {
          all: () => ({
            results: deleted
              ? [{ ...target, estoque_baixado_em: targetDeducted ? "2026-09-06 13:00:00" : null }]
              : [source, target]
          })
        };
      }
      if (sql.includes("FROM pedido_pagamentos") && sql.includes("ORDER BY criado_em ASC")) {
        return {
          all: () => ({
            results: [{ id: 90, pedido_id: 7, valor_centavos: paymentTotal, status: "PAGO" }]
          })
        };
      }
      if (sql.includes("WHERE pedido_id = ? AND estoque_baixado_em IS NULL") && sql.includes("COUNT(*) AS total")) {
        return { first: () => ({ total: deleted && targetDeducted ? 0 : 1 }) };
      }
      if (sql.startsWith("UPDATE pedidos SET")) {
        return { run: () => ({ success: true, meta: { changes: 1 } }) };
      }
      return {};
    },
    async statements => {
      assert.ok(statements.some(statement => statement.sql.includes("INSERT INTO pedido_pagamento_alocacoes")));
      assert.ok(statements.some(statement => statement.sql.includes("SET estoque = estoque +")));
      assert.ok(statements.some(statement => statement.sql.includes("SET estoque = estoque -")));
      assert.ok(statements.some(statement => statement.sql.includes("SET estoque_baixado_em = CURRENT_TIMESTAMP")));
      assert.ok(statements.some(statement => statement.sql.includes("DELETE FROM pedido_itens")));
      targetDeducted = true;
      deleted = true;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  return { db, deleted: () => deleted, targetDeducted: () => targetDeducted };
}

test("realoca pagamento, repõe o produto antigo e baixa o produto levado", async () => {
  const memory = reallocationDb();
  const response = await reallocateItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.valor_realocado_centavos, 2000);
  assert.equal(body.estoque_antigo_reposto, true);
  assert.equal(body.estoque_destino_baixado, true);
  assert.equal(body.status_financeiro, "PAGO");
  assert.equal(body.saldo_centavos, 0);
  assert.equal(memory.deleted(), true);
  assert.equal(memory.targetDeducted(), true);
});

test("mantém diferença pendente quando o produto levado é mais caro", async () => {
  const memory = reallocationDb({
    target: targetItem({ valor_unitario_centavos: 2500, valor_total_centavos: 2500 })
  });
  const response = await reallocateItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.valor_realocado_centavos, 2000);
  assert.equal(body.saldo_destino_centavos, 500);
  assert.equal(body.status_financeiro, "PARCIAL");
  assert.equal(body.saldo_centavos, 500);
});

test("gera crédito quando o produto levado é mais barato", async () => {
  const memory = reallocationDb({
    target: targetItem({ valor_unitario_centavos: 1500, valor_total_centavos: 1500 })
  });
  const response = await reallocateItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.valor_realocado_centavos, 1500);
  assert.equal(body.credito_gerado_centavos, 500);
  assert.equal(body.credito_centavos, 500);
  assert.equal(body.status_financeiro, "PAGO");
});

test("bloqueia realocação para item já totalmente pago", async () => {
  const memory = reallocationDb({ targetPaid: 2000 });
  const response = await reallocateItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /totalmente pago/i);
  assert.equal(memory.deleted(), false);
});

test("bloqueia realocação se o item antigo ainda tem cobrança pendente", async () => {
  const memory = reallocationDb({ pendingSourceAllocation: true });
  const response = await reallocateItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /cobrança pendente/i);
  assert.equal(memory.deleted(), false);
});
