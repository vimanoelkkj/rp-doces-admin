import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// Migration 0033: peso_texto, ingredientes e alergenicos em produtos.
// Admin grava com trim e limites validados no backend; GET admin e GET
// público devolvem os três campos. Estoque, promoção e imagem não mudam.

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
        nome: "Encanto",
        categoria: "BOLO",
        descricao: "Creme suave",
        precoCentavos: 1500,
        estoque: 20,
        ...body
      })
    })
  });

const linha = (db, id) =>
  db
    .prepare(
      "SELECT peso_texto, ingredientes, alergenicos, estoque, preco_centavos FROM produtos WHERE id=?"
    )
    .bind(id)
    .first();

test("migration 0033: produtos existentes recebem os três campos vazios", async t => {
  const { db } = await catalogo(t);
  assert.deepEqual(
    await db
      .prepare("SELECT peso_texto, ingredientes, alergenicos FROM produtos WHERE id=1")
      .first(),
    { peso_texto: "", ingredientes: "", alergenicos: "" }
  );
});

test("admin cria e edita peso/ingredientes/alérgenos com trim; GET admin e público devolvem", async t => {
  const { db, session } = await catalogo(t);

  const criado = await salvar(db, session, {
    pesoTexto: "  220 g  ",
    ingredientes: " Leite condensado, creme de leite ",
    alergenicos: "  Contém leite. "
  });
  assert.equal(criado.status, 201);
  const { id } = await criado.json();
  assert.deepEqual(await linha(db, id), {
    peso_texto: "220 g",
    ingredientes: "Leite condensado, creme de leite",
    alergenicos: "Contém leite.",
    estoque: 20,
    preco_centavos: 1500
  });

  const editado = await salvar(
    db,
    session,
    { pesoTexto: "aprox. 500 g", ingredientes: "Chocolate 50%", alergenicos: "" },
    id
  );
  assert.equal(editado.status, 200);
  const depois = await linha(db, id);
  assert.equal(depois.peso_texto, "aprox. 500 g");
  assert.equal(depois.ingredientes, "Chocolate 50%");
  assert.equal(depois.alergenicos, "", "string vazia limpa o campo opcional");

  const admin = await app.adminProdutos.onRequestGet({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/produtos", {
      headers: { Cookie: cookieDe(session) }
    })
  });
  const adminRow = (await admin.json()).produtos.find(p => p.id === id);
  assert.equal(adminRow.peso_texto, "aprox. 500 g");
  assert.equal(adminRow.ingredientes, "Chocolate 50%");
  assert.equal(adminRow.alergenicos, "");

  const publico = await app.produtos.onRequestGet({ env: { DB: db } });
  const publicoRow = (await publico.json()).produtos.find(p => p.id === id);
  assert.equal(publicoRow.peso_texto, "aprox. 500 g");
  assert.equal(publicoRow.ingredientes, "Chocolate 50%");
  assert.equal(publicoRow.alergenicos, "");
});

test("PUT sem os campos (cliente antigo) preserva os detalhes gravados; POST sem eles grava vazio", async t => {
  const { db, session } = await catalogo(t);
  const semCampos = await salvar(db, session, {});
  assert.equal(semCampos.status, 201);
  const { id } = await semCampos.json();
  assert.deepEqual(
    [
      (await linha(db, id)).peso_texto,
      (await linha(db, id)).ingredientes,
      (await linha(db, id)).alergenicos
    ],
    ["", "", ""]
  );

  assert.equal(
    (
      await salvar(
        db,
        session,
        { pesoTexto: "220 ml", ingredientes: "Leite", alergenicos: "Leite" },
        id
      )
    ).status,
    200
  );
  assert.equal((await salvar(db, session, { estoque: 30 }, id)).status, 200);
  const atual = await linha(db, id);
  assert.equal(atual.peso_texto, "220 ml");
  assert.equal(atual.ingredientes, "Leite");
  assert.equal(atual.alergenicos, "Leite");
  assert.equal(atual.estoque, 30);
});

test("backend recusa detalhes acima do limite ou de tipo inválido, sem gravar", async t => {
  const { db, session } = await catalogo(t);
  const antes = await db.prepare("SELECT COUNT(*) n FROM produtos").first("n");
  const casos = [
    [{ pesoTexto: "x".repeat(101) }, /Peso \/ porção muito longo/],
    [{ ingredientes: "x".repeat(2001) }, /Ingredientes muito longo/],
    [{ alergenicos: "x".repeat(1001) }, /Alérgenos muito longo/],
    [{ pesoTexto: 220 }, /Peso \/ porção inválido/],
    [{ ingredientes: ["leite"] }, /Ingredientes inválido/]
  ];
  for (const [body, erro] of casos) {
    const r = await salvar(db, session, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match((await r.json()).error, erro);
  }
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM produtos").first("n"), antes);

  // Limite medido depois do trim: espaços nas pontas não contam.
  const noLimite = await salvar(db, session, { pesoTexto: `  ${"x".repeat(100)}  ` });
  assert.equal(noLimite.status, 201);

  // Edição também valida e não altera nada.
  const r = await salvar(db, session, { ingredientes: "x".repeat(2001) }, 1);
  assert.equal(r.status, 400);
  assert.equal((await linha(db, 1)).ingredientes, "");
});

// Onda 8F: regressão do narrowing da rota PUT (produtos/[id].ts).
// Preço e estoque inválidos são recusados sem persistir nada; o guard de
// estoque reservado só permite valores >= estoque_reservado.

test("edição recusa preço e estoque inválidos com 400 sem alterar o produto", async t => {
  const casos = [
    { campo: "precoCentavos", nome: "ausente", valor: undefined, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "null", valor: null, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "0", valor: 0, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "-500", valor: -500, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "10.5", valor: 10.5, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: '"1500"', valor: "1500", mensagem: "Preço inválido" },
    { campo: "estoque", nome: "ausente", valor: undefined, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "null", valor: null, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "-1", valor: -1, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "10.5", valor: 10.5, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: '"20"', valor: "20", mensagem: "Estoque inválido" }
  ];
  for (const caso of casos) {
    await t.test(`${caso.campo} ${caso.nome}`, async t => {
      const { db, session } = await catalogo(t);
      const antes = await db.prepare("SELECT * FROM produtos WHERE id=1").first();
      const r = await salvar(db, session, { [caso.campo]: caso.valor }, 1);
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error: caso.mensagem });
      assert.deepEqual(
        await db.prepare("SELECT * FROM produtos WHERE id=1").first(),
        antes,
        "entrada inválida não pode alterar o produto"
      );
    });
  }
});

