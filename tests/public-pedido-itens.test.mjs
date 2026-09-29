import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

const env = db => ({ DB: db, MP_ACCESS_TOKEN: "fake" });

function getDetalhe(db) {
  return app.detail.onRequestGet({
    env: env(db),
    request: new Request("https://local.test/api/pedido?token=token")
  });
}

// Duas linhas do mesmo produto, com ids explícitos e fora da ordem de
// inserção. O schema não impede essa repetição; a chave pública é o id.
async function duasLinhasDoMesmoProduto(t) {
  const db = await fixture(t);
  await db.prepare("DELETE FROM pedido_pagamento_alocacoes WHERE pedido_item_id = 1").run();
  await db.prepare("DELETE FROM pedido_itens WHERE id = 1").run();
  await db
    .prepare(
      `INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
        valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em)
       VALUES(3,1,1,'Bolo',1,5000,5000,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
        valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em)
       VALUES(2,1,1,'Bolo',2,5000,10000,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)`
    )
    .run();
  return db;
}

test("GET /api/pedido devolve id distinto por linha, preserva os quatro campos e ordena por id", async t => {
  const db = await duasLinhasDoMesmoProduto(t);
  const response = await getDetalhe(db);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();

  assert.deepEqual(
    body.itens.map(item => Object.keys(item)),
    [
      ["id", "produto_nome", "quantidade", "valor_unitario_centavos", "valor_total_centavos"],
      ["id", "produto_nome", "quantidade", "valor_unitario_centavos", "valor_total_centavos"]
    ]
  );
  assert.deepEqual(body.itens, [
    {
      id: 2,
      produto_nome: "Bolo",
      quantidade: 2,
      valor_unitario_centavos: 5000,
      valor_total_centavos: 10000
    },
    {
      id: 3,
      produto_nome: "Bolo",
      quantidade: 1,
      valor_unitario_centavos: 5000,
      valor_total_centavos: 5000
    }
  ]);
  assert.equal(new Set(body.itens.map(item => item.id)).size, body.itens.length);
});
