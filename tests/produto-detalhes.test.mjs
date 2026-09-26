import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

// Migration 0033: peso_texto, ingredientes e alergenicos em produtos.
// Admin grava com trim e limites validados no backend; GET admin e GET
// público devolvem os três campos. Estoque, promoção e imagem não mudam.

const cookieDe = session => session.cookie.split(';')[0];

async function catalogo(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare("INSERT OR IGNORE INTO categorias(id,nome) VALUES('BOLO','Bolo')").run();
  return {db, session: await app.auth.createSession(db, 1)};
}

const salvar = (db, session, body, id) =>
  (id ? app.adminProdutoId.onRequestPut : app.adminProdutos.onRequestPost)({
    env: {DB: db}, params: {id: String(id ?? '')},
    request: new Request('https://local.test/api/admin/produtos', {
      method: id ? 'PUT' : 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session), Origin: 'https://local.test'},
      body: JSON.stringify({
        nome: 'Encanto', categoria: 'BOLO', descricao: 'Creme suave', precoCentavos: 1500, estoque: 20, ...body,
      }),
    }),
  });

const linha = (db, id) => db.prepare(
  'SELECT peso_texto, ingredientes, alergenicos, estoque, preco_centavos FROM produtos WHERE id=?',
).bind(id).first();

test('migration 0033: produtos existentes recebem os três campos vazios', async t => {
  const {db} = await catalogo(t);
  assert.deepEqual(
    await db.prepare('SELECT peso_texto, ingredientes, alergenicos FROM produtos WHERE id=1').first(),
    {peso_texto: '', ingredientes: '', alergenicos: ''},
  );
});

test('admin cria e edita peso/ingredientes/alérgenos com trim; GET admin e público devolvem', async t => {
  const {db, session} = await catalogo(t);

  const criado = await salvar(db, session, {
    pesoTexto: '  220 g  ', ingredientes: ' Leite condensado, creme de leite ', alergenicos: '  Contém leite. ',
  });
  assert.equal(criado.status, 201);
  const {id} = await criado.json();
  assert.deepEqual(await linha(db, id), {
    peso_texto: '220 g', ingredientes: 'Leite condensado, creme de leite', alergenicos: 'Contém leite.',
    estoque: 20, preco_centavos: 1500,
  });

  const editado = await salvar(db, session, {pesoTexto: 'aprox. 500 g', ingredientes: 'Chocolate 50%', alergenicos: ''}, id);
  assert.equal(editado.status, 200);
  const depois = await linha(db, id);
  assert.equal(depois.peso_texto, 'aprox. 500 g');
  assert.equal(depois.ingredientes, 'Chocolate 50%');
  assert.equal(depois.alergenicos, '', 'string vazia limpa o campo opcional');

  const admin = await app.adminProdutos.onRequestGet({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/produtos', {headers: {Cookie: cookieDe(session)}}),
  });
  const adminRow = (await admin.json()).produtos.find(p => p.id === id);
  assert.equal(adminRow.peso_texto, 'aprox. 500 g');
  assert.equal(adminRow.ingredientes, 'Chocolate 50%');
  assert.equal(adminRow.alergenicos, '');

  const publico = await app.produtos.onRequestGet({env: {DB: db}});
  const publicoRow = (await publico.json()).produtos.find(p => p.id === id);
  assert.equal(publicoRow.peso_texto, 'aprox. 500 g');
  assert.equal(publicoRow.ingredientes, 'Chocolate 50%');
  assert.equal(publicoRow.alergenicos, '');
});

test('PUT sem os campos (cliente antigo) preserva os detalhes gravados; POST sem eles grava vazio', async t => {
  const {db, session} = await catalogo(t);
  const semCampos = await salvar(db, session, {});
  assert.equal(semCampos.status, 201);
  const {id} = await semCampos.json();
  assert.deepEqual(
    [(await linha(db, id)).peso_texto, (await linha(db, id)).ingredientes, (await linha(db, id)).alergenicos],
    ['', '', ''],
  );

  assert.equal((await salvar(db, session, {pesoTexto: '220 ml', ingredientes: 'Leite', alergenicos: 'Leite'}, id)).status, 200);
  assert.equal((await salvar(db, session, {estoque: 30}, id)).status, 200);
  const atual = await linha(db, id);
  assert.equal(atual.peso_texto, '220 ml');
  assert.equal(atual.ingredientes, 'Leite');
  assert.equal(atual.alergenicos, 'Leite');
  assert.equal(atual.estoque, 30);
});

test('backend recusa detalhes acima do limite ou de tipo inválido, sem gravar', async t => {
  const {db, session} = await catalogo(t);
  const antes = await db.prepare('SELECT COUNT(*) n FROM produtos').first('n');
  const casos = [
    [{pesoTexto: 'x'.repeat(101)}, /Peso \/ porção muito longo/],
    [{ingredientes: 'x'.repeat(2001)}, /Ingredientes muito longo/],
    [{alergenicos: 'x'.repeat(1001)}, /Alérgenos muito longo/],
    [{pesoTexto: 220}, /Peso \/ porção inválido/],
    [{ingredientes: ['leite']}, /Ingredientes inválido/],
  ];
  for (const [body, erro] of casos) {
    const r = await salvar(db, session, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match((await r.json()).error, erro);
  }
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM produtos').first('n'), antes);

  // Limite medido depois do trim: espaços nas pontas não contam.
  const noLimite = await salvar(db, session, {pesoTexto: `  ${'x'.repeat(100)}  `});
  assert.equal(noLimite.status, 201);

  // Edição também valida e não altera nada.
  const r = await salvar(db, session, {ingredientes: 'x'.repeat(2001)}, 1);
  assert.equal(r.status, 400);
  assert.equal((await linha(db, 1)).ingredientes, '');
});
