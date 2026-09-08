import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const refundsApi = fs.readFileSync("functions/api/admin/orders/[id]/refunds.js", "utf8");
const ordersPage = fs.readFileSync("admin/src/orders/OrdersPage.tsx", "utf8");
const comandaDialog = fs.readFileSync("admin/src/orders/ComandaDialog.tsx", "utf8");

test("reembolso é permitido apenas para NOVO, PREPARANDO e PRONTO", () => {
  assert.match(refundsApi, /REFUNDABLE_ORDER_STATUSES = new Set\(\["NOVO", "PREPARANDO", "PRONTO"\]\)/);
  assert.match(refundsApi, /REFUNDABLE_ORDER_STATUSES\.has\(orderStatus\)/);
  assert.match(refundsApi, /Pedidos entregues ou cancelados não podem ser reembolsados/);
});

test("drawer de pedidos expõe o fluxo de reembolso quando há valor pago", () => {
  assert.match(ordersPage, /Reembolsar pagamento/);
  assert.match(ordersPage, /<ComandaDialog/);
  assert.match(ordersPage, /selectedRefundAllowed/);
});

test("comanda não oferece reembolso para status bloqueado", () => {
  assert.match(comandaDialog, /refundAllowedByStatus/);
  assert.match(comandaDialog, /Reembolso indisponível para pedidos entregues ou cancelados/);
  assert.match(comandaDialog, /const canRefund = refundAllowedByStatus/);
});
