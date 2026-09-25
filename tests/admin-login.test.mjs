import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app, fixture, barrier } from './helpers/b3.mjs';

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

/* ───────────── M5: registro de falha atômico no rate limit do login ───────────── */

const ESCRITA_RATE_LIMIT = 'INSERT INTO auth_rate_limits';
const linhaRateLimit = (db, chave) =>
  db.prepare('SELECT falhas, janela_inicio, bloqueado_ate FROM auth_rate_limits WHERE chave = ?').bind(chave).first();

// Força N escritas de falha a estarem em voo ao mesmo tempo: cada uma para no
// hook do D1 até todas chegarem ao ponto de escrita, e só então seguem juntas.
function segurarEscritasAte(db, n) {
  const gate = barrier(n);
  let chegaram = 0;
  db.hook = async (statements, op) => {
    if (op === 'run' && statements.some(s => s.sql.includes(ESCRITA_RATE_LIMIT))) {
      chegaram++;
      await gate();
    }
    return statements;
  };
  return () => chegaram;
}

test('M5: recordLoginFailure não perde incrementos concorrentes (N = 6)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const chave = 'm5-chave-concorrente';
  const N = 6;
  const chegaram = segurarEscritasAte(db, N);
  await Promise.all(Array.from({ length: N }, () => app.rateLimit.recordLoginFailure(db, chave)));
  db.hook = null;
  assert.equal(chegaram(), N, 'as N escritas estavam em voo simultaneamente');
  const linha = await linhaRateLimit(db, chave);
  assert.equal(linha.falhas, N, 'nenhuma falha concorrente foi perdida');
  assert.ok(linha.bloqueado_ate, 'bloqueio definido ao atingir o limite');
  assert.ok(Date.parse(linha.bloqueado_ate) > Date.now());
});

test('M5: recordLoginFailure decide tudo numa única escrita, sem SELECT prévio', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const operacoes = [];
  db.hook = async (statements, op) => {
    for (const s of statements) operacoes.push([op, s.sql.trim().split(/\s+/)[0].toUpperCase()]);
    return statements;
  };
  await app.rateLimit.recordLoginFailure(db, 'm5-uma-escrita');
  db.hook = null;
  assert.ok(!operacoes.some(o => o[1] === 'SELECT'), 'sem SELECT prévio');
  assert.deepEqual(operacoes.filter(o => o[1] !== 'DELETE'), [['run', 'INSERT']]);
});

test('M5: falhas concorrentes pela rota de login não se perdem e a próxima tentativa recebe 429', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  await setupUsers(db);
  const N = 6;
  const chegaram = segurarEscritasAte(db, N);
  const respostas = await Promise.all(Array.from({ length: N }, () =>
    postLogin(db, { username: 'admin_ativo', senha: 'senha-errada' })));
  db.hook = null;
  assert.equal(chegaram(), N);
  assert.deepEqual(respostas.map(r => r.status), Array(N).fill(401),
    'todas já tinham passado pelo check antes do bloqueio existir');

  const { results } = await db.prepare('SELECT falhas, bloqueado_ate FROM auth_rate_limits').all();
  assert.equal(results.length, 1, 'uma única chave IP|username');
  assert.equal(results[0].falhas, N);
  assert.ok(results[0].bloqueado_ate);

  const proxima = await postLogin(db, { username: 'admin_ativo', senha: 'senha-errada' });
  assert.equal(proxima.status, 429);
  assert.ok(Number(proxima.headers.get('retry-after')) > 0);
});

test('M5: falha depois de janela vencida reinicia a contagem em 1, sem bloqueio', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const chave = 'm5-janela-vencida';
  const antiga = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate)
    VALUES (?, 4, ?, NULL)`).bind(chave, antiga).run();
  const antes = Date.now();
  await app.rateLimit.recordLoginFailure(db, chave);
  const linha = await linhaRateLimit(db, chave);
  assert.equal(linha.falhas, 1);
  assert.equal(linha.bloqueado_ate, null);
  assert.ok(Date.parse(linha.janela_inicio) >= antes - 1000, 'janela reiniciada agora');
});

test('M5: quarta falha na janela vira quinta e bloqueia na mesma escrita', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const chave = 'm5-limiar';
  const inicio = new Date(Date.now() - 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate)
    VALUES (?, 4, ?, NULL)`).bind(chave, inicio).run();
  await app.rateLimit.recordLoginFailure(db, chave);
  const linha = await linhaRateLimit(db, chave);
  assert.equal(linha.falhas, 5);
  assert.equal(linha.janela_inicio, inicio, 'janela preservada');
  assert.ok(linha.bloqueado_ate);
  const restante = Date.parse(linha.bloqueado_ate) - Date.now();
  assert.ok(restante > 14 * 60 * 1000 && restante <= 15 * 60 * 1000, 'bloqueio de 15 minutos');
});

