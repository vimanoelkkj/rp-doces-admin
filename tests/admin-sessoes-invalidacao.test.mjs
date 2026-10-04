import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { app, authDeProducao, fixture } from "./helpers/b3.mjs";

// Invalidação de sessões administrativas. Propriedades garantidas pelo desenho
// (uma instrução ou uma transação no D1), nunca por janela curta:
//
// 1. Desativar uma conta e encerrar suas sessões é uma operação só: se o
//    encerramento falha, a desativação também não acontece.
// 2. Um login que validou a credencial ANTES de uma redefinição de senha ou de
//    uma desativação não consegue criar sessão DEPOIS dela.
// 3. Não existe caminho de produção que crie sessão sem essa guarda.
//
// Nos testes, `app.auth.createSession(db, id)` é fixture (ver helpers/b3.mjs);
// a função real é `authDeProducao.createSession`.

const SENHA_ANTIGA = "senha-admin-123";
const cookieDe = session => session.cookie.split(";")[0];

async function bancada(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const hash = await app.auth.hashPassword(SENHA_ANTIGA);
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(2, 'Admin Dois', 'admin_dois', 'dois@local.test', ?, 'ADMIN', 1)`
    )
    .bind(hash)
    .run();
  const owner = await app.auth.createSession(db, 1);
  const alvo = await app.auth.createSession(db, 2);
  return { db, owner, alvo };
}

function putAdmin(db, session, id, body) {
  return app.adminAdministradoresId.onRequest({
    env: { DB: db },
    params: { id: String(id) },
    request: new Request(`https://local.test/api/admin/administradores/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://local.test",
        Cookie: cookieDe(session)
      },
      body: JSON.stringify(body)
    })
  });
}

const requisicaoDeLogin = body =>
  new Request("https://local.test/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://local.test",
      "CF-Connecting-IP": "192.168.1.50"
    },
    body: JSON.stringify(body)
  });

const postLogin = (db, body) =>
  app.login.onRequestPost({ env: { DB: db }, request: requisicaoDeLogin(body) });

const sessoesDe = async (db, id) =>
  (
    await db
      .prepare("SELECT COUNT(*) AS n FROM admin_sessoes WHERE usuario_id = ?")
      .bind(id)
      .first()
  ).n;

const usuarioDoCookie = (db, cookie) =>
  app.auth.currentUser(db, new Request("https://local.test/", { headers: { Cookie: cookie } }));

// Suspende o login logo antes de gravar a sessão: a senha já foi verificada e a
// sessão ainda não existe. É o pior intercalamento possível. `liberar()` solta o
// INSERT retido e desliga o hook.
function segurarCriacaoDaSessao(db) {
  let chegou;
  const naPorta = new Promise(resolve => {
    chegou = resolve;
  });
  let abrir;
  const porta = new Promise(resolve => {
    abrir = resolve;
  });
  db.hook = async statements => {
    if (statements.some(s => s.sql.includes("INSERT INTO admin_sessoes"))) {
      chegou();
      await porta;
    }
    return statements;
  };
  return {
    naPorta,
    liberar() {
      db.hook = null;
      abrir();
    }
  };
}

/* ───────────── 1. toggle_ativo: UPDATE + DELETE atômicos ───────────── */

test("toggle_ativo: falha ao encerrar as sessões desfaz a desativação (UPDATE e DELETE no mesmo batch)", async t => {
  const { db, owner, alvo } = await bancada(t);

  // O DELETE vira uma instrução que falha NA EXECUÇÃO (NOT NULL). Quando as duas
  // instruções estão no mesmo batch, o UPDATE já rodou e precisa sofrer rollback.
  db.hook = async statements =>
    statements.map(s =>
      s.sql.includes("DELETE FROM admin_sessoes")
        ? {
            sql: "INSERT INTO admin_sessoes (usuario_id, token_hash, expira_em) VALUES (NULL, 'x', 'x')",
            args: []
          }
        : s
    );
  await assert.rejects(putAdmin(db, owner, 2, { acao: "toggle_ativo", ativo: false }), /NOT NULL/);
  db.hook = null;

  const linha = await db.prepare("SELECT ativo FROM usuarios_admin WHERE id = 2").first();
  assert.equal(linha.ativo, 1, "o UPDATE sofreu rollback junto com o DELETE que falhou");
  assert.equal(await sessoesDe(db, 2), 1, "a sessão continua exatamente como estava");
  assert.ok(await usuarioDoCookie(db, cookieDe(alvo)), "a conta continua autenticando");
});

/* ───────────── 2. login em voo x redefinição de senha ───────────── */

test("controle: login suspenso antes do INSERT, sem alteração concorrente, termina com sessão válida", async t => {
  const { db } = await bancada(t);
  const gate = segurarCriacaoDaSessao(db);

  const login = postLogin(db, { username: "admin_dois", senha: SENHA_ANTIGA });
  await gate.naPorta;
  gate.liberar();
  const res = await login;

  assert.equal(res.status, 200);
  const cookie = res.headers.get("Set-Cookie")?.split(";")[0];
  assert.ok(cookie, "login legítimo recebe cookie");
  assert.equal((await usuarioDoCookie(db, cookie))?.username, "admin_dois");
  assert.equal(await sessoesDe(db, 2), 2, "sessão da bancada + a do login");
});

