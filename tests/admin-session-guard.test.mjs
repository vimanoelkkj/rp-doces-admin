import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state } from "./helpers/b3.mjs";

// Onda 9C · ETAPA 3 — o fim da validade de uma sessão administrativa é decidido
// pelo BACKEND. Um cookie que o React ainda exibiria como autenticado precisa
// ser recusado por `currentUser`/`requireUser` quando (a) `expira_em` ficou no
// passado ou (b) o usuário foi desativado. Nenhuma regra de autenticação,
// schema ou handler de produção foi alterada para estes testes.
//
// Cobertura: leitura (GET), mutação (POST/PATCH/PUT) e dispatcher explícito
// (`onRequest`), porque a proteção é por handler — não há middleware de auth.
// As mutações enviam Origin da mesma origem para que o 401 venha da sessão,
// e não do sameOrigin (que responderia 403 antes).

const KEY = "11111111-1111-4111-8111-111111111111";
const EXPIRADA = "2000-01-01T00:00:00.000Z";
const cookieDe = session => session.cookie.split(";")[0];

const ROTAS = [
  {
    nome: "GET /api/admin/pedidos",
    modulo: "adminCreate",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/pedidos"
  },
  {
    nome: "GET /api/admin/pedidos/1",
    modulo: "adminOrder",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/pedidos/1",
    params: { id: "1" }
  },
  {
    nome: "GET /api/admin/pedidos/1/historico",
    modulo: "adminHistorico",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/pedidos/1/historico",
    params: { id: "1" }
  },
  {
    nome: "GET /api/admin/dashboard",
    modulo: "dashboard",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/dashboard"
  },
  {
    nome: "GET /api/admin/produtos",
    modulo: "adminProdutos",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/produtos"
  },
  {
    nome: "GET /api/admin/despesas",
    modulo: "adminDespesas",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/despesas"
  },
  {
    nome: "GET /api/admin/notificacoes",
    modulo: "adminNotificacoes",
    handler: "onRequestGet",
    method: "GET",
    url: "https://local.test/api/admin/notificacoes"
  },
  {
    nome: "POST /api/admin/pedidos",
    modulo: "adminCreate",
    handler: "onRequestPost",
    method: "POST",
    url: "https://local.test/api/admin/pedidos",
    body: { items: [{ id: 1, quantity: 1 }], cliente: { nome: "Teste", whatsapp: "11999999999" } }
  },
  {
    nome: "POST /api/admin/pedidos/1/pagamentos",
    modulo: "adminPayment",
    handler: "onRequestPost",
    method: "POST",
    url: "https://local.test/api/admin/pedidos/1/pagamentos",
    params: { id: "1" },
    body: { metodo: "DINHEIRO", valorCentavos: 3000, operationKey: KEY }
  },
  {
    nome: "PATCH /api/admin/pedidos/1",
    modulo: "adminOrder",
    handler: "onRequestPatch",
    method: "PATCH",
    url: "https://local.test/api/admin/pedidos/1",
    params: { id: "1" },
    body: { arquivado: true }
  },
  {
    nome: "POST /api/admin/produtos",
    modulo: "adminProdutos",
    handler: "onRequestPost",
    method: "POST",
    url: "https://local.test/api/admin/produtos",
    body: { nome: "Produto Novo", precoCentavos: 100, categoria: "BOLO" }
  },
  {
    nome: "PUT /api/admin/produtos/1",
    modulo: "adminProdutoId",
    handler: "onRequestPut",
    method: "PUT",
    url: "https://local.test/api/admin/produtos/1",
    params: { id: "1" },
    body: { nome: "Bolo", precoCentavos: 1, categoria: "BOLO" }
  },
  {
    nome: "PUT /api/admin/administradores/2 (dispatcher onRequest)",
    modulo: "adminAdministradoresId",
    handler: "onRequest",
    method: "PUT",
    url: "https://local.test/api/admin/administradores/2",
    params: { id: "2" },
    body: { papel: "ADMIN" }
  }
];