test("estoque zero é válido na edição (controle)", async t => {
  const { db, session } = await catalogo(t);
  const r = await salvar(db, session, { estoque: 0 }, 1);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await db.prepare("SELECT estoque FROM produtos WHERE id=1").first()).estoque, 0);
});

test("edição não reduz estoque abaixo do reservado; igualdade é permitida", async t => {
  const { db, session } = await catalogo(t);
  await db.prepare("UPDATE produtos SET estoque=10, estoque_reservado=4 WHERE id=1").run();
  const antes = await db.prepare("SELECT * FROM produtos WHERE id=1").first();

  const recusado = await salvar(db, session, { estoque: 3 }, 1);
  assert.equal(recusado.status, 409);
  assert.deepEqual(await recusado.json(), {
    error:
      "Não é possível reduzir o estoque para 3, pois existem 4 unidade(s) reservada(s) em pedidos pendentes"
  });
  assert.deepEqual(
    await db.prepare("SELECT * FROM produtos WHERE id=1").first(),
    antes,
    "recusa por estoque reservado não pode alterar o produto"
  );

  const aceito = await salvar(db, session, { estoque: 4 }, 1);
  assert.equal(aceito.status, 200);
  assert.deepEqual(await aceito.json(), { ok: true });
  const depois = await db.prepare("SELECT * FROM produtos WHERE id=1").first();
  assert.equal(depois.estoque, 4, "estoque igual ao reservado é permitido");
  assert.equal(depois.estoque_reservado, 4, "reserva preservada");
});

// Onda 8F: regressão do narrowing da rota POST (produtos.ts) — as mesmas
// guardas do PUT: preço/estoque inválidos e categoria inexistente/inativa
// recusam sem criar produto.

test("criação recusa preço e estoque inválidos com 400 sem criar produto", async t => {
  const casos = [
    { campo: "precoCentavos", nome: "ausente", valor: undefined, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "null", valor: null, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "0", valor: 0, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "-500", valor: -500, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: "10.5", valor: 10.5, mensagem: "Preço inválido" },
    { campo: "precoCentavos", nome: '"1500"', valor: "1500", mensagem: "Preço inválido" },
    { campo: "estoque", nome: "ausente", valor: undefined, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "null", valor: null, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "-1", valor: -1, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: "10.5", valor: 10.5, mensagem: "Estoque inválido" },
    { campo: "estoque", nome: '"20"', valor: "20", mensagem: "Estoque inválido" }
  ];
  for (const caso of casos) {
    await t.test(`${caso.campo} ${caso.nome}`, async t => {
      const { db, session } = await catalogo(t);
      const antes = await db.prepare("SELECT COUNT(*) n FROM produtos").first("n");
      const r = await salvar(db, session, { [caso.campo]: caso.valor });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error: caso.mensagem });
      assert.equal(
        await db.prepare("SELECT COUNT(*) n FROM produtos").first("n"),
        antes,
        "rejeição não pode criar produto"
      );
    });
  }
});

test("estoque zero é válido na criação (controle)", async t => {
  const { db, session } = await catalogo(t);
  const r = await salvar(db, session, { estoque: 0 });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal(
    (await db.prepare("SELECT estoque FROM produtos WHERE id=?").bind(id).first()).estoque,
    0,
    "produto criado com estoque zero persistido"
  );
});

test("criação recusa categoria inexistente ou inativa com 400 sem criar produto", async t => {
  await t.test("categoria inexistente", async t => {
    const { db, session } = await catalogo(t);
    const antes = await db.prepare("SELECT COUNT(*) n FROM produtos").first("n");
    const r = await salvar(db, session, { categoria: "NAO_EXISTE" });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: "Categoria inválida ou inativa" });
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM produtos").first("n"), antes);
  });

  await t.test("categoria existente desativada", async t => {
    const { db, session } = await catalogo(t);
    const desativacao = await db.prepare("UPDATE categorias SET ativo=0 WHERE id='BOLO'").run();
    assert.equal(desativacao.meta.changes, 1, "BOLO precisa existir para o cenário");
    const antes = await db.prepare("SELECT COUNT(*) n FROM produtos").first("n");
    const r = await salvar(db, session, { categoria: "BOLO" });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: "Categoria inválida ou inativa" });
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM produtos").first("n"), antes);
  });
});
