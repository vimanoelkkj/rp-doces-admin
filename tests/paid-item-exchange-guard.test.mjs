import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ordersIndex = fs.readFileSync("functions/api/admin/orders/index.js", "utf8");
const itemsApi = fs.readFileSync("functions/api/admin/orders/[id]/items.js", "utf8");

test("lista de pedidos anexa financeiro por item antes de responder", () => {
  assert.match(ordersIndex, /attachOrderFinancials/);
  assert.match(ordersIndex, /await attachOrderFinancials\(env, pedidos\)/);
});

test("edicao comum bloqueia item com pagamento confirmado", () => {
  assert.match(itemsApi, /pedido_pagamento_alocacoes/);
  assert.match(itemsApi, /Este item possui pagamento confirmado/);
  assert.match(itemsApi, /pp\.status = 'PAGO'/);
});
