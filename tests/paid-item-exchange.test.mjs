import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as exchangePaidItem } from "../functions/api/admin/orders/[id]/items/[itemId]/exchange.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function request({ productId = 2, quantity = 1, refundMethod, confirmRefund } = {}) {
  const body = { produto_id: productId, quantidade: quantity };
  if (refundMethod) body.devolucao_metodo = refundMethod;
  if (confirmRefund) body.confirmacao_devolucao = "DEVOLVIDO";
  return new Request("https://loja.test/api/admin/orders/7/items/11/exchange", {
    method: "POST",
    headers: {
      Origin: "https://loja.test",
      Cookie: "rp_admin_session=sessao",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function buildDb({ targetPrice = 3500 } = {}) {
  const order = {
    id: 7,
    status_pedido: "NOVO",
    status_comanda: "ABERTA",
    reserva_status: "CONVERTIDA",
    valor_total_centavos: 5000
  };
  const source = {
    id: 11,
    pedido_id: 7,
    produto_id: 1,
    produto_nome: "Produto original",
    quantidade: 1,
    valor_unitario_centavos: 5000,
    valor_total_centavos: 5000,
    estoque_baixado_em: "2026-09-06 15:00:00"
  };
  const target = {
    id: 2,
    nome: "Produto novo",
    preco_centavos: targetPrice,
    disponivel: 1,
    ativo: 1,
    estoque: 8,
    estoque_reservado: 0,
    promocao_ativa: 0,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null
  };

  let exchanged = false;
  let paymentValue = 5000;
  let paymentStatus = "PAGO";
  let itemTotal = 5000;
  let refundInserted = false;
  let sourceRestocked = false;
  let targetDeducted = false;

  const db = fakeDb(
    sql => {
      if (sql.includes("FROM admin_sessoes")) {
        return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
      }
      if (sql === "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1") {
        return { first: () => ({ id: 90 }) };
      }
      if (sql.includes("SELECT id, status_pedido, status_comanda, reserva_status") && sql.includes("FROM pedidos")) {
        return { first: () => order };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("WHERE id = ? AND pedido_id = ?") && sql.includes("LIMIT 1")) {
        return { first: () => source };
      }
      if (sql.includes("FROM pedido_pagamento_alocacoes a") && sql.includes("pagamento_valor_centavos")) {
        return {
          all: () => ({
            results: [{
              id: 300,
              pagamento_id: 90,
              valor_centavos: 5000,
              metodo: "PIX_EXTERNO",
              pagamento_valor_centavos: 5000,
              valor_original_centavos: 5000
            }]
          })
        };
      }
      if (sql.includes("FROM produtos WHERE id = ? LIMIT 1")) {
        return { first: () => target };
      }
      if (sql.includes("SELECT * FROM pedidos WHERE id = ? LIMIT 1")) {
        return { first: () => ({ ...order, valor_total_centavos: exchanged ? itemTotal : 5000 }) };
      }
      if (sql.includes("FROM pedido_itens") && sql.includes("ORDER BY id") && !sql.includes("WHERE id = ?")) {
        return {
          all: () => ({
            results: [{
              ...source,
              produto_id: exchanged ? 2 : 1,
              produto_nome: exchanged ? "Produto novo" : "Produto original",
              valor_unitario_centavos: exchanged ? targetPrice : 5000,
              valor_total_centavos: exchanged ? itemTotal : 5000
            }]
          })
        };
      }
      if (sql.includes("FROM pedido_pagamentos") && sql.includes("ORDER BY criado_em ASC")) {
        return {
          all: () => ({
            results: [{ id: 90, pedido_id: 7, metodo: "PIX_EXTERNO", valor_centavos: paymentValue, status: paymentStatus }]
          })
        };
      }
      if (sql.startsWith("UPDATE pedidos SET")) {
        return { run: () => ({ success: true, meta: { changes: 1 } }) };
      }
      return {};
    },
    async statements => {
      const refund = Math.max(0, 5000 - targetPrice);
      assert.ok(statements.some(statement => statement.sql.includes("UPDATE pedido_itens")));
      assert.ok(statements.some(statement => statement.sql.includes("INSERT INTO pedido_item_correcoes")));
      assert.ok(statements.some(statement => statement.sql.includes("SET estoque = estoque +")));
      assert.ok(statements.some(statement => statement.sql.includes("SET estoque = estoque -")));

      if (refund > 0) {
        assert.ok(statements.some(statement => statement.sql.includes("INSERT INTO pedido_reembolsos")));
        assert.ok(statements.some(statement => statement.sql.includes("valor_original_centavos")));
        paymentValue = 5000 - refund;
        refundInserted = true;
      }

      exchanged = true;
      itemTotal = targetPrice;
      sourceRestocked = true;
      targetDeducted = true;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  );

  return {
    db,
    refundInserted: () => refundInserted,
    sourceRestocked: () => sourceRestocked,
    targetDeducted: () => targetDeducted
  };
}

test("troca item pago por mais barato, devolve diferença e corrige estoque", async () => {
  const memory = buildDb({ targetPrice: 3500 });
  const response = await exchangePaidItem({
    request: request({ refundMethod: "PIX_EXTERNO", confirmRefund: true }),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.devolucao_centavos, 1500);
  assert.equal(body.devolucao_metodo, "PIX_EXTERNO");
  assert.equal(body.estoque_original_reposto, true);
  assert.equal(body.estoque_novo_baixado, true);
  assert.equal(body.pago_centavos, 3500);
  assert.equal(body.saldo_centavos, 0);
  assert.equal(body.credito_centavos, 0);
  assert.equal(memory.refundInserted(), true);
  assert.equal(memory.sourceRestocked(), true);
  assert.equal(memory.targetDeducted(), true);
});

test("não troca por produto mais barato sem confirmação da devolução", async () => {
  const memory = buildDb({ targetPrice: 3500 });
  const response = await exchangePaidItem({
    request: request({ refundMethod: "PIX_EXTERNO", confirmRefund: false }),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.match(body.erro, /confirme a devolução/i);
  assert.equal(memory.refundInserted(), false);
  assert.equal(memory.sourceRestocked(), false);
});

test("troca item pago por mais caro e mantém somente a diferença pendente", async () => {
  const memory = buildDb({ targetPrice: 6500 });
  const response = await exchangePaidItem({
    request: request(),
    params: { id: "7", itemId: "11" },
    env: { DB: memory.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.devolucao_centavos, 0);
  assert.equal(body.pago_centavos, 5000);
  assert.equal(body.saldo_centavos, 1500);
  assert.equal(body.status_financeiro, "PARCIAL");
  assert.equal(memory.refundInserted(), false);
  assert.equal(memory.sourceRestocked(), true);
  assert.equal(memory.targetDeducted(), true);
});