test("corrida: login que validou a senha antiga não cria sessão depois da redefinição", async t => {
  const { db, owner } = await bancada(t);

  // Duas falhas anteriores do mesmo IP e usuário: a corrida precisa somar, não zerar.
  for (let i = 0; i < 2; i++) {
    assert.equal((await postLogin(db, { username: "admin_dois", senha: "errada" })).status, 401);
  }
  const chave = await app.rateLimit.keyFor(requisicaoDeLogin({}), "admin_dois");
  const falhas = async () =>
    (await db.prepare("SELECT falhas FROM auth_rate_limits WHERE chave = ?").bind(chave).first())
      ?.falhas;
  assert.equal(await falhas(), 2);

  const gate = segurarCriacaoDaSessao(db);
  const login = postLogin(db, { username: "admin_dois", senha: SENHA_ANTIGA });
  await gate.naPorta; // senha antiga validada, sessão ainda não gravada

  const reset = await putAdmin(db, owner, 2, { acao: "resetar_senha", senha: "nova-senha-456" });
  assert.equal(reset.status, 200);
  assert.equal(await sessoesDe(db, 2), 0, "o reset encerrou as sessões existentes");

  gate.liberar();
  const res = await login;

  assert.equal(res.status, 401, "credencial antiga não gera mais sessão");
  assert.deepEqual(await res.json(), { error: "Usuário ou senha incorretos" });
  assert.equal(res.headers.get("Set-Cookie"), null, "nenhum cookie é emitido");
  assert.equal(await sessoesDe(db, 2), 0, "nenhuma sessão nasceu depois do reset");
  assert.equal(await falhas(), 3, "a tentativa recusada conta como falha no rate limit");

  // Depois da corrida só a senha nova autentica.
  assert.equal((await postLogin(db, { username: "admin_dois", senha: SENHA_ANTIGA })).status, 401);
  const novo = await postLogin(db, { username: "admin_dois", senha: "nova-senha-456" });
  assert.equal(novo.status, 200);
  assert.ok(await usuarioDoCookie(db, novo.headers.get("Set-Cookie").split(";")[0]));
});

/* ───────────── 3. login em voo x desativação ───────────── */

test("corrida: login em voo não cria sessão para conta desativada nem a revive ao reativar", async t => {
  const { db, owner, alvo } = await bancada(t);
  const gate = segurarCriacaoDaSessao(db);

  const login = postLogin(db, { username: "admin_dois", senha: SENHA_ANTIGA });
  await gate.naPorta;

  const desativar = await putAdmin(db, owner, 2, { acao: "toggle_ativo", ativo: false });
  assert.equal(desativar.status, 200);

  gate.liberar();
  const res = await login;
  assert.equal(res.status, 401, "conta desativada não gera sessão");
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(await sessoesDe(db, 2), 0, "nenhuma sessão residual para a conta desativada");

  const reativar = await putAdmin(db, owner, 2, { acao: "toggle_ativo", ativo: true });
  assert.equal(reativar.status, 200);
  assert.equal(await usuarioDoCookie(db, cookieDe(alvo)), null, "cookie anterior não revive");
  assert.equal(await sessoesDe(db, 2), 0);
});

/* ───────────── 4. nenhum caminho cria sessão sem a guarda ───────────── */

test("createSession de produção só cria sessão com o hash vigente de uma conta ativa", async t => {
  const { db } = await bancada(t);
  const criar = authDeProducao.createSession;
  const total = async () => (await db.prepare("SELECT COUNT(*) AS n FROM admin_sessoes").first()).n;
  const hashVigente = (
    await db.prepare("SELECT senha_hash FROM usuarios_admin WHERE id = 2").first()
  ).senha_hash;
  const antes = await total();

  assert.equal(await criar(db, 2, "pbkdf2_sha256$100000$00$00"), null, "hash que não é o vigente");
  assert.equal(await criar(db, 2), null, "sem hash não há caminho sem a guarda");
  assert.equal(await criar(db, 999, hashVigente), null, "usuário inexistente");
  await db.prepare("UPDATE usuarios_admin SET ativo = 0 WHERE id = 2").run();
  assert.equal(await criar(db, 2, hashVigente), null, "conta inativa");
  assert.equal(await total(), antes, "nenhuma recusa gravou linha");

  await db.prepare("UPDATE usuarios_admin SET ativo = 1 WHERE id = 2").run();
  const sessao = await criar(db, 2, hashVigente);
  assert.match(sessao.cookie, /^rp_admin_session=/);
  assert.equal(await total(), antes + 1, "hash vigente e conta ativa criam exatamente uma sessão");
});

test("só functions/lib/auth.ts grava em admin_sessoes, e sempre com INSERT condicional", async () => {
  const raiz = new URL("../functions/", import.meta.url);
  const arquivos = (await readdir(raiz, { recursive: true })).filter(f => /\.ts$/.test(f));
  const gravadores = [];
  for (const arquivo of arquivos) {
    const fonte = await readFile(new URL(arquivo, raiz), "utf8");
    if (/INSERT\s+INTO\s+admin_sessoes/i.test(fonte)) gravadores.push(arquivo.replace(/\\/g, "/"));
  }
  assert.deepEqual(gravadores, ["lib/auth.ts"], "nenhuma rota cria sessão por conta própria");

  const auth = await readFile(new URL("lib/auth.ts", raiz), "utf8");
  const inserts = [...auth.matchAll(/INSERT INTO admin_sessoes[^`]*`/g)].map(m => m[0]);
  assert.equal(inserts.length, 1, "um único ponto de criação de sessão");
  assert.match(inserts[0], /WHERE EXISTS/, "INSERT sempre condicionado à credencial vigente");
});
