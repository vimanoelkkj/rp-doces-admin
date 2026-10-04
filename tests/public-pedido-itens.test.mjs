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

// Linha CANCELADO (estado final do cancelamento por item) fica no histórico,
// mas não compõe mais o total do pedido: a lista pública não a mostra.
test("GET /api/pedido omite a linha CANCELADO e mantém as demais", async t => {
  const db = await fixture(t);
  await db
    .prepare(
      `INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
        valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_liberado_em)
       VALUES(2,1,1,'Pudim',1,3000,3000,'CANCELADO','LIBERADO',CURRENT_TIMESTAMP)`
    )
    .run();

  const response = await getDetalhe(db);
  assert.equal(response.status, 200);
  const { itens } = await response.json();

  assert.deepEqual(itens, [
    {
      id: 1,
      produto_nome: "Bolo",
      quantidade: 2,
      valor_unitario_centavos: 5000,
      valor_total_centavos: 10000
    }
  ]);
  assert.deepEqual(Object.keys(itens[0]), [
    "id",
    "produto_nome",
    "quantidade",
    "valor_unitario_centavos",
    "valor_total_centavos"
  ]);
});

test("GET /api/pedido devolve lista vazia quando todas as linhas estão CANCELADO", async t => {
  const db = await fixture(t);
  await db
    .prepare(
      `UPDATE pedido_itens SET status_item='CANCELADO', estoque_estado='LIBERADO',
        estoque_liberado_em=CURRENT_TIMESTAMP WHERE id=1`
    )
    .run();

  const response = await getDetalhe(db);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).itens, []);
});

// Destino reservado de uma troca em andamento: não compõe o total, mas já aparecia na lista
// pública e continua aparecendo. Só a linha CANCELADO sai.
test("GET /api/pedido mantém a linha TROCA_PENDENTE (destino de troca em andamento) na lista", async t => {
  const db = await fixture(t);
  await db.batch([
    db.prepare(`UPDATE produtos SET estoque_reservado=3 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,produto_destino_id,
      quantidade_destino,preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,
      diferenca_centavos,tipo_diferenca,estoque_acao_origem,status,snapshot_financeiro)
      VALUES(1,1,1,1,1,3000,10000,3000,-7000,'DEVOLVER','LIBERAR_RESERVA','AGUARDANDO_REEMBOLSO','{}')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,pedido_item_troca_id)
      VALUES(2,1,1,'Pudim',1,3000,3000,'TROCA_PENDENTE','RESERVADO',1)`),
    db.prepare(`UPDATE pedido_item_trocas SET item_destino_id=2 WHERE id=1`)
  ]);

  const response = await getDetalhe(db);
  assert.equal(response.status, 200);
  const { itens } = await response.json();
  assert.deepEqual(
    itens.map(item => item.id),
    [1, 2]
  );
});
