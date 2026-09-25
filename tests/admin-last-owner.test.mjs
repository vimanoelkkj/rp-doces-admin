import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, barrier } from './helpers/b3.mjs';

function cookieDe(session) {
  return session.cookie.split(';')[0];
}

function putAdmin(db, session, id, body) {
  return app.adminAdministradoresId.onRequest({
    env: { DB: db },
    params: { id: String(id) },
    request: new Request(`https://local.test/api/admin/administradores/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://local.test',
        ...(session ? { Cookie: cookieDe(session) } : {}),
      },
      body: JSON.stringify(body),
    }),
  });
}

async function setupTwoOwners(db) {
  const hash = await app.auth.hashPassword('senha-owner-b');
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(2, 'Owner B', 'owner_b', 'owner_b@local.test', ?, 'OWNER', 1)`
    )
    .bind(hash)
    .run();

  const sessionA = await app.auth.createSession(db, 1);
  const sessionB = await app.auth.createSession(db, 2);
  return { sessionA, sessionB };
}

/* ──────────────────────────────────────────────────────────────────────────
 * 1. PROVA DIRETA DO BANCO (Triggers BEFORE UPDATE e BEFORE DELETE)
 * ────────────────────────────────────────────────────────────────────────── */

test('banco direto: trigger impede desativar o único OWNER ativo', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });

  // Fixture inicializa apenas usuário 1 como OWNER ativo
  await assert.rejects(
    async () => {
      await db.prepare('UPDATE usuarios_admin SET ativo = 0 WHERE id = 1').run();
    },
    /ultimo_owner_ativo/
  );

  const row = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 1').first();
  assert.equal(row.papel, 'OWNER');
  assert.equal(row.ativo, 1);
});

test('banco direto: trigger impede rebaixar para ADMIN o único OWNER ativo', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });

  await assert.rejects(
    async () => {
      await db.prepare("UPDATE usuarios_admin SET papel = 'ADMIN' WHERE id = 1").run();
    },
    /ultimo_owner_ativo/
  );

  const row = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 1').first();
  assert.equal(row.papel, 'OWNER');
  assert.equal(row.ativo, 1);
});

test('banco direto: trigger impede deletar o único OWNER ativo', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });

  await assert.rejects(
    async () => {
      await db.prepare('DELETE FROM usuarios_admin WHERE id = 1').run();
    },
    /ultimo_owner_ativo/
  );

  const row = await db.prepare('SELECT id FROM usuarios_admin WHERE id = 1').first();
  assert.ok(row);
});

test('banco direto: trigger permite atualizar OWNER ativo para OWNER ativo', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });

  await db
    .prepare("UPDATE usuarios_admin SET papel = 'OWNER', ativo = 1 WHERE id = 1")
    .run();

  const row = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 1').first();
  assert.equal(row.papel, 'OWNER');
  assert.equal(row.ativo, 1);
});

test('banco direto: com 2 OWNERs, desativar, rebaixar ou deletar um deles funciona', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  await setupTwoOwners(db);

  // Desativar usuário 2 funciona porque usuário 1 continua OWNER ativo
  await db.prepare('UPDATE usuarios_admin SET ativo = 0 WHERE id = 2').run();
  let row2 = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 2').first();
  assert.equal(row2.ativo, 0);

  // Mas agora usuário 1 é o único OWNER ativo: tentar desativá-lo deve falhar
  await assert.rejects(
    async () => {
      await db.prepare('UPDATE usuarios_admin SET ativo = 0 WHERE id = 1').run();
    },
    /ultimo_owner_ativo/
  );

  // Reativar usuário 2
  await db.prepare('UPDATE usuarios_admin SET ativo = 1 WHERE id = 2').run();

  // Rebaixar usuário 2 para ADMIN funciona porque usuário 1 continua OWNER ativo
  await db.prepare("UPDATE usuarios_admin SET papel = 'ADMIN' WHERE id = 2").run();
  row2 = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 2').first();
  assert.equal(row2.papel, 'ADMIN');

  // Deletar usuário 2 (ADMIN) funciona normalmente
  await db.prepare('DELETE FROM usuarios_admin WHERE id = 2').run();
  row2 = await db.prepare('SELECT id FROM usuarios_admin WHERE id = 2').first();
  assert.equal(row2, null);
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. CASOS NORMAIS DA API
 * ────────────────────────────────────────────────────────────────────────── */

test('api: último OWNER não pode ser desativado', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA } = await setupTwoOwners(db);

  // 1. Auto-desativação do único OWNER ativo é bloqueada com 403
  const resSelf = await putAdmin(db, sessionA, 1, { acao: 'toggle_ativo', ativo: false });
  assert.equal(resSelf.status, 403);
  const jsonSelf = await resSelf.json();
  assert.equal(jsonSelf.error, 'Você não pode alterar o estado da sua própria conta');

  // 2. Quando o alvo é OWNER mas só resta 1 OWNER ativo, o fast-path retorna 409
  // Usuário 2 já é desativado no banco:
  await db.prepare('UPDATE usuarios_admin SET ativo = 0 WHERE id = 2').run();
  const resFastPath = await putAdmin(db, sessionA, 2, { acao: 'toggle_ativo', ativo: false });
  assert.equal(resFastPath.status, 409);
  const jsonFastPath = await resFastPath.json();
  assert.equal(jsonFastPath.error, 'A loja precisa manter pelo menos um administrador mestre ativo');

  // 3. Quando o trigger do banco aborta (simulando que o fast-path passou mas o banco barrou),
  // a API captura ultimo_owner_ativo e retorna 409
  await db.prepare('UPDATE usuarios_admin SET ativo = 1 WHERE id = 2').run();
  // Forçamos o trigger a agir simulando a chamada de update direto ou erro do banco
  db.hook = async (wire) => {
    // Se for o UPDATE, forçamos o erro do trigger
    if (wire.some(s => s.sql.includes('UPDATE usuarios_admin SET ativo = ?'))) {
      throw new Error('D1_ERROR: ultimo_owner_ativo');
    }
    return wire;
  };
  const resTrigger = await putAdmin(db, sessionA, 2, { acao: 'toggle_ativo', ativo: false });
  db.hook = null;
  assert.equal(resTrigger.status, 409);
  const jsonTrigger = await resTrigger.json();
  assert.equal(jsonTrigger.error, 'A loja precisa manter pelo menos um administrador mestre ativo');
});

