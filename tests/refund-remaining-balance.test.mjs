import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const backend = fs.readFileSync("functions/api/admin/orders/[id]/refunds.js", "utf8");
const dialog = fs.readFileSync("admin/src/orders/ComandaDialog.tsx", "utf8");
const panel = fs.readFileSync("admin/src/orders/RefundPanel.tsx", "utf8");

test("reembolso usa somente o saldo ainda não devolvido", () => {
  assert.match(backend, /return Math\.max\(0, original - refunded\)/);
  assert.match(backend, /refund:v3:/);
  assert.match(backend, /refundableAfter/);
  assert.match(dialog, /const refundableCents = Math\.max/);
  assert.match(dialog, /Reembolsar saldo restante/);
  assert.match(panel, /refundableCents/);
});
