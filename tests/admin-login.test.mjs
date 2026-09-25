import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app, fixture } from './helpers/b3.mjs';

function postLogin(db, body, { origin = 'https://local.test', ip = '192.168.1.50' } = {}) {
  return app.login.onRequestPost({
    env: { DB: db },
    request: new Request('https://local.test/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify(body),
    }),
  });
}

async function setupUsers(db) {
  const activePassword = 'senha-correta-admin';
  const activeHash = await app.auth.hashPassword(activePassword);
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(10, 'Admin Ativo', 'admin_ativo', 'ativo@local.test', ?, 'ADMIN', 1)`
    )
    .bind(activeHash)
    .run();

  const inactivePassword = 'senha-inativo-admin';
  const inactiveHash = await app.auth.hashPassword(inactivePassword);
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(11, 'Admin Inativo', 'admin_inativo', 'inativo@local.test', ?, 'ADMIN', 0)`
    )
    .bind(inactiveHash)
    .run();

  return { activePassword, inactivePassword, activeHash, inactiveHash };
}

test('usuário ativo + senha correta autentica com sucesso e gera cookie de sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { activePassword } = await setupUsers(db);

  const res = await postLogin(db, { username: 'admin_ativo', senha: activePassword });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.usuario.username, 'admin_ativo');
  assert.equal(body.usuario.id, 10);

  const cookie = res.headers.get('Set-Cookie');
  assert.ok(cookie);
  assert.match(cookie, /rp_admin_session=/);

  const sessoes = await db
    .prepare('SELECT COUNT(*) as total FROM admin_sessoes WHERE usuario_id = 10')
    .first();
  assert.equal(sessoes.total, 1);
});

test('usuário ativo + senha errada retorna 401 com erro genérico e não cria sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  await setupUsers(db);

  const res = await postLogin(db, { username: 'admin_ativo', senha: 'senha-errada' });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.deepEqual(body, { error: 'Usuário ou senha incorretos' });

  const sessoes = await db
    .prepare('SELECT COUNT(*) as total FROM admin_sessoes')
    .first();
  assert.equal(sessoes.total, 0);
});

test('usuário inexistente retorna exatamente o mesmo 401 genérico e não cria sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  await setupUsers(db);

  const res = await postLogin(db, { username: 'nao_existe_mesmo', senha: 'qualquer-senha' });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.deepEqual(body, { error: 'Usuário ou senha incorretos' });

  const sessoes = await db
    .prepare('SELECT COUNT(*) as total FROM admin_sessoes')
    .first();
  assert.equal(sessoes.total, 0);
});

test('usuário inativo retorna exatamente o mesmo 401 genérico e não cria sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { inactivePassword } = await setupUsers(db);

  const res = await postLogin(db, { username: 'admin_inativo', senha: inactivePassword });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.deepEqual(body, { error: 'Usuário ou senha incorretos' });

  const sessoes = await db
    .prepare('SELECT COUNT(*) as total FROM admin_sessoes WHERE usuario_id = 11')
    .first();
  assert.equal(sessoes.total, 0);
});

test('rate limit bloqueia tentativas repetidas com 429', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  await setupUsers(db);

  const ip = '10.0.0.99';
  const username = 'admin_ativo';

  // 5 falhas consecutivas
  for (let i = 0; i < 5; i++) {
    const res = await postLogin(db, { username, senha: `errada-${i}` }, { ip });
    assert.equal(res.status, 401);
  }

  // 6ª tentativa deve ser bloqueada pelo rate limit
  const blockedRes = await postLogin(db, { username, senha: 'qualquer' }, { ip });
  assert.equal(blockedRes.status, 429);
  assert.ok(blockedRes.headers.get('retry-after'));
  const body = await blockedRes.json();
  assert.match(body.error, /Muitas tentativas/);
});

