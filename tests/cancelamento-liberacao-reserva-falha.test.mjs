import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// Regressao: o cancelamento operacional (PATCH statusPedido=CANCELADO) nao pode responder 200
// quando liberarReservaPedido falha (ok:false) apos o commit do status. A falha D1 e injetada
// apenas no batch de liberacao; D1 descartavel local, sem rede.

const LIBERACAO = "estoque_reservado = estoque_reservado -";

async function preparar(t) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  const session = await app.auth.createSession(db, 1);
  return { db, session };
}

const cancelar = (db, session) =>
  app.adminOrder.onRequestPatch({
    env: { DB: db },
    params: { id: "1" },
    request: new Request("https://local.test/api/admin/pedidos/1", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie.split(";")[0],
        Origin: "https://local.test"
      },
      body: JSON.stringify({ statusPedido: "CANCELADO" })
    })
  });

const snapshot = async db => ({
  pedido: await db
    .prepare("SELECT status_pedido,status_pagamento,reserva_status FROM pedidos WHERE id=1")
    .first(),
  item: await db.prepare("SELECT status_item,estoque_estado FROM pedido_itens WHERE id=1").first(),
  produto: await db.prepare("SELECT estoque,estoque_reservado FROM produtos WHERE id=1").first(),
  pagamentos: (await db.prepare("SELECT COUNT(*) n FROM pedido_pagamentos").first()).n,
  operacoes: (await db.prepare("SELECT COUNT(*) n FROM pedido_operacoes").first()).n
});

test("liberacao normal: cancelar libera a reserva (200)", async t => {
  const { db, session } = await preparar(t);
  const response = await cancelar(db, session);
  assert.equal(response.status, 200);
  const s = await snapshot(db);
  assert.equal(s.pedido.status_pedido, "CANCELADO");
  assert.equal(s.item.estoque_estado, "LIBERADO");
  assert.equal(s.produto.estoque_reservado, 0);
});

test("falha D1 na liberacao: 500 LIBERACAO_RESERVA_FALHOU, pedido cancelado e reserva retida", async t => {
  const { db, session } = await preparar(t);
  const antes = await snapshot(db);
  let injetada = 0;
  db.hook = async (wire, operation) => {
    if (operation === "batch" && wire.some(w => w.sql.includes(LIBERACAO))) {
      injetada++;
      throw new Error("D1_ERROR: injected transient failure");
    }
  };
  t.mock.method(console, "error", () => {});
  const response = await cancelar(db, session);
  db.hook = null;
  const depois = await snapshot(db);
  const corpo = await response.json();

  assert.equal(injetada, 1, "a falha foi injetada exatamente no batch de liberacao");
  // Fatos observados, independentes do veredito:
  assert.equal(depois.pedido.status_pedido, "CANCELADO", "UPDATE de status ja commitado");
  assert.equal(depois.item.estoque_estado, antes.item.estoque_estado, "item segue RESERVADO");
  assert.equal(depois.produto.estoque_reservado, antes.produto.estoque_reservado, "reserva retida");
  assert.equal(depois.pagamentos, 0);
  assert.equal(depois.operacoes, 0);
  // Reserva retida em pedido CANCELADO nunca e reportada como sucesso.
  assert.equal(response.status, 500);
  assert.equal(corpo.code, "LIBERACAO_RESERVA_FALHOU");
  assert.notEqual(corpo.ok, true);
});

test("recuperacao: repetir o PATCH CANCELADO sem falha libera a reserva sem efeito financeiro", async t => {
  const { db, session } = await preparar(t);
  db.hook = async (wire, operation) => {
    if (operation === "batch" && wire.some(w => w.sql.includes(LIBERACAO)))
      throw new Error("D1_ERROR: injected transient failure");
  };
  t.mock.method(console, "error", () => {});
  await cancelar(db, session);
  db.hook = null;
  assert.equal((await snapshot(db)).produto.estoque_reservado, 2);
  assert.equal((await cancelar(db, session)).status, 200);
  const s = await snapshot(db);
  assert.equal(s.item.estoque_estado, "LIBERADO");
  assert.equal(s.produto.estoque_reservado, 0);
  assert.equal(s.produto.estoque, 10);
  assert.equal(s.pagamentos, 0);
  assert.equal(s.operacoes, 0);
  // Terceira chamada: nada a liberar (ok:true, liberado:false) continua 200 e nao muda estoque.
  assert.equal((await cancelar(db, session)).status, 200);
  assert.deepEqual(await snapshot(db), s);
});
