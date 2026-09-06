import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPut as updateOrder } from "../functions/api/admin/orders/[id].js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function request(statusPagamento) {
  return new Request("https://loja.test/api/admin/orders/18", {
    method: "PUT",
    headers: {
      Origin: "https://loja.test",
      Cookie: "rp_admin_session=sessao",
      "content-type": "application/json"
    },
    body: JSON.stringify({ status_pagamento: statusPagamento })
  });
}

function canceledManualOrder() {
  return {
    id: 18,
    origem_pedido: "MANUAL",
    status_pedido: "CANCELADO",
    status_pagamento: "CANCELADO",
    status_comanda: "ENCERRADA",
    reserva_status: "LIBERADA",
    estoque_baixado_em: null,
    valor_total_centavos: 4000
  };
}

function reopenDb() {
  let reopened = false;
  const db = fakeDb(
    sql => {
      if (sql.includes("FROM admin_sessoes")) {
        return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
      }
      if (sql.includes("FROM pedidos WHERE id = ? LIMIT 1")) {
        return { first: () => canceledManualOrder() };
      }
      if (sql.includes("SUM(valor_centavos)") && sql.includes("pedido_pagamentos")) {
        return { first: () => ({ total_centavos: 0 }) };
      }
      if (sql.includes("SUM(quantidade) AS quantidade") && sql.includes("FROM pedido_itens")) {
        return { all: () => ({ results: [{ produto_id: 7, quantidade: 2 }] }) };
      }
      if (sql.includes("SELECT id, ativo, estoque, estoque_reservado") && sql.includes("FROM produtos")) {
        return { first: () => ({ id: 7, ativo: 1, estoque: 10, estoque_reservado: 0 }) };
      }
      return {};
    },
    async statements => {
      if (statements.some(statement => statement.sql.includes("status_comanda = 'ABERTA'"))) {
        reopened = true;
      }
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  return { db, reopened: () => reopened };
}

test("reabre comanda manual cancelada ao voltar pagamento para pendente", async () => {
  const memory = reopenDb();
  const response = await updateOrder({
    request: request("PENDENTE"),
    params: { id: "18" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.status_pagamento, "PENDENTE");
  assert.equal(body.status_pedido, "NOVO");
  assert.equal(body.status_comanda, "ABERTA");
  assert.equal(memory.reopened(), true);
});

test("não aceita cancelar pagamento pelo seletor", async () => {
  const memory = reopenDb();
  const response = await updateOrder({
    request: request("CANCELADO"),
    params: { id: "18" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 400);
  assert.match(body.erro, /não pode ser cancelado pelo seletor/i);
  assert.equal(memory.reopened(), false);
});