test('regressão: usuário inexistente e inativo executam derivação PBKDF2 dummy com parâmetros equivalentes', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { inactivePassword } = await setupUsers(db);

  const calls = [];
  const originalDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);

  t.mock.method(crypto.subtle, 'deriveBits', async (algorithm, key, length) => {
    if (algorithm && algorithm.name === 'PBKDF2') {
      const saltHex = [...new Uint8Array(algorithm.salt)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      calls.push({
        algorithm: algorithm.name,
        hash: algorithm.hash,
        iterations: algorithm.iterations,
        saltHex,
        length,
      });
    }
    return originalDeriveBits(algorithm, key, length);
  });

  // 1. Inexistente: deve executar deriveBits exatamente 1 vez com 100.000 iterações no salt dummy
  calls.length = 0;
  const resInexistente = await postLogin(db, { username: 'desconhecido', senha: 'senha-teste-123' }, { ip: '1.1.1.1' });
  assert.equal(resInexistente.status, 401);
  assert.equal(calls.length, 1, 'usuário inexistente deve executar exatamente 1 deriveBits PBKDF2');
  assert.equal(calls[0].algorithm, 'PBKDF2');
  assert.equal(calls[0].hash, 'SHA-256');
  assert.equal(calls[0].iterations, 100000);
  assert.equal(calls[0].saltHex, 'e5b19327f233004815af503c254fe388', 'deve usar o salt dummy fixo');

  // 2. Inativo: deve executar deriveBits exatamente 1 vez com 100.000 iterações no salt dummy
  calls.length = 0;
  const resInativo = await postLogin(db, { username: 'admin_inativo', senha: inactivePassword }, { ip: '1.1.1.2' });
  assert.equal(resInativo.status, 401);
  assert.equal(calls.length, 1, 'usuário inativo deve executar exatamente 1 deriveBits PBKDF2');
  assert.equal(calls[0].algorithm, 'PBKDF2');
  assert.equal(calls[0].hash, 'SHA-256');
  assert.equal(calls[0].iterations, 100000);
  assert.equal(calls[0].saltHex, 'e5b19327f233004815af503c254fe388', 'deve usar o salt dummy fixo');

  // 3. Ativo com senha errada: deve executar deriveBits exatamente 1 vez com 100.000 iterações no salt real do usuário
  calls.length = 0;
  const resAtivoErrado = await postLogin(db, { username: 'admin_ativo', senha: 'senha-errada' }, { ip: '1.1.1.3' });
  assert.equal(resAtivoErrado.status, 401);
  assert.equal(calls.length, 1, 'usuário ativo com senha errada deve executar exatamente 1 deriveBits PBKDF2');
  assert.equal(calls[0].algorithm, 'PBKDF2');
  assert.equal(calls[0].hash, 'SHA-256');
  assert.equal(calls[0].iterations, 100000);
  assert.notEqual(calls[0].saltHex, 'e5b19327f233004815af503c254fe388', 'usuário ativo usa seu próprio salt');

  // 4. Rate-limited não executa PBKDF2
  calls.length = 0;
  const ipBlocked = '1.1.1.4';
  for (let i = 0; i < 5; i++) {
    await postLogin(db, { username: 'admin_ativo', senha: 'errada' }, { ip: ipBlocked });
  }
  calls.length = 0;
  const resBlocked = await postLogin(db, { username: 'admin_ativo', senha: 'qualquer' }, { ip: ipBlocked });
  assert.equal(resBlocked.status, 429);
  assert.equal(calls.length, 0, 'requisição bloqueada por rate limit não deve executar deriveBits');
});

test('código de login define constante estática de hash dummy com 100.000 iterações PBKDF2', async () => {
  const loginSrc = await readFile(new URL('../functions/api/auth/login.ts', import.meta.url), 'utf8');

  assert.match(
    loginSrc,
    /const DUMMY_PASSWORD_HASH =\s*"pbkdf2_sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}";/,
    'DUMMY_PASSWORD_HASH deve ser uma constante estática válida com pbkdf2_sha256, 100.000 iterações e salt/hash hex',
  );
  assert.doesNotMatch(loginSrc, /hashPassword\(/, 'não deve gerar hash em runtime por requisição');
  assert.match(
    loginSrc,
    /const hashParaVerificar =\s*user && user\.ativo\s*\?\s*user\.senha_hash\s*:\s*DUMMY_PASSWORD_HASH;/,
    'deve selecionar o hash dummy fixo quando usuário não existe ou está inativo',
  );
});
