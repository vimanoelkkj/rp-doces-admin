import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const refundsApi = fs.readFileSync("functions/api/admin/orders/[id]/refunds.js", "utf8");
const comandaDialog = fs.readFileSync("admin/src/orders/ComandaDialog.tsx", "utf8");
const refundPanel = fs.readFileSync("admin/src/orders/RefundPanel.tsx", "utf8");
const migration = fs.readFileSync("migrations/036_reembolsos_parciais.sql", "utf8");

test("permite vários reembolsos concluídos para o mesmo pagamento", () => {
  assert.match(migration, /DROP INDEX IF EXISTS uq_pedido_reembolsos_pagamento_concluido/);
  assert.match(refundsApi, /refund:v2:\$\{pedidoId\}:\$\{pagamentoId\}:\$\{Number\(payment\.valor_centavos/);
});

test("estorno Orders API identifica a devolução atual sem reutilizar a anterior", () => {
  assert.match(refundsApi, /claimedProviderRefundIds/);
  assert.match(refundsApi, /excludedIds/);
  assert.match(refundsApi, /matchingOrderRefund/);
  assert.match(refundsApi, /transactions: \[\{/);
  assert.match(refundsApi, /amount: \(refundCents \/ 100\)\.toFixed\(2\)/);
});

test("comanda mantém reembolso disponível após devolução parcial anterior", () => {
  assert.match(comandaDialog, /refundsByPayment/);
  assert.match(comandaDialog, /paymentRefunds\.some\(refund => refund\.status === "PENDENTE"\)/);
  assert.match(comandaDialog, /Reembolsar saldo restante/);
  assert.doesNotMatch(comandaDialog, /!refundCompleted/);
});

test("painel descreve o saldo atual e não o pagamento original como integral", () => {
  assert.match(refundPanel, /Saldo a reembolsar/);
  assert.match(refundPanel, /saldo ainda pago neste lançamento/);
  assert.doesNotMatch(refundPanel, /Reembolso integral/);
});
