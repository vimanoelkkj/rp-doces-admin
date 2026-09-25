import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { app, fixture } from './helpers/b3.mjs';

const cookieDe = (session) => session.cookie.split(';')[0];

function adminRequest(session, path, { method = 'GET', origin = 'https://local.test', body } = {}) {
  const headers = {
    ...(origin ? { Origin: origin } : {}),
    ...(session ? { Cookie: cookieDe(session) } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  return new Request(`https://local.test${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function setupAdmin(t) {
  const db = await fixture(t, { ledger: false, reserve: 'SEM_RESERVA' });
  const session = await app.auth.createSession(db, 1);
  return { db, session };
}

function createTrackingDb(db) {
  const statements = [];
  const trackingDb = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql) => {
          statements.push(sql);
          return target.prepare(sql);
        };
      }
      return target[prop];
    },
  });
  return { trackingDb, statements };
}

test('GET /api/admin/pedidos é puramente de leitura e não dispara manutenção nem waitUntil', async t => {
  const { db, session } = await setupAdmin(t);
  const { trackingDb, statements } = createTrackingDb(db);

  let waitUntilChamado = 0;
  const mockContext = {
    env: { DB: trackingDb },
    request: adminRequest(session, '/api/admin/pedidos?status=todos&page=1'),
    waitUntil: () => {
      waitUntilChamado++;
    },
  };

  const res = await app.admin.onRequestGet(mockContext);
  assert.equal(res.status, 200);
  assert.equal(waitUntilChamado, 0, 'waitUntil não deve ser chamado no GET de pedidos');

  // Não deve executar queries de manutenção (ex: verificação de pedido_operacoes inconclusivas)
  const executouManutencao = statements.some((s) => s.includes('pedido_operacoes'));
  assert.equal(executouManutencao, false, 'GET de pedidos não deve consultar pedido_operacoes nem disparar manutenção');

  // Validação estática: confirma ausência de waitUntil e reconcilePedidosEmBackground em list.ts
  const listSrc = await readFile(new URL('../functions/lib/adminPedidos/list.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(listSrc, /reconcilePedidosEmBackground/, 'list.ts não deve importar nem chamar reconcilePedidosEmBackground');
  assert.doesNotMatch(listSrc, /waitUntil/, 'list.ts não deve usar waitUntil');
});

test('POST /api/admin/pedidos/reconciliar exige autenticação e same-origin', async t => {
  const { db, session } = await setupAdmin(t);

  // Sem same-origin -> 403
  const resSemOrigin = await app.adminReconciliar.onRequestPost({
    env: { DB: db },
    request: adminRequest(session, '/api/admin/pedidos/reconciliar', { method: 'POST', origin: 'https://evil.invalid' }),
  });
  assert.equal(resSemOrigin.status, 403);

  // Sem sessão -> 401
  const resSemSessao = await app.adminReconciliar.onRequestPost({
    env: { DB: db },
    request: adminRequest(null, '/api/admin/pedidos/reconciliar', { method: 'POST' }),
  });
  assert.equal(resSemSessao.status, 401);
});

test('POST /api/admin/pedidos/reconciliar executa a manutenção de pedidos com sucesso', async t => {
  const { db, session } = await setupAdmin(t);
  const { trackingDb, statements } = createTrackingDb(db);

  const res = await app.adminReconciliar.onRequestPost({
    env: { DB: trackingDb, MP_ACCESS_TOKEN: 'mp-token-teste' },
    request: adminRequest(session, '/api/admin/pedidos/reconciliar', { method: 'POST' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });

  // Confirma que a manutenção rodou executando queries das rotinas de background
  const executouOperacoesInconclusivas = statements.some((s) => s.includes('pedido_operacoes'));
  const executouPixPendentes = statements.some((s) => s.includes('pedido_pagamentos'));
  assert.equal(executouOperacoesInconclusivas, true, 'deve executar busca por operações inconclusivas');
  assert.equal(executouPixPendentes, true, 'deve executar busca por pagamentos pendentes no ledger');
});

test('GET /api/admin/pedidos/:id é puramente de leitura e não chama reconcileLiveTabPedido', async t => {
  const { db, session } = await setupAdmin(t);
  const { trackingDb, statements } = createTrackingDb(db);

  const res = await app.adminOrder.onRequestGet({
    env: { DB: trackingDb },
    params: { id: '1' },
    request: adminRequest(session, '/api/admin/pedidos/1'),
  });
  assert.equal(res.status, 200);

  // reconcileLiveTabPedido executa consultas específicas de cancelamento com status SOLICITADO/AGUARDANDO_REEMBOLSO/INCONCLUSIVO
  const executouReconcileLiveTab = statements.some((s) =>
    s.includes("status IN ('SOLICITADO','AGUARDANDO_REEMBOLSO','INCONCLUSIVO')")
  );
  assert.equal(executouReconcileLiveTab, false, 'GET /api/admin/pedidos/:id não deve executar reconcileLiveTabPedido');

  // Validação estática: confirma ausência de reconcileLiveTabPedido em [id].ts
  const orderSrc = await readFile(new URL('../functions/api/admin/pedidos/[id].ts', import.meta.url), 'utf8');
  assert.doesNotMatch(orderSrc, /reconcileLiveTabPedido/, '[id].ts não deve importar nem chamar reconcileLiveTabPedido');
});

test('POST /api/admin/pedidos/:id/reconciliar exige autenticação, same-origin e valida ID', async t => {
  const { db, session } = await setupAdmin(t);

  // Sem same-origin -> 403
  const resSemOrigin = await app.adminOrderReconciliar.onRequestPost({
    env: { DB: db },
    params: { id: '1' },
    request: adminRequest(session, '/api/admin/pedidos/1/reconciliar', { method: 'POST', origin: 'https://evil.invalid' }),
  });
  assert.equal(resSemOrigin.status, 403);

  // Sem sessão -> 401
  const resSemSessao = await app.adminOrderReconciliar.onRequestPost({
    env: { DB: db },
    params: { id: '1' },
    request: adminRequest(null, '/api/admin/pedidos/1/reconciliar', { method: 'POST' }),
  });
  assert.equal(resSemSessao.status, 401);

  // ID inválido -> 400
  const resIdInvalido = await app.adminOrderReconciliar.onRequestPost({
    env: { DB: db },
    params: { id: 'invalido' },
    request: adminRequest(session, '/api/admin/pedidos/invalido/reconciliar', { method: 'POST' }),
  });
  assert.equal(resIdInvalido.status, 400);

  const resIdZero = await app.adminOrderReconciliar.onRequestPost({
    env: { DB: db },
    params: { id: '0' },
    request: adminRequest(session, '/api/admin/pedidos/0/reconciliar', { method: 'POST' }),
  });
  assert.equal(resIdZero.status, 400);
});

test('POST /api/admin/pedidos/:id/reconciliar executa a reconciliação do pedido específico', async t => {
  const { db, session } = await setupAdmin(t);
  const { trackingDb, statements } = createTrackingDb(db);

  const res = await app.adminOrderReconciliar.onRequestPost({
    env: { DB: trackingDb, MP_ACCESS_TOKEN: 'mp-token-teste' },
    params: { id: '1' },
    request: adminRequest(session, '/api/admin/pedidos/1/reconciliar', { method: 'POST' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });

  // Confirma que reconcileLiveTabPedido foi executado no pedido
  const executouReconcileLiveTab = statements.some((s) =>
    s.includes("status IN ('SOLICITADO','AGUARDANDO_REEMBOLSO','INCONCLUSIVO')")
  );
  assert.equal(executouReconcileLiveTab, true, 'deve executar queries de reconciliação de cancelamentos do pedido');
});

test('UI AdminPedidos: reconciliação global ocorre apenas na montagem da tela e não em paginação/filtro/busca', async () => {
  const adminPedidosSrc = await readFile(
    new URL('../src/admin/Pedidos/AdminPedidos.tsx', import.meta.url),
    'utf8',
  );

  // Confirma chamada do POST de reconciliação em efeito de abertura com array de dependências vazio
  assert.match(
    adminPedidosSrc,
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?fetch\("\/api\/admin\/pedidos\/reconciliar",\s*\{\s*method:\s*"POST"\s*\}\)[\s\S]*?\}, \[\]\);/,
    'reconciliação deve ser executada apenas na abertura da tela (deps: [])',
  );

  // Confirma que a busca/filtro/paginação chamam apenas a rota GET /api/admin/pedidos
  assert.match(
    adminPedidosSrc,
    /fetch\(`\/api\/admin\/pedidos\?\$\{params\.toString\(\)\}`\)/,
    'carregarPagina deve continuar chamando somente GET /api/admin/pedidos',
  );
  assert.doesNotMatch(
    adminPedidosSrc,
    /carregarPagina[\s\S]*?\/reconciliar/,
    'paginação não deve disparar rota de reconciliação',
  );
});

test('UI usePedidoDetalhe: carregarPedido executa POST de reconciliação antes do GET tanto na abertura quanto no polling silencioso', async () => {
  const useDetalheSrc = await readFile(
    new URL('../src/admin/Pedidos/PedidoDetalhe/usePedidoDetalhe.ts', import.meta.url),
    'utf8',
  );

  // Confirma que carregarPedido dispara POST /reconciliar antes de chamar GET /api/admin/pedidos/${orderId}
  assert.match(
    useDetalheSrc,
    /const carregarPedido = useCallback\([\s\S]*?fetch\(`\/api\/admin\/pedidos\/\$\{orderId\}\/reconciliar`,\s*\{\s*method:\s*"POST"\s*\}\)[\s\S]*?\.then\(\(\)\s*=>\s*fetch\(`\/api\/admin\/pedidos\/\$\{orderId\}`\)\)/,
    'carregarPedido deve encadear POST /reconciliar antes de GET /api/admin/pedidos/:id',
  );

  // Confirma tratamento best-effort com .catch que não impede o GET
  assert.match(
    useDetalheSrc,
    /fetch\(`\/api\/admin\/pedidos\/\$\{orderId\}\/reconciliar`,\s*\{\s*method:\s*"POST"\s*\}\)\s*\.catch\([\s\S]*?\)\s*\.then\(\(\)\s*=>\s*fetch\(`\/api\/admin\/pedidos\/\$\{orderId\}`\)\)/,
    'falha na reconciliação deve ser tratada como best-effort e não impedir a chamada do GET subsequente',
  );

  // Confirma que o polling silencioso de 5s invoca carregarPedido(true), herdando a reconciliação antes do GET
  assert.match(
    useDetalheSrc,
    /setInterval\(\(\)\s*=>\s*void carregarPedido\(true\),\s*5000\)/,
    'polling deve invocar carregarPedido(true), que faz POST antes do GET de forma silenciosa',
  );

  // Confirma que a abertura inicial da tela também passa pelo carregarPedido unificado
  assert.match(
    useDetalheSrc,
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?void carregarPedido\(\);[\s\S]*?\}, \[carregarPedido\]\);/,
    'efeito de montagem deve invocar carregarPedido() unificado',
  );
});
