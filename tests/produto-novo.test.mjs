import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// Migration 0034: flag booleana `novo` na tabela produtos.
// Backend persiste 1 para true e 0 para false; GET admin e público devolvem.

const cookieDe = session => session.cookie.split(";")[0];

async function catalogo(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM pedidos WHERE id=1").run();
  await db.prepare("INSERT OR IGNORE INTO categorias(id,nome) VALUES('BOLO','Bolo')").run();
  return { db, session: await app.auth.createSession(db, 1) };
}

const salvar = (db, session, body, id) =>
  (id ? app.adminProdutoId.onRequestPut : app.adminProdutos.onRequestPost)({
    env: { DB: db },
    params: { id: String(id ?? "") },
    request: new Request("https://local.test/api/admin/produtos", {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieDe(session),
        Origin: "https://local.test"
      },
      body: JSON.stringify({
        nome: "Bolo Trufado",
        categoria: "BOLO",
        descricao: "Delicioso",
        precoCentavos: 2500,
        estoque: 10,
        ...body
      })
    })
  });

test("migration 0034: produtos preexistentes possuem novo = 0 por padrão", async t => {
  const { db } = await catalogo(t);
  const row = await db.prepare("SELECT novo FROM produtos WHERE id=1").first();
  assert.equal(row.novo, 0);
});

test("admin cria produto com novo: true/false e persiste no banco", async t => {
  const { db, session } = await catalogo(t);

  const resComNovo = await salvar(db, session, { novo: true });
  assert.equal(resComNovo.status, 201);
  const { id: idNovo } = await resComNovo.json();
  const rowNovo = await db.prepare("SELECT novo FROM produtos WHERE id=?").bind(idNovo).first();
  assert.equal(rowNovo.novo, 1);

  const resSemNovo = await salvar(db, session, { novo: false });
  assert.equal(resSemNovo.status, 201);
  const { id: idSemNovo } = await resSemNovo.json();
  const rowSemNovo = await db.prepare("SELECT novo FROM produtos WHERE id=?").bind(idSemNovo).first();
  assert.equal(rowSemNovo.novo, 0);
});

test("admin edita flag novo via PUT e preserva valor quando omitido", async t => {
  const { db, session } = await catalogo(t);

  const resCriar = await salvar(db, session, { novo: true });
  const { id } = await resCriar.json();

  // Desativa flag
  const resDesativar = await salvar(db, session, { novo: false }, id);
  assert.equal(resDesativar.status, 200);
  assert.equal((await db.prepare("SELECT novo FROM produtos WHERE id=?").bind(id).first()).novo, 0);

  // Reativa flag
  const resReativar = await salvar(db, session, { novo: true }, id);
  assert.equal(resReativar.status, 200);
  assert.equal((await db.prepare("SELECT novo FROM produtos WHERE id=?").bind(id).first()).novo, 1);

  // Omitido no payload preserva 1
  const resPreservar = await salvar(db, session, {}, id);
  assert.equal(resPreservar.status, 200);
  assert.equal((await db.prepare("SELECT novo FROM produtos WHERE id=?").bind(id).first()).novo, 1);
});

test("GET /api/admin/produtos e GET /api/produtos expõem o campo novo", async t => {
  const { db, session } = await catalogo(t);

  const res = await salvar(db, session, { novo: true });
  const { id } = await res.json();

  const resAdmin = await app.adminProdutos.onRequestGet({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/produtos", {
      headers: { Cookie: cookieDe(session) }
    })
  });
  const adminItem = (await resAdmin.json()).produtos.find(p => p.id === id);
  assert.equal(adminItem.novo, 1);

  const resPublico = await app.produtos.onRequestGet({ env: { DB: db } });
  const publicoItem = (await resPublico.json()).produtos.find(p => p.id === id);
  assert.equal(publicoItem.novo, 1);
});