test('M5: login válido depois de falhas remove a chave IP|username', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { activePassword } = await setupUsers(db);
  for (let i = 0; i < 2; i++) {
    assert.equal((await postLogin(db, { username: 'admin_ativo', senha: 'senha-errada' })).status, 401);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM auth_rate_limits').first()).n, 1);
  assert.equal((await postLogin(db, { username: 'admin_ativo', senha: activePassword })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM auth_rate_limits').first()).n, 0);
});

/* ───────────── Higiene Operacional: cleanupStaleLoginRateLimits ───────────── */

test('cleanupStaleLoginRateLimits: remove linha stale sem bloqueio (> 24h)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;
  const staleTime = new Date(nowMs - 25 * 3600 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('stale-1', 2, ?, NULL, ?)
  `).bind(staleTime, staleTime).run();

  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 1);

  const row = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('stale-1').first();
  assert.equal(row, null);
});

test('cleanupStaleLoginRateLimits: preserva linha recente sem bloqueio (< 24h)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;
  const recentTime = new Date(nowMs - 1 * 3600 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('recente-1', 2, ?, NULL, ?)
  `).bind(recentTime, recentTime).run();

  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 0);

  const row = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('recente-1').first();
  assert.ok(row);
});

test('cleanupStaleLoginRateLimits: preserva linha stale se bloqueio ainda estiver vigente no futuro', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;
  const staleTime = new Date(nowMs - 25 * 3600 * 1000).toISOString();
  const futureBlockedUntil = new Date(nowMs + 10 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('stale-bloqueado-futuro', 5, ?, ?, ?)
  `).bind(staleTime, futureBlockedUntil, staleTime).run();

  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 0);

  const row = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('stale-bloqueado-futuro').first();
  assert.ok(row, 'Linha com bloqueio futuro não pode ser removida');
});

test('cleanupStaleLoginRateLimits: remove linha stale com bloqueio expirado', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;
  const staleTime = new Date(nowMs - 25 * 3600 * 1000).toISOString();
  const pastBlockedUntil = new Date(nowMs - 20 * 3600 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('stale-bloqueado-passado', 5, ?, ?, ?)
  `).bind(staleTime, pastBlockedUntil, staleTime).run();

  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 1);

  const row = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('stale-bloqueado-passado').first();
  assert.equal(row, null);
});

test('cleanupStaleLoginRateLimits: respeita limite exato/conservador de 24 horas', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;
  const quase24h = new Date(nowMs - (24 * 3600 * 1000 - 60000)).toISOString(); // 23h59m
  const maisDe24h = new Date(nowMs - (24 * 3600 * 1000 + 60000)).toISOString(); // 24h01m

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('quase-24h', 1, ?, NULL, ?)
  `).bind(quase24h, quase24h).run();

  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('mais-de-24h', 1, ?, NULL, ?)
  `).bind(maisDe24h, maisDe24h).run();

  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 1);

  const rowPreservada = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('quase-24h').first();
  assert.ok(rowPreservada, 'Linha abaixo de 24h deve ser preservada');

  const rowRemovida = await db.prepare('SELECT * FROM auth_rate_limits WHERE chave = ?').bind('mais-de-24h').first();
  assert.equal(rowRemovida, null, 'Linha acima de 24h deve ser removida');
});

test('cleanupStaleLoginRateLimits: prova de isolamento (não altera falhas recentes, bloqueios ativos nem chaves recém-gravadas)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const nowMs = 1750000000000;

  // 1. Linha com 3 falhas recentes
  const recentTime = new Date(nowMs - 2 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('recente-falhas', 3, ?, NULL, ?)
  `).bind(recentTime, recentTime).run();

  // 2. Linha com 5 falhas e bloqueio ativo
  const blockedUntil = new Date(nowMs + 10 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('bloqueio-ativo', 5, ?, ?, ?)
  `).bind(recentTime, blockedUntil, recentTime).run();

  // 3. Linha stale (> 24h)
  const staleTime = new Date(nowMs - 30 * 3600 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES ('stale-lixo', 1, ?, NULL, ?)
  `).bind(staleTime, staleTime).run();

  // Executa o cleanup
  const changes = await app.rateLimit.cleanupStaleLoginRateLimits(db, nowMs);
  assert.equal(changes, 1);

  // Verifica que linha com falhas recentes manteve contagem intacta
  const rowFalhas = await db.prepare('SELECT falhas, bloqueado_ate FROM auth_rate_limits WHERE chave = ?').bind('recente-falhas').first();
  assert.equal(rowFalhas.falhas, 3);
  assert.equal(rowFalhas.bloqueado_ate, null);

  // Verifica que linha bloqueada manteve bloqueio intacto
  const rowBloqueada = await db.prepare('SELECT falhas, bloqueado_ate FROM auth_rate_limits WHERE chave = ?').bind('bloqueio-ativo').first();
  assert.equal(rowBloqueada.falhas, 5);
  assert.equal(rowBloqueada.bloqueado_ate, blockedUntil);

  // Nova chave gravada por recordLoginFailure permanece no banco
  await app.rateLimit.recordLoginFailure(db, 'nova-chave-falha');
  const rowNova = await db.prepare('SELECT falhas FROM auth_rate_limits WHERE chave = ?').bind('nova-chave-falha').first();
  assert.equal(rowNova.falhas, 1);
});

test('cleanupStaleLoginRateLimits: falha no cleanup (best-effort) não quebra recordLoginFailure', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  db.hook = async (statements) => {
    if (statements.some(s => s.sql.includes('DELETE FROM auth_rate_limits WHERE julianday'))) {
      throw new Error('Erro simulado no cleanup');
    }
    return statements;
  };

  await assert.doesNotReject(async () => {
    for (let i = 0; i < 50; i++) {
      await app.rateLimit.recordLoginFailure(db, `chave-resiliente-${i}`);
    }
  });

  db.hook = null;
});

