import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { app, fixture } from './helpers/b3.mjs';

// Setup DOM para os testes de UI do modal
const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
for (const name of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'Node',
  'Event',
  'MouseEvent',
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

// Bundle dos componentes UI
const uiBundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import AlterarSenhaModal from './src/admin/Administradores/AlterarSenhaModal';
      import AdminAdministradores from './src/admin/Administradores/AdminAdministradores';
      import {AdminAuthProvider} from './src/admin/auth/AdminAuthContext';
      export {act} from 'react';

      export function mount(container, props) {
        const root = createRoot(container);
        root.render(<AlterarSenhaModal {...props} />);
        return root;
      }

      export function mountAdminAdministradores(container, user, logout) {
        const root = createRoot(container);
        root.render(
          <AdminAuthProvider user={user} logout={logout}>
            <AdminAdministradores />
          </AdminAuthProvider>
        );
        return root;
      }
    `,
  },
  bundle: true,
  write: false,
  format: 'esm',
  loader: { '.css': 'empty' },
});

const ui = await import(
  `data:text/javascript;base64,${Buffer.from(uiBundle.outputFiles[0].text).toString('base64')}`
);

const flush = () => ui.act(async () => { await new Promise(setImmediate); });

function changeValue(element, value) {
  const prototype = dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function mountModal(props) {
  const container = dom.window.document.getElementById('root');
  dom.window.document.querySelectorAll('.nadm-overlay').forEach((el) => el.remove());
  container.innerHTML = '';
  return ui.mount(container, props);
}

const cookieDe = (session) => session.cookie.split(';')[0];

async function bancada(t) {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const ownerHash = await app.auth.hashPassword('senha-owner-123');
  await db
    .prepare('UPDATE usuarios_admin SET senha_hash = ? WHERE id = 1')
    .bind(ownerHash)
    .run();

  const adminHash = await app.auth.hashPassword('senha-admin-123');
  await db
    .prepare(
      `INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
       VALUES(2,'Admin Teste','admintest','admin@example.invalid',?,'ADMIN')`
    )
    .bind(adminHash)
    .run();

  const ownerSession = await app.auth.createSession(db, 1);
  const adminSession = await app.auth.createSession(db, 2);
  return { db, ownerSession, adminSession, ownerHash, adminHash };
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

/* ────────────────────────── Backend tests ────────────────────────── */

test('usuário troca a própria senha com senhaAtual correta → sucesso', async (t) => {
  const { db, adminSession } = await bancada(t);
  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  assert.ok(row?.senha_hash);
  const novaValida = await app.auth.verifyPassword(
    'nova-senha-admin-456',
    row.senha_hash
  );
  assert.equal(novaValida, true);
});

test('senhaAtual ausente → rejeitado e hash permanece igual', async (t) => {
  const { db, adminSession, adminHash } = await bancada(t);
  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
  });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.error, 'Senha atual obrigatória');

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  assert.equal(row.senha_hash, adminHash);
});

test('senhaAtual incorreta → rejeitado e hash permanece igual', async (t) => {
  const { db, adminSession, adminHash } = await bancada(t);
  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-totalmente-errada',
  });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.error, 'Senha atual incorreta');

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  assert.equal(row.senha_hash, adminHash);
});

test('senha nova inválida → rejeitada e hash permanece igual', async (t) => {
  const { db, adminSession, adminHash } = await bancada(t);
  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'curta',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(response.status, 400);

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  assert.equal(row.senha_hash, adminHash);
});

test('ADMIN tentando redefinir senha de outro usuário → 403', async (t) => {
  const { db, adminSession, ownerHash } = await bancada(t);
  const response = await putAdmin(db, adminSession, 1, {
    acao: 'resetar_senha',
    senha: 'nova-senha-para-owner-456',
  });
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.equal(data.error, 'Sem permissão para redefinir esta senha');

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 1')
    .first();
  assert.equal(row.senha_hash, ownerHash);
});

test('OWNER redefinindo senha de outro usuário → continua funcionando sem senhaAtual', async (t) => {
  const { db, ownerSession } = await bancada(t);
  const response = await putAdmin(db, ownerSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-789',
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  const novaValida = await app.auth.verifyPassword(
    'nova-senha-admin-789',
    row.senha_hash
  );
  assert.equal(novaValida, true);
});

test('alteração bem-sucedida invalida as sessões da conta alterada', async (t) => {
  const { db, adminSession } = await bancada(t);
  // Criar uma segunda sessão para o usuário 2
  await app.auth.createSession(db, 2);

  const sessoesAntes = await db
    .prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = 2')
    .first();
  assert.equal(sessoesAntes.total, 2);

  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(response.status, 200);

  const sessoesDepois = await db
    .prepare('SELECT COUNT(*) AS total FROM admin_sessoes WHERE usuario_id = 2')
    .first();
  assert.equal(sessoesDepois.total, 0);

  // Tentativa de autenticação com a sessão antiga é rejeitada
  const userAposReset = await app.auth.currentUser(
    db,
    new Request('https://local.test/', {
      headers: { Cookie: cookieDe(adminSession) },
    })
  );
  assert.equal(userAposReset, null);
});

/* ────────────────────────── Rate limit tests ────────────────────────── */

test('tentativas incorretas de senhaAtual são registradas no rate limit', async (t) => {
  const { db, adminSession } = await bancada(t);
  const response = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-errada-1',
  });
  assert.equal(response.status, 400);

  const row = await db
    .prepare('SELECT falhas, bloqueado_ate FROM auth_rate_limits')
    .first();
  assert.ok(row, 'registro de falha deve existir');
  assert.equal(row.falhas, 1);
  assert.equal(row.bloqueado_ate, null);
});

test('após 5 tentativas incorretas, a próxima tentativa recebe 429 com Retry-After', async (t) => {
  const { db, adminSession } = await bancada(t);
  for (let i = 1; i <= 5; i++) {
    const res = await putAdmin(db, adminSession, 2, {
      acao: 'resetar_senha',
      senha: 'nova-senha-admin-456',
      senhaAtual: `senha-errada-${i}`,
    });
    assert.equal(res.status, 400);
  }

  // 6ª tentativa deve ser bloqueada com 429
  const blockedRes = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-errada-6',
  });
  assert.equal(blockedRes.status, 429);
  assert.ok(blockedRes.headers.get('retry-after'));
  const body = await blockedRes.json();
  assert.match(body.error, /Muitas tentativas/i);
});

test('enquanto bloqueado pelo rate limit, o hash permanece inalterado mesmo com senha correta', async (t) => {
  const { db, adminSession, adminHash } = await bancada(t);
  for (let i = 1; i <= 5; i++) {
    await putAdmin(db, adminSession, 2, {
      acao: 'resetar_senha',
      senha: 'nova-senha-admin-456',
      senhaAtual: `senha-errada-${i}`,
    });
  }

  // Tenta com a senha atual correta
  const res = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(res.status, 429);

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  assert.equal(row.senha_hash, adminHash, 'hash deve permanecer inalterado');
});

test('uma senha atual correta limpa as falhas e permite a troca', async (t) => {
  const { db, adminSession } = await bancada(t);
  // Registra 2 falhas
  await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-errada-1',
  });
  await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-errada-2',
  });

  const rowAntes = await db
    .prepare('SELECT falhas FROM auth_rate_limits')
    .first();
  assert.equal(rowAntes.falhas, 2);

  // Agora envia a senha correta
  const successRes = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(successRes.status, 200);

  const rowDepois = await db
    .prepare('SELECT COUNT(*) as total FROM auth_rate_limits')
    .first();
  assert.equal(rowDepois.total, 0, 'falhas devem ter sido limpas');
});

test('fluxo de OWNER redefinindo senha de outra conta não passa pelo rate limit de self-service', async (t) => {
  const { db, ownerSession, adminSession } = await bancada(t);
  // Bloqueia o usuário 2 via self-service com 5 falhas
  for (let i = 1; i <= 5; i++) {
    await putAdmin(db, adminSession, 2, {
      acao: 'resetar_senha',
      senha: 'nova-senha-admin-456',
      senhaAtual: `senha-errada-${i}`,
    });
  }

  // Confirma que self-service está bloqueado com 429
  const selfRes = await putAdmin(db, adminSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-admin-456',
    senhaAtual: 'senha-admin-123',
  });
  assert.equal(selfRes.status, 429);

  // OWNER redefine a senha do usuário 2 sem senhaAtual
  const ownerRes = await putAdmin(db, ownerSession, 2, {
    acao: 'resetar_senha',
    senha: 'nova-senha-pelo-owner-999',
  });
  assert.equal(ownerRes.status, 200);
  const data = await ownerRes.json();
  assert.equal(data.ok, true);

  const row = await db
    .prepare('SELECT senha_hash FROM usuarios_admin WHERE id = 2')
    .first();
  const novaValida = await app.auth.verifyPassword(
    'nova-senha-pelo-owner-999',
    row.senha_hash
  );
  assert.equal(novaValida, true);
});

/* ────────────────────────── UI tests ────────────────────────── */

test('UI da própria conta exibe campo SENHA ATUAL', async () => {
  let root;
  await ui.act(async () => {
    root = mountModal({
      adminId: 1,
      adminNome: 'Admin',
      isSelf: true,
      onClose: () => {},
      onSaved: () => {},
    });
  });
  await flush();

  const labels = Array.from(dom.window.document.querySelectorAll('label')).map(
    (l) => l.textContent?.trim()
  );
  assert.ok(labels.includes('SENHA ATUAL'));
  assert.deepEqual(labels, [
    'SENHA ATUAL',
    'NOVA SENHA',
    'CONFIRMAR NOVA SENHA',
  ]);

  await ui.act(async () => {
    root.unmount();
  });
});

test('UI para outra conta não exibe campo SENHA ATUAL', async () => {
  let root;
  await ui.act(async () => {
    root = mountModal({
      adminId: 2,
      adminNome: 'Outro Admin',
      isSelf: false,
      onClose: () => {},
      onSaved: () => {},
    });
  });
  await flush();

  const labels = Array.from(dom.window.document.querySelectorAll('label')).map(
    (l) => l.textContent?.trim()
  );
  assert.equal(labels.includes('SENHA ATUAL'), false);
  assert.deepEqual(labels, ['NOVA SENHA', 'CONFIRMAR SENHA']);

  await ui.act(async () => {
    root.unmount();
  });
});

test('payload self-service inclui senhaAtual', async (t) => {
  let capturedUrl = null;
  let capturedOptions = null;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  let root;
  await ui.act(async () => {
    root = mountModal({
      adminId: 1,
      adminNome: 'Admin',
      isSelf: true,
      onClose: () => {},
      onSaved: () => {},
    });
  });
  await flush();

  const inputs = Array.from(dom.window.document.querySelectorAll('input'));
  assert.equal(inputs.length, 3);
  await ui.act(async () => {
    changeValue(inputs[0], 'senhaAtual123');
    changeValue(inputs[1], 'novaSenha123');
    changeValue(inputs[2], 'novaSenha123');
  });
  await flush();

  const form = dom.window.document.querySelector('form');
  await ui.act(async () => {
    form.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true })
    );
  });
  await flush();

  assert.equal(capturedUrl, '/api/admin/administradores/1');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.acao, 'resetar_senha');
  assert.equal(body.senha, 'novaSenha123');
  assert.equal(body.senhaAtual, 'senhaAtual123');

  await ui.act(async () => {
    root.unmount();
  });
});

test('payload de reset administrativo não inclui senhaAtual', async (t) => {
  let capturedUrl = null;
  let capturedOptions = null;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  let root;
  await ui.act(async () => {
    root = mountModal({
      adminId: 2,
      adminNome: 'Outro Admin',
      isSelf: false,
      onClose: () => {},
      onSaved: () => {},
    });
  });
  await flush();

  const inputs = Array.from(dom.window.document.querySelectorAll('input'));
  assert.equal(inputs.length, 2);
  await ui.act(async () => {
    changeValue(inputs[0], 'novaSenha123');
    changeValue(inputs[1], 'novaSenha123');
  });
  await flush();

  const form = dom.window.document.querySelector('form');
  await ui.act(async () => {
    form.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true })
    );
  });
  await flush();

  assert.equal(capturedUrl, '/api/admin/administradores/2');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.acao, 'resetar_senha');
  assert.equal(body.senha, 'novaSenha123');
  assert.equal(body.senhaAtual, undefined);
  assert.equal('senhaAtual' in body, false);

  await ui.act(async () => {
    root.unmount();
  });
});

/* ────────────────────────── UI/logout regression tests ────────────────────────── */

test('AdminAdministradores: ao alterar a senha da própria conta, logout() é chamado', async (t) => {
  let logoutChamado = false;
  const mockLogout = () => { logoutChamado = true; };
  const mockUser = {
    id: 1,
    nome: 'Owner Teste',
    username: 'ownerteste',
    email: 'owner@example.invalid',
    papel: 'OWNER',
  };
  const mockAdmins = [
    {
      id: 1,
      nome: 'Owner Teste',
      username: 'ownerteste',
      email: 'owner@example.invalid',
      ativo: 1,
      papel: 'OWNER',
      criado_em: '2026-01-01',
    },
    {
      id: 2,
      nome: 'Admin Outro',
      username: 'adminoutro',
      email: 'admin2@example.invalid',
      ativo: 1,
      papel: 'ADMIN',
      criado_em: '2026-01-01',
    },
  ];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/admin/administradores') {
      return new Response(JSON.stringify({ administradores: mockAdmins }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/admin/administradores/1' && options?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });

  const container = dom.window.document.getElementById('root');
  dom.window.document.querySelectorAll('.nadm-overlay').forEach((el) => el.remove());
  container.innerHTML = '';

  let root;
  await ui.act(async () => {
    root = ui.mountAdminAdministradores(container, mockUser, mockLogout);
  });
  await flush();

  // Encontra os botões "Alterar senha" nos cards
  const botoes = Array.from(dom.window.document.querySelectorAll('.adm-action-btn'))
    .filter((b) => b.textContent?.trim() === 'Alterar senha');
  assert.ok(botoes.length >= 1);

  // O primeiro card é o do próprio usuário (isYou)
  await ui.act(async () => {
    botoes[0].click();
  });
  await flush();

  // Modal aberto para o próprio usuário: preenche os campos
  const inputs = Array.from(dom.window.document.querySelectorAll('.nadm-modal input'));
  assert.equal(inputs.length, 3);
  await ui.act(async () => {
    changeValue(inputs[0], 'senhaAtual123');
    changeValue(inputs[1], 'novaSenha123');
    changeValue(inputs[2], 'novaSenha123');
  });
  await flush();

  const form = dom.window.document.querySelector('.nadm-modal form');
  await ui.act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();

  assert.equal(logoutChamado, true, 'logout() deve ser chamado após alterar a própria senha');

  await ui.act(async () => {
    root.unmount();
  });
});

test('AdminAdministradores: ao redefinir a senha de outra conta, logout() NÃO é chamado e lista é atualizada', async (t) => {
  let logoutChamado = false;
  let reloads = 0;
  const mockLogout = () => { logoutChamado = true; };
  const mockUser = {
    id: 1,
    nome: 'Owner Teste',
    username: 'ownerteste',
    email: 'owner@example.invalid',
    papel: 'OWNER',
  };
  const mockAdmins = [
    {
      id: 1,
      nome: 'Owner Teste',
      username: 'ownerteste',
      email: 'owner@example.invalid',
      ativo: 1,
      papel: 'OWNER',
      criado_em: '2026-01-01',
    },
    {
      id: 2,
      nome: 'Admin Outro',
      username: 'adminoutro',
      email: 'admin2@example.invalid',
      ativo: 1,
      papel: 'ADMIN',
      criado_em: '2026-01-01',
    },
  ];

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/admin/administradores') {
      reloads++;
      return new Response(JSON.stringify({ administradores: mockAdmins }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/admin/administradores/2' && options?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });

  const container = dom.window.document.getElementById('root');
  dom.window.document.querySelectorAll('.nadm-overlay').forEach((el) => el.remove());
  container.innerHTML = '';

  let root;
  await ui.act(async () => {
    root = ui.mountAdminAdministradores(container, mockUser, mockLogout);
  });
  await flush();

  assert.equal(reloads, 1, 'primeiro carregamento dos admins');

  // Encontra os botões "Alterar senha" nos cards
  const botoes = Array.from(dom.window.document.querySelectorAll('.adm-action-btn'))
    .filter((b) => b.textContent?.trim() === 'Alterar senha');
  assert.equal(botoes.length, 2);

  // O segundo card é o de outro usuário (isSelf = false)
  await ui.act(async () => {
    botoes[1].click();
  });
  await flush();

  // Modal aberto para outro usuário: apenas 2 inputs (nova senha e confirmação)
  const inputs = Array.from(dom.window.document.querySelectorAll('.nadm-modal input'));
  assert.equal(inputs.length, 2);
  await ui.act(async () => {
    changeValue(inputs[0], 'novaSenha123');
    changeValue(inputs[1], 'novaSenha123');
  });
  await flush();

  const form = dom.window.document.querySelector('.nadm-modal form');
  await ui.act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();

  assert.equal(logoutChamado, false, 'logout() NÃO deve ser chamado para outra conta');
  assert.ok(reloads >= 2, 'lista de administradores deve ser recarregada');

  await ui.act(async () => {
    root.unmount();
  });
});
