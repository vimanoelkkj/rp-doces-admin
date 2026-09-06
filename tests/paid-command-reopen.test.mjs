import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as reopenPaidCommand } from "../functions/api/admin/orders/[id]/reopen.js";
import { fakeDb, responseJson } from "./helpers/fake-db.mjs";

function request() {
  return new Request("https://loja.test/api/admin/orders/18/reopen", {
    method: "POST",
    headers: {
      Origin: "https://loja.test",
      Cookie: "rp_admin_session=sessao"
    }
  });
}

function paidClosedOrder(overrides = {}) {
  return {
    id: 18,
    status_pedido: "ENTREGUE",
    status_pagamento: "PAGO",
    status_comanda: "ENCERRADA",
    reserva_status: "CONVERTIDA",
    estoque_baixado_em: "2026-09-05 15:00:00",
    valor_total_centavos: 4000,
    ...overrides
  };
}

function paidLedgerDb(order = paidClosedOrder()) {
  let reopened = false;
  const db = fakeDb(sql => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
    }
    if (sql.includes("SELECT id, status_pedido") && sql.includes("FROM pedidos")) {
      return { first: () => order };
    }
    if (sql.includes("SELECT * FROM pedidos")) {
      return { first: () => ({ ...order, status_comanda: "ABERTA" }) };
    }
    if (sql.includes("SUM(valor_centavos)") && sql.includes("pedido_pagamentos")) {
      return { first: () => ({ total_centavos: 4000 }) };
    }
    if (sql.includes("FROM pedido_itens") && sql.includes("ORDER BY id")) {
      return {
        all: () => ({
          results: [
            {
              id: 101,
              pedido_id: 18,
              produto_id: 1,
              produto_nome: "Encanto",
              quantidade: 1,
              valor_unitario_centavos: 2000,
              valor_total_centavos: 2000,
              estoque_baixado_em: "2026-09-05 15:00:00"
            },
            {
              id: 102,
              pedido_id: 18,
              produto_id: 2,
              produto_nome: "Tentação",
              quantidade: 1,
              valor_unitario_centavos: 2000,
              valor_total_centavos: 2000,
              estoque_baixado_em: "2026-09-05 15:00:00"
            }
          ]
        })
      };
    }
    if (sql.includes("FROM pedido_pagamentos") && sql.includes("ORDER BY criado_em")) {
      return {
        all: () => ({
          results: [{ id: 501, pedido_id: 18, metodo: "PIX_EXTERNO", valor_centavos: 4000, status: "PAGO" }]
        })
      };
    }
    if (sql.includes("UPDATE pedidos SET") && sql.includes("status_comanda = 'ABERTA'")) {
      return {
        run: () => {
          reopened = true;
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
    return {};
  });
  return { db, wasReopened: () => reopened };
}

test("reabre comanda paga sem alterar pagamento nem estoque", async () => {
  const fixture = paidLedgerDb();

  const response = await reopenPaidCommand({
    request: request(),
    params: { id: "18" },
    env: { DB: fixture.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.status_comanda, "ABERTA");
  assert.equal(body.status_pagamento, "PAGO");
  assert.equal(body.valor_pago_centavos, 4000);
  assert.equal(body.saldo_centavos, 0);
  assert.equal(body.estoque_preservado, true);
  assert.equal(fixture.wasReopened(), true);
});

test("corrige status cancelado antigo a partir do ledger pago ao reabrir", async () => {
  const fixture = paidLedgerDb(paidClosedOrder({
    status_pedido: "CANCELADO",
    status_pagamento: "CANCELADO"
  }));

  const response = await reopenPaidCommand({
    request: request(),
    params: { id: "18" },
    env: { DB: fixture.db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.status_comanda, "ABERTA");
  assert.equal(body.status_pedido, "NOVO");
  assert.equal(body.status_pagamento, "PAGO");
  assert.equal(body.valor_pago_centavos, 4000);
  assert.equal(body.estoque_preservado, true);
});

test("não usa o fluxo pago para reabrir comanda sem pagamento confirmado", async () => {
  const db = fakeDb(sql => {
    if (sql.includes("FROM admin_sessoes")) {
      return { first: () => ({ id: 1, nome: "Admin", ativo: 1, papel: "ADMIN" }) };
    }
    if (sql.includes("SELECT id, status_pedido") && sql.includes("FROM pedidos")) {
      return {
        first: () => paidClosedOrder({
          status_pedido: "CANCELADO",
          status_pagamento: "CANCELADO"
        })
      };
    }
    if (sql.includes("SUM(valor_centavos)") && sql.includes("pedido_pagamentos")) {
      return { first: () => ({ total_centavos: 0 }) };
    }
    return {};
  });

  const response = await reopenPaidCommand({
    request: request(),
    params: { id: "18" },
    env: { DB: db }
  });
  const body = await responseJson(response);

  assert.equal(response.status, 409);
  assert.equal(body.codigo, "COMANDA_SEM_PAGAMENTO_CONFIRMADO");
});