function chamar(rota, db, cookie, { origin = "https://local.test" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (rota.method !== "GET") headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  return app[rota.modulo][rota.handler]({
    env: { DB: db },
    params: rota.params ?? {},
    waitUntil() {},
    request: new Request(rota.url, {
      method: rota.method,
      headers,
      body: rota.body === undefined ? undefined : JSON.stringify(rota.body)
    })
  });
}

async function rejeitada(db, cookie, rotulo) {
  const antes = await state(db);
  for (const rota of ROTAS) {
    const response = await chamar(rota, db, cookie);
    assert.equal(response.status, 401, `${rotulo}: ${rota.nome}`);
    assert.deepEqual(await response.json(), { error: "Não autenticado" }, rota.nome);
    assert.equal(response.headers.get("Set-Cookie"), null, `${rota.nome} não renova cookie`);
  }
  assert.deepEqual(await state(db), antes, `${rotulo}: nenhum efeito colateral no banco`);
}

test("9C: sessão expirada (expira_em no passado) é recusada com 401 em todas as rotas admin", async t => {
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);
  await db
    .prepare("UPDATE admin_sessoes SET expira_em=? WHERE token_hash IS NOT NULL")
    .bind(EXPIRADA)
    .run();

  const linha = await db.prepare("SELECT expira_em FROM admin_sessoes").first();
  assert.equal(linha.expira_em, EXPIRADA, "a sessão existe, mas venceu");
  assert.equal((await db.prepare("SELECT ativo FROM usuarios_admin WHERE id=1").first()).ativo, 1);

  await rejeitada(db, cookieDe(session), "sessão expirada");
});

test("9C: usuário desativado com sessão ainda válida é recusado com 401", async t => {
  const db = await fixture(t, { ledger: false });
  // O usuário 1 do fixture é o último OWNER ativo e um trigger de banco o
  // protege; a desativação é testada num ADMIN próprio, como na operação real.
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel,ativo)
       VALUES(2,'Operadora','operadora','operadora@local.test','unused','ADMIN',1)`
    )
    .run();
  const session = await app.auth.createSession(db, 2);
  assert.equal(
    (await chamar(ROTAS[0], db, cookieDe(session))).status,
    200,
    "acesso antes da troca"
  );

  await db.prepare("UPDATE usuarios_admin SET ativo=0 WHERE id=2").run();
  const linha = await db.prepare("SELECT ativo FROM usuarios_admin WHERE id=2").first();
  assert.equal(linha.ativo, 0);
  const sessoes = await db.prepare("SELECT expira_em FROM admin_sessoes").all();
  assert.equal(sessoes.results.length, 1, "a sessão continua gravada e dentro da validade");
  assert.ok(sessoes.results[0].expira_em > new Date().toISOString());

  await rejeitada(db, cookieDe(session), "usuário desativado");
});

test("9C: cookie inexistente, vazio ou aleatório recebe o mesmo 401 genérico", async t => {
  const db = await fixture(t, { ledger: false });
  await rejeitada(db, undefined, "sem cookie");
  await rejeitada(db, "rp_admin_session=", "cookie vazio");
  await rejeitada(db, "rp_admin_session=token-inventado-pelo-atacante", "cookie forjado");
});

test("9C: sessão válida de usuário ativo preserva leitura e mutação", async t => {
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);
  const cookie = cookieDe(session);

  // O pedido do fixture é SITE + PENDENTE e fica deliberadamente fora da
  // listagem; o pagamento manual abaixo o torna operacional (PARCIAL).
  const pagamento = await chamar(ROTAS[8], db, cookie);
  assert.equal(pagamento.status, 201);
  assert.equal((await pagamento.json()).ok, true);

  const lista = await chamar(ROTAS[0], db, cookie);
  assert.equal(lista.status, 200);
  const corpoLista = await lista.json();
  assert.equal(corpoLista.total, 1);
  assert.equal(corpoLista.pedidos[0].id, 1);

  const detalhe = await chamar(ROTAS[1], db, cookie);
  assert.equal(detalhe.status, 200);

  assert.equal(
    (await state(db)).pagamentos.length,
    1,
    "a mutação financeira da mesma sessão valeu"
  );
});

test("9C: mutação de origem cruzada responde 403 antes da sessão — os guards não se confundem", async t => {
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);
  await db.prepare("UPDATE admin_sessoes SET expira_em=?").bind(EXPIRADA).run();

  const rota = ROTAS[8];
  const cruzada = await chamar(rota, db, cookieDe(session), { origin: "https://evil.test" });
  assert.equal(cruzada.status, 403, "sameOrigin vence: 403, não 401");
  assert.deepEqual(await cruzada.json(), { error: "Origem inválida" });

  const mesmaOrigem = await chamar(rota, db, cookieDe(session));
  assert.equal(mesmaOrigem.status, 401, "com origem válida, quem recusa é a sessão");
  assert.deepEqual(await mesmaOrigem.json(), { error: "Não autenticado" });
  assert.equal((await state(db)).pagamentos.length, 0);
});