test('api: último OWNER não pode virar ADMIN', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA } = await setupTwoOwners(db);

  // 1. Auto-rebaixamento é bloqueado com 403
  const resSelf = await putAdmin(db, sessionA, 1, { acao: 'alterar_papel', papel: 'ADMIN' });
  assert.equal(resSelf.status, 403);
  const jsonSelf = await resSelf.json();
  assert.equal(jsonSelf.error, 'Altere o nível da sua própria conta somente por outro administrador mestre');

  // 2. Fast-path de alterar_papel: se COUNT(*) de OWNERs ativos for <= 1
  db.hook = async (wire) => {
    if (wire.some(s => s.sql.includes("SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER'"))) {
      return wire.map(s => s.sql.includes("SELECT COUNT(*) AS total") ? { sql: 'SELECT 1 AS total', args: [] } : s);
    }
    return wire;
  };
  const resFastPath = await putAdmin(db, sessionA, 2, { acao: 'alterar_papel', papel: 'ADMIN' });
  db.hook = null;
  assert.equal(resFastPath.status, 409);
  const jsonFastPath = await resFastPath.json();
  assert.equal(jsonFastPath.error, 'A loja precisa manter pelo menos um administrador mestre ativo');

  // 3. Quando o trigger do banco aborta em alterar_papel, a API captura ultimo_owner_ativo e retorna 409
  db.hook = async (wire) => {
    if (wire.some(s => s.sql.includes('UPDATE usuarios_admin SET papel = ?'))) {
      throw new Error('D1_ERROR: ultimo_owner_ativo');
    }
    return wire;
  };
  const resTrigger = await putAdmin(db, sessionA, 2, { acao: 'alterar_papel', papel: 'ADMIN' });
  db.hook = null;
  assert.equal(resTrigger.status, 409);
  const jsonTrigger = await resTrigger.json();
  assert.equal(jsonTrigger.error, 'A loja precisa manter pelo menos um administrador mestre ativo');
});

test('api: com dois OWNERs, desativar um normalmente funciona e remove a sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA, sessionB } = await setupTwoOwners(db);

  const res = await putAdmin(db, sessionA, 2, { acao: 'toggle_ativo', ativo: false });
  assert.equal(res.status, 200);

  const userB = await db.prepare('SELECT ativo FROM usuarios_admin WHERE id = 2').first();
  assert.equal(userB.ativo, 0);

  const sessionsB = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = 2').first();
  assert.equal(sessionsB.total, 0);

  const sessionsA = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = 1').first();
  assert.equal(sessionsA.total, 1);
});

test('api: com dois OWNERs, rebaixar um normalmente funciona e remove a sessão', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA, sessionB } = await setupTwoOwners(db);

  const res = await putAdmin(db, sessionA, 2, { acao: 'alterar_papel', papel: 'ADMIN' });
  assert.equal(res.status, 200);

  const userB = await db.prepare('SELECT papel FROM usuarios_admin WHERE id = 2').first();
  assert.equal(userB.papel, 'ADMIN');

  const sessionsB = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = 2').first();
  assert.equal(sessionsB.total, 0);
});

