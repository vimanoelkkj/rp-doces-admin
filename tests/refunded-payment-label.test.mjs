import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ordersPage = fs.readFileSync("admin/src/orders/OrdersPage.tsx", "utf8");
const ordersCss = fs.readFileSync("admin/src/orders/OrdersPage.module.css", "utf8");

test("lista de pedidos diferencia pagamento reembolsado de pendente", () => {
  assert.match(ordersPage, /status === "REEMBOLSADO"/);
  assert.match(ordersPage, /refunded: true, label: "Reembolsado"/);
  assert.match(ordersPage, /payment\.refunded/);
  assert.match(ordersPage, />Reembolsado</);
  assert.match(ordersCss, /\.payment-refunded/);
});
