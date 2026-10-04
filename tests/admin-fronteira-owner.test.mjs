import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";
import { carregarRotasAdmin, chamarRota } from "./helpers/adminRotas.mjs";

// Fronteira ADMIN x OWNER em /api/admin/administradores. Um ADMIN com sessão válida e
// origem correta só lê a própria conta: criar contas, mudar papel e desativar outras
// contas é recusado com 403 e não toca em nada, nem em usuarios_admin nem em
// admin_sessoes. Cada recusa depende de uma guarda `isOwner` que, removida sozinha,
// nenhum outro teste administrativo percebia (as rotas eram exercitadas só como OWNER).
//
// Sessão e origem são sempre válidas: o 403 só pode vir do papel, nunca de requireUser
// (401) nem de sameOrigin. Por isso os testes não comparam o texto da mensagem.

const ORIGEM = "https://local.test";
const rotas = await carregarRotasAdmin();
const colecao = rotas.find(r => r.arquivo === "functions/api/admin/administradores.ts");
const porId = rotas.find(r => r.arquivo === "functions/api/admin/administradores/[id].ts");

const cookieDe = sessao => sessao.cookie.split(";")[0];

function chamar(db, sessao, rota, method, { id, body } = {}) {
  const alvo = id
    ? { url: `${ORIGEM}/api/admin/administradores/${id}`, params: { id: String(id) } }
    : rota;
  return chamarRota(rota.handlers.find(h => h.method === method).handler, alvo, {
    env: { DB: db },
    method,
    origin: ORIGEM,
    cookie: cookieDe(sessao),
    body
  });
}

// OWNER (id 1, seed da bancada), ADMIN chamador (id 2) e ADMIN alvo (id 3), todos com sessão.
async function bancada(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const hash = await app.auth.hashPassword("senha-admin-123");
  for (const id of [2, 3]) {
    await db
      .prepare(
        `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
         VALUES(?, ?, ?, ?, ?, 'ADMIN', 1)`
      )
      .bind(id, `Admin ${id}`, `admin_${id}`, `admin_${id}@local.test`, hash)
      .run();
  }
  await app.auth.createSession(db, 3);
  return {
    db,
    owner: await app.auth.createSession(db, 1),
    admin: await app.auth.createSession(db, 2)
  };
}

const estado = async db => ({
  usuarios: (await db.prepare("SELECT * FROM usuarios_admin ORDER BY id").all()).results,
  sessoes: (
    await db
      .prepare("SELECT usuario_id, token_hash, expira_em FROM admin_sessoes ORDER BY id")
      .all()
  ).results
});

// 403 e nenhuma consequência: usuarios_admin e admin_sessoes (de ninguém) mudam.
async function exigirRecusa(db, chamada) {
  const antes = await estado(db);
  const res = await chamada();
  assert.equal(res.status, 403);
  assert.deepEqual(await estado(db), antes);
}

test("ADMIN não promove outro ADMIN a OWNER (alterar_papel)", async t => {
  const { db, admin } = await bancada(t);
  await exigirRecusa(db, () =>
    chamar(db, admin, porId, "PUT", { id: 3, body: { acao: "alterar_papel", papel: "OWNER" } })
  );
});

// Aqui há duas guardas em série (papel e "não altere a própria conta"): o teste só falha
// se as duas caírem, que é justamente o caminho da auto-promoção.
test("ADMIN não se promove a OWNER (alterar_papel na própria conta)", async t => {
  const { db, admin } = await bancada(t);
  await exigirRecusa(db, () =>
    chamar(db, admin, porId, "PUT", { id: 2, body: { acao: "alterar_papel", papel: "OWNER" } })
  );
});

test("ADMIN não desativa outras contas, OWNER incluso (toggle_ativo)", async t => {
  const { db, admin } = await bancada(t);
  for (const id of [1, 3]) {
    await exigirRecusa(db, () =>
      chamar(db, admin, porId, "PUT", { id, body: { acao: "toggle_ativo", ativo: false } })
    );
  }
});

test("ADMIN não cria contas, nem OWNER nem ADMIN; o OWNER cria (POST)", async t => {
  const { db, owner, admin } = await bancada(t);
  const nova = (username, papel) => ({
    nome: "Conta Nova",
    username,
    email: `${username}@local.test`,
    senha: "senha-forte-123",
    papel
  });

  // Controle: o payload é válido, então só o papel separa o 201 do 403.
  const criada = await chamar(db, owner, colecao, "POST", {
    body: nova("criada_pelo_owner", "ADMIN")
  });
  assert.equal(criada.status, 201);

  for (const papel of ["OWNER", "ADMIN"]) {
    await exigirRecusa(db, () =>
      chamar(db, admin, colecao, "POST", { body: nova(`intruso_${papel.toLowerCase()}`, papel) })
    );
  }
});

test("ADMIN lista só a própria conta; o OWNER lista todas; nenhuma com credencial (GET)", async t => {
  const { db, owner, admin } = await bancada(t);

  const doAdmin = await (await chamar(db, admin, colecao, "GET")).json();
  assert.deepEqual(
    doAdmin.administradores.map(conta => conta.id),
    [2]
  );

  const doOwner = await (await chamar(db, owner, colecao, "GET")).json();
  assert.deepEqual(
    doOwner.administradores.map(conta => conta.id).sort((a, b) => a - b),
    [1, 2, 3]
  );

  for (const conta of [...doAdmin.administradores, ...doOwner.administradores]) {
    assert.equal("senha_hash" in conta, false);
  }
});