test('api: ADMIN pode ser ativado e desativado normalmente', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const hash = await app.auth.hashPassword('senha-admin');
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(5, 'Admin Cinco', 'admin_5', 'admin5@local.test', ?, 'ADMIN', 1)`
    )
    .bind(hash)
    .run();

  const sessionOwner = await app.auth.createSession(db, 1);

  // Desativar ADMIN
  let res = await putAdmin(db, sessionOwner, 5, { acao: 'toggle_ativo', ativo: false });
  assert.equal(res.status, 200);
  let adminRow = await db.prepare('SELECT ativo FROM usuarios_admin WHERE id = 5').first();
  assert.equal(adminRow.ativo, 0);

  // Reativar ADMIN
  res = await putAdmin(db, sessionOwner, 5, { acao: 'toggle_ativo', ativo: true });
  assert.equal(res.status, 200);
  adminRow = await db.prepare('SELECT ativo FROM usuarios_admin WHERE id = 5').first();
  assert.equal(adminRow.ativo, 1);
});

test('api: ADMIN -> OWNER funciona', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const hash = await app.auth.hashPassword('senha-admin');
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id, nome, username, email, senha_hash, papel, ativo)
       VALUES(6, 'Admin Seis', 'admin_6', 'admin6@local.test', ?, 'ADMIN', 1)`
    )
    .bind(hash)
    .run();

  const sessionOwner = await app.auth.createSession(db, 1);
  const res = await putAdmin(db, sessionOwner, 6, { acao: 'alterar_papel', papel: 'OWNER' });
  assert.equal(res.status, 200);

  const row = await db.prepare('SELECT papel FROM usuarios_admin WHERE id = 6').first();
  assert.equal(row.papel, 'OWNER');
});

test('api: OWNER ativo -> OWNER ativo não é bloqueado', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA } = await setupTwoOwners(db);

  // Altera papel de B (que já é OWNER) para OWNER:
  const res = await putAdmin(db, sessionA, 2, { acao: 'alterar_papel', papel: 'OWNER' });
  assert.equal(res.status, 200);

  const row = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = 2').first();
  assert.equal(row.papel, 'OWNER');
  assert.equal(row.ativo, 1);
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. CORRIDA DETERMINÍSTICA: DESATIVAR VS DESATIVAR (toggle_ativo)
 * ────────────────────────────────────────────────────────────────────────── */

test('corrida determinística: A desativa B enquanto B desativa A (toggle_ativo)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA, sessionB } = await setupTwoOwners(db);

  // Interleaving forçada: ambas as requisições devem ler COUNT(*) = 2
  // antes de qualquer uma executar UPDATE.
  // Usamos um barrier(2) interceptando as chamadas que tentam UPDATE usuarios_admin.
  const syncBarrier = barrier(2);

  db.hook = async (wire, operation) => {
    const isUpdate = wire.some(s => s.sql.includes('UPDATE usuarios_admin'));
    if (isUpdate) {
      await syncBarrier();
    }
    return wire;
  };

  // Dispara concorrentemente:
  // A tenta desativar B
  // B tenta desativar A
  const [resA, resB] = await Promise.all([
    putAdmin(db, sessionA, 2, { acao: 'toggle_ativo', ativo: false }),
    putAdmin(db, sessionB, 1, { acao: 'toggle_ativo', ativo: false }),
  ]);

  db.hook = null;

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exatamente uma operação deve vencer (200) e a outra ser recusada (409)');

  const loserRes = resA.status === 409 ? resA : resB;
  const winnerRes = resA.status === 200 ? resA : resB;
  const loserBody = await loserRes.json();
  assert.equal(loserBody.error, 'A loja precisa manter pelo menos um administrador mestre ativo');

  // Invariante no banco: SEMPRE exatamente 1 OWNER ativo, NUNCA 0!
  const activeOwners = await db.prepare(
    "SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER' AND ativo = 1"
  ).first();
  assert.equal(activeOwners.total, 1, 'Invariante: exatamente 1 OWNER ativo deve restar no banco');

  // Identifica quem ganhou e quem perdeu:
  const loserTargetId = resA.status === 409 ? 2 : 1; // Quem a request perdedora tentou desativar
  const loserCallerId = resA.status === 409 ? 1 : 2; // Quem fez a request perdedora
  const winnerCallerId = resA.status === 200 ? 1 : 2; // Quem fez a request vencedora
  const winnerTargetId = resA.status === 200 ? 2 : 1; // Quem foi desativado com sucesso

  // A conta desativada (winnerTargetId) deve estar inativo e sua sessão excluída:
  const deactivatedUser = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = ?').bind(winnerTargetId).first();
  assert.equal(deactivatedUser.ativo, 0);

  const deactivatedSessions = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = ?').bind(winnerTargetId).first();
  assert.equal(deactivatedSessions.total, 0, 'Sessão do usuário desativado deve ter sido removida');

  // A conta que NÃO foi desativada (loserTargetId = winnerCallerId) deve continuar ativa e com sessão válida:
  const activeUser = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = ?').bind(winnerCallerId).first();
  assert.equal(activeUser.papel, 'OWNER');
  assert.equal(activeUser.ativo, 1);

  const activeSessions = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = ?').bind(winnerCallerId).first();
  assert.equal(activeSessions.total, 1, 'Sessão do usuário que permaneceu ativo NÃO pode ser apagada');
});

