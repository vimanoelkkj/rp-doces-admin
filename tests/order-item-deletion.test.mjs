import test from "node:test";
import assert from "node:assert/strict";
import { onRequestDelete as deleteItem } from "../functions/api/admin/orders/[id]/items/[itemId].js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function request() {
  return new Request("https://loja.test/api/admin/orders/7/items/11", {
    method: "DELETE",
    headers: {
      Origin: "https://loja.test",
      Cookie: "rp_admin_session=sessao"
    }
  });
}

function basePedido(overrides = {}) {
  return {
    id: 7,
    status_pedido: "NOVO",
    status_comanda: "ABERTA",
    reserva_status: "ATIVA",
    valor_total_centavos: 4000,
    ...overrides
  };
}

function baseItem(overrides = {}) {
  return {
    id: 11,
    pedido_id: 7,
    produto_id: 1,
    produto_nome: "Tentação de maracujá",
    quantidade: 1,
    valor_unitario_centavos: 2000,
    valor_total_centavos: 2000,
    estoque_baixado_em: null,
    ...overrides
  };
}

function deletionDb({ pedido = basePedido(), item = baseItem(), itemCount = 2, paid = 0 } = {}) {
  let deleted = false;
  let stockReleased = false;
  const remaining = baseItem({
    id: 12,
    produto_id: 2,
    produto_nome: "Prestígio cremoso",
    valor_total_centavos: 2000
  });

  const db = fakeDb(
    sql => {
      if (sql.includes("FROM admin_sessoes")) {
        return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
      }
      if (sql === "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1") {
        return { first: () => ({ id: 90 }) };
      }
      if (sql.includes("SELECT id, status_pedido, status_comanda, reserva_status")) {
        return { first: () => pedido };
      }
      if (sql.includes("WHERE id = ? AND pedido_id = ?") && sql.includes("FROM pedido_itens")) {
        return { first: () => (deleted ? null : item) };
      }
      if (sql.includes("SELECT COUNT(*) AS total FROM pedido_itens WHERE pedido_id = ?")) {
        return { first: () => ({ total: itemCount }) };
      }
      if (sql.includes("SELECT COALESCE(SUM(a.valor_centavos), 0) AS total")) {
        return { first: () => ({ total: paid }) };
      }
      if (sql.includes("SELECT * FROM pedidos WHERE id = ? LIMIT 1")) {
        return { first: () => pedido };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("ORDER BY id") && !sql.includes("WHERE id = ?")) {
        return { all: () => ({ results: deleted ? [remaining] : [item, remaining] }) };
      }
      if (sql.includes("FROM pedido_pagamentos") && sql.includes("ORDER BY criado_em ASC")) {
        return { all: () => ({ results: [] }) };
      }
      if (sql.includes("WHERE pedido_id = ? AND estoque_baixado_em IS NULL")) {
        return { first: () => ({ total: deleted ? 1 : 2 }) };
      }
      return {};
    },
    async statements => {
      assert.ok(statements.some(statement => statement.sql.includes("UPDATE produtos")));
      assert.ok(statements.some(statement => statement.sql.includes("DELETE FROM pedido_itens")));
      stockReleased = true;
      deleted = true;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  return {
    db,
    deleted: () => deleted,
    stockReleased: () => stockReleased
  };
}

test("exclui item pendente e libera a reserva de estoque", async () => {
  const memory = deletionDb();
  const response = await deleteItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.item_id, 11);
  assert.equal(body.total_centavos, 2000);
  assert.equal(body.saldo_centavos, 2000);
  assert.equal(memory.deleted(), true);
  assert.equal(memory.stockReleased(), true);
});

test("não exclui item que já recebeu pagamento", async () => {
  const memory = deletionDb({ paid: 500 });
  const response = await deleteItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /pagamento registrado/i);
  assert.equal(memory.deleted(), false);
});

test("não exclui o último item da comanda", async () => {
  const memory = deletionDb({ itemCount: 1 });
  const response = await deleteItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /último item/i);
  assert.equal(memory.deleted(), false);
});

test("não exclui item que já teve baixa física de estoque", async () => {
  const memory = deletionDb({ item: baseItem({ estoque_baixado_em: "2026-09-06 12:00:00" }) });
  const response = await deleteItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /baixa de estoque/i);
  assert.equal(memory.deleted(), false);
});

test("não exclui item de comanda encerrada", async () => {
  const memory = deletionDb({ pedido: basePedido({ status_comanda: "ENCERRADA" }) });
  const response = await deleteItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /encerrada/i);
  assert.equal(memory.deleted(), false);
});