/* ──────────────────────────────────────────────────────────────────────────
 * 4. CORRIDA DETERMINÍSTICA: REBAIXAR VS REBAIXAR (alterar_papel)
 * ────────────────────────────────────────────────────────────────────────── */

test('corrida determinística: A rebaixa B enquanto B rebaixa A (alterar_papel)', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA, sessionB } = await setupTwoOwners(db);

  // Ambas as requisições leem COUNT(*) = 2 antes de qualquer batch ser executado
  const syncBarrier = barrier(2);

  db.hook = async (wire, operation) => {
    const isUpdate = wire.some(s => s.sql.includes('UPDATE usuarios_admin'));
    if (isUpdate) {
      await syncBarrier();
    }
    return wire;
  };

  const [resA, resB] = await Promise.all([
    putAdmin(db, sessionA, 2, { acao: 'alterar_papel', papel: 'ADMIN' }),
    putAdmin(db, sessionB, 1, { acao: 'alterar_papel', papel: 'ADMIN' }),
  ]);

  db.hook = null;

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exatamente um rebaixamento deve vencer (200) e o outro falhar com 409');

  const loserRes = resA.status === 409 ? resA : resB;
  const loserBody = await loserRes.json();
  assert.equal(loserBody.error, 'A loja precisa manter pelo menos um administrador mestre ativo');

  // Invariante: exatamente 1 OWNER ativo, nunca 0
  const activeOwners = await db.prepare(
    "SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER' AND ativo = 1"
  ).first();
  assert.equal(activeOwners.total, 1);

  // Quem perdeu a corrida não teve o papel alterado pelo seu UPDATE que falhou,
  // e o batch inteiro fez rollback, preservando sessões da conta que não foi rebaixada.
  const winnerCallerId = resA.status === 200 ? 1 : 2;
  const loserCallerId = resA.status === 409 ? 1 : 2;
  const demotedUserId = resA.status === 200 ? 2 : 1;

  const demotedUser = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = ?').bind(demotedUserId).first();
  assert.equal(demotedUser.papel, 'ADMIN');

  const demotedSessions = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = ?').bind(demotedUserId).first();
  assert.equal(demotedSessions.total, 0, 'Sessão do rebaixado deve ter sido removida');

  const remainingOwner = await db.prepare('SELECT papel, ativo FROM usuarios_admin WHERE id = ?').bind(winnerCallerId).first();
  assert.equal(remainingOwner.papel, 'OWNER');
  assert.equal(remainingOwner.ativo, 1);

  const remainingSessions = await db.prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = ?').bind(winnerCallerId).first();
  assert.equal(remainingSessions.total, 1, 'Sessão do OWNER restante deve ser preservada intacta');
});

/* ──────────────────────────────────────────────────────────────────────────
 * 5. CORRIDA DETERMINÍSTICA: MISTO (A desativa B vs B rebaixa A)
 * ────────────────────────────────────────────────────────────────────────── */

test('corrida determinística misto: A desativa B enquanto B rebaixa A para ADMIN', async t => {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const { sessionA, sessionB } = await setupTwoOwners(db);

  const syncBarrier = barrier(2);

  db.hook = async (wire, operation) => {
    const isUpdate = wire.some(s => s.sql.includes('UPDATE usuarios_admin'));
    if (isUpdate) {
      await syncBarrier();
    }
    return wire;
  };

  const [resA, resB] = await Promise.all([
    putAdmin(db, sessionA, 2, { acao: 'toggle_ativo', ativo: false }),
    putAdmin(db, sessionB, 1, { acao: 'alterar_papel', papel: 'ADMIN' }),
  ]);

  db.hook = null;

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exatamente uma operação vence e a outra recebe 409');

  const activeOwners = await db.prepare(
    "SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER' AND ativo = 1"
  ).first();
  assert.equal(activeOwners.total, 1, 'Invariante: count final de OWNER ativo deve ser 1');
});
