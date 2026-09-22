import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// HUMAN-14 — notificações internas do admin.
//
// Invariante central da arquitetura: notificação NÃO é materializada. Cada
// uma é derivada de um fato que já existe; só o estado de LEITURA é
// persistido (`notificacao_leituras`, migration 0014). Vários testes aqui
// existem justamente para impedir que isso vire uma tabela de eventos.

const cookieDe = session => session.cookie.split(';')[0];

const listar = (db, session) =>
  app.adminNotificacoes.onRequestGet({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/notificacoes', {
      headers: {Cookie: cookieDe(session)},
    }),
  });

const marcar = (db, session, corpo) =>
  app.adminNotificacoes.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/notificacoes', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: 'https://local.test', Cookie: cookieDe(session)},
      body: JSON.stringify(corpo),
    }),
  });

async function corpo(response) {
  return {status: response.status, body: await response.json()};
}

// Bancada limpa: sem pedido, produto com estoque folgado.
async function bancada(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=50, estoque_reservado=0, ativo=1 WHERE id=1').run();
  return {db, session: await app.auth.createSession(db, 1)};
}

const chaves = notificacoes => notificacoes.map(n => n.chave);

/* ──────────────────── derivação a partir de fatos reais ──────────────────── */

test('sem fatos, não há notificações inventadas', async t => {
  const {db, session} = await bancada(t);
  const r = await corpo(await listar(db, session));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.notificacoes, []);
  assert.equal(r.body.naoLidas, 0);
});

test('pedido aguardando preparo vira notificação; carrinho não pago do site não', async t => {
  const {db, session} = await bancada(t);

  // Pedido SITE ainda PENDENTE: é carrinho, não compromisso — não notifica.
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(10,'t10','Site','000',5000,'k10','SITE','PENDENTE','NOVO')`).run();
  assert.deepEqual(chaves((await corpo(await listar(db, session))).body.notificacoes), []);

  // Pedido de balcão pendente: compromisso real assumido — notifica.
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(11,'t11','Balcao','000',7000,'k11','MANUAL','PENDENTE','NOVO')`).run();
  // Pedido do site já pago: também notifica.
  await db.prepare("UPDATE pedidos SET status_pagamento='PAGO' WHERE id=10").run();

  const r = await corpo(await listar(db, session));
  assert.deepEqual(chaves(r.body.notificacoes).sort(), ['pedido:10:novo', 'pedido:11:novo']);
  const pedido = r.body.notificacoes.find(n => n.chave === 'pedido:11:novo');
  assert.equal(pedido.tipo, 'PEDIDO');
  assert.match(pedido.descricao, /RP-11/);
  assert.match(pedido.descricao, /R\$ 70,00/);
  assert.equal(pedido.destino, '/admin/pedidos?pedido=11', 'ação contextual com destino real');
  assert.equal(pedido.lida, false);
  assert.equal(r.body.naoLidas, 2);
});

test('sair de NOVO faz a notificação deixar de ser derivada — nada a apagar', async t => {
  const {db, session} = await bancada(t);
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(12,'t12','Balcao','000',5000,'k12','MANUAL','PENDENTE','NOVO')`).run();
  assert.equal((await corpo(await listar(db, session))).body.naoLidas, 1);

  await db.prepare("UPDATE pedidos SET status_pedido='PREPARANDO' WHERE id=12").run();
  const r = await corpo(await listar(db, session));
  assert.deepEqual(r.body.notificacoes, [], 'o fato mudou, a notificação some sozinha');
});

test('pagamento confirmado no ledger vira notificação', async t => {
  const {db, session} = await bancada(t);
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(20,'t20','Cliente','000',9000,'k20','MANUAL','PAGO','PREPARANDO')`).run();
  await db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,
    status,idempotency_key,pago_em) VALUES(30,20,'DINHEIRO','ADMIN',9000,'PAGO','p30',
    '2026-09-18T10:00:00Z')`).run();

  const r = await corpo(await listar(db, session));
  const pagamento = r.body.notificacoes.find(n => n.chave === 'pagamento:30:pago');
  assert.ok(pagamento, 'pagamento PAGO notifica');
  assert.equal(pagamento.tipo, 'PAGAMENTO');
  assert.match(pagamento.descricao, /RP-20/);
  assert.match(pagamento.descricao, /Dinheiro/);
  assert.equal(pagamento.destino, '/admin/pedidos?pedido=20');

  // Pagamento pendente não é fato confirmado — não notifica.
  await db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,
    status,idempotency_key) VALUES(31,20,'PIX_MP','SITE',1000,'PENDENTE','p31')`).run();
  const depois = await corpo(await listar(db, session));
  assert.equal(depois.body.notificacoes.filter(n => n.tipo === 'PAGAMENTO').length, 1);
});

test('estoque distingue baixo de esgotado, e repor faz a notificação sumir', async t => {
  const {db, session} = await bancada(t);

  await db.prepare('UPDATE produtos SET estoque=2, estoque_reservado=0 WHERE id=1').run();
  let r = await corpo(await listar(db, session));
  let estoque = r.body.notificacoes.find(n => n.tipo === 'ESTOQUE');
  assert.equal(estoque.chave, 'estoque:1:baixo');
  assert.match(estoque.descricao, /2 unidade/);
  assert.equal(estoque.destino, '/admin/produtos');

  // Reserva consome o livre: vira esgotado, com chave DIFERENTE.
  await db.prepare('UPDATE produtos SET estoque_reservado=2 WHERE id=1').run();
  r = await corpo(await listar(db, session));
  estoque = r.body.notificacoes.find(n => n.tipo === 'ESTOQUE');
  assert.equal(estoque.chave, 'estoque:1:esgotado', 'nível faz parte da identidade do evento');

  // Repor o estoque remove o fato — e com ele a notificação.
  await db.prepare('UPDATE produtos SET estoque=50, estoque_reservado=0 WHERE id=1').run();
  r = await corpo(await listar(db, session));
  assert.equal(r.body.notificacoes.filter(n => n.tipo === 'ESTOQUE').length, 0);

  // Produto inativo não entra.
  await db.prepare('UPDATE produtos SET estoque=0, ativo=0 WHERE id=1').run();
  r = await corpo(await listar(db, session));
  assert.equal(r.body.notificacoes.filter(n => n.tipo === 'ESTOQUE').length, 0);
});

test('operação com envio inconclusivo (B-3) vira falha operacional visível', async t => {
  const {db, session} = await bancada(t);
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(40,'t40','Cliente','000',5000,'k40','SITE','PENDENTE','NOVO')`).run();
  await db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,
    status,idempotency_key) VALUES(50,40,'PIX_MP','SITE',5000,'PENDENTE','p50')`).run();
  await db.prepare(`INSERT INTO pedido_operacoes(operation_key,tipo,escopo,fingerprint_versao,
    fingerprint,fase,pedido_id,pagamento_id,mp_idempotency_key)
    VALUES('op-inconclusiva','CHECKOUT_SITE','SITE',1,'fp','ENVIO_INCONCLUSIVO',40,50,'mpk')`).run();

  const r = await corpo(await listar(db, session));
  const operacao = r.body.notificacoes.find(n => n.chave === 'operacao:op-inconclusiva');
  assert.ok(operacao, 'o estado inconclusivo do B-3 é visível como notificação');
  assert.equal(operacao.tipo, 'OPERACAO');
  assert.match(operacao.titulo, /sem confirmação/i);
  assert.equal(operacao.destino, '/admin/pedidos?pedido=40');

  // Convergir a operação remove a notificação.
  await db.prepare("UPDATE pedido_operacoes SET fase='CONCLUIDA' WHERE operation_key='op-inconclusiva'").run();
  const depois = await corpo(await listar(db, session));
  assert.equal(depois.body.notificacoes.filter(n => n.tipo === 'OPERACAO').length, 0);
});

/* ─────────────────────────── lida / não lida ─────────────────────────── */

async function comTresNotificacoes(t) {
  const {db, session} = await bancada(t);
  await db.prepare('UPDATE produtos SET estoque=1, estoque_reservado=0 WHERE id=1').run();
  for (const id of [60, 61]) {
    await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
      valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
      VALUES(?,?,?,'000',5000,?,'MANUAL','PENDENTE','NOVO')`)
      .bind(id, `t${id}`, `Cliente ${id}`, `k${id}`).run();
  }
  return {db, session};
}

test('marcar uma como lida afeta só ela, e o badge cai de um', async t => {
  const {db, session} = await comTresNotificacoes(t);
  const antes = (await corpo(await listar(db, session))).body;
  assert.equal(antes.naoLidas, 3);

  const r = await corpo(await marcar(db, session, {chaves: ['pedido:60:novo']}));
  assert.equal(r.status, 200);
  assert.equal(r.body.marcadas, 1);
  assert.equal(r.body.naoLidas, 2, 'resposta já traz o estado recalculado');
  assert.equal(r.body.notificacoes.find(n => n.chave === 'pedido:60:novo').lida, true);
  assert.equal(r.body.notificacoes.find(n => n.chave === 'pedido:61:novo').lida, false);

  // Persistiu: a leitura sobrevive a uma nova consulta.
  const relido = (await corpo(await listar(db, session))).body;
  assert.equal(relido.naoLidas, 2);
  assert.equal(relido.notificacoes.find(n => n.chave === 'pedido:60:novo').lida, true);
});

test('marcar como lida é idempotente e não duplica linha', async t => {
  const {db, session} = await comTresNotificacoes(t);
  for (let i = 0; i < 3; i++) await marcar(db, session, {chaves: ['pedido:60:novo']});
  const linhas = await db.prepare(
    "SELECT COUNT(*) AS n FROM notificacao_leituras WHERE chave='pedido:60:novo'").first();
  assert.equal(linhas.n, 1, 'UNIQUE(usuario_id, chave) + INSERT OR IGNORE');
  assert.equal((await corpo(await listar(db, session))).body.naoLidas, 2);
});

test('marcar todas zera o badge; o servidor deriva a lista, não confia no cliente', async t => {
  const {db, session} = await comTresNotificacoes(t);
  const r = await corpo(await marcar(db, session, {todas: true}));
  assert.equal(r.status, 200);
  assert.equal(r.body.naoLidas, 0);
  assert.ok(r.body.notificacoes.every(n => n.lida), 'todas ficam lidas');
  assert.equal(r.body.marcadas, 3);

  // Repetir não quebra nem duplica.
  const repetido = await corpo(await marcar(db, session, {todas: true}));
  assert.equal(repetido.body.naoLidas, 0);
  const total = await db.prepare('SELECT COUNT(*) AS n FROM notificacao_leituras').first();
  assert.equal(total.n, 3);

  // Um fato NOVO depois disso volta a contar — "todas" não silencia o futuro.
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido)
    VALUES(70,'t70','Novo','000',5000,'k70','MANUAL','PENDENTE','NOVO')`).run();
  assert.equal((await corpo(await listar(db, session))).body.naoLidas, 1);
});

test('leitura é por operador: marcar em um não marca no outro', async t => {
  const {db, session} = await comTresNotificacoes(t);
  await db.prepare(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
    VALUES(2,'Outro','outro','outro@example.invalid','unused','ADMIN')`).run();
  const outra = await app.auth.createSession(db, 2);

  await marcar(db, session, {todas: true});
  assert.equal((await corpo(await listar(db, session))).body.naoLidas, 0);
  assert.equal((await corpo(await listar(db, outra))).body.naoLidas, 3,
    'o outro operador continua com tudo não lido');
});

test('chave inventada pelo cliente é ignorada, não polui a tabela', async t => {
  const {db, session} = await comTresNotificacoes(t);
  const r = await corpo(await marcar(db, session, {chaves: ['pedido:99999:novo', 'lixo']}));
  assert.equal(r.status, 200);
  assert.equal(r.body.marcadas, 0);
  assert.equal(r.body.naoLidas, 3);
  const total = await db.prepare('SELECT COUNT(*) AS n FROM notificacao_leituras').first();
  assert.equal(total.n, 0, 'só chaves deriváveis agora podem ser marcadas');
});

/* ───────────────────────── contrato do endpoint ───────────────────────── */

test('endpoint exige autenticação e valida a entrada', async t => {
  const {db, session} = await comTresNotificacoes(t);

  const semSessao = await app.adminNotificacoes.onRequestGet({
    env: {DB: db}, request: new Request('https://local.test/api/admin/notificacoes'),
  });
  assert.equal(semSessao.status, 401);

  const postSemSessao = await app.adminNotificacoes.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/notificacoes', {
      method: 'POST', headers: {Origin: 'https://local.test'}, body: JSON.stringify({todas: true}),
    }),
  });
  assert.equal(postSemSessao.status, 401);

  for (const invalido of [{}, {chaves: []}, {chaves: 'x'}, {chaves: [1]}, {chaves: ['']},
    {chaves: Array(61).fill('pedido:60:novo')}]) {
    const r = await marcar(db, session, invalido);
    assert.equal(r.status, 400, JSON.stringify(invalido));
  }
  const jsonInvalido = await app.adminNotificacoes.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/notificacoes', {
      method: 'POST', headers: {Origin: 'https://local.test', Cookie: cookieDe(session)}, body: '{',
    }),
  });
  assert.equal(jsonInvalido.status, 400);
});

test('notificações não criam nem alteram nenhum fato de domínio', async t => {
  const {db, session} = await comTresNotificacoes(t);
  const antes = await state(db);

  await listar(db, session);
  await marcar(db, session, {todas: true});
  await listar(db, session);

  assert.deepEqual(await state(db), antes,
    'pedidos, itens, pagamentos, alocações, refunds e operações intocados');
  // E não existe tabela de notificações materializadas.
  const tabelas = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'notifica%'").all();
  assert.deepEqual(tabelas.results.map(r => r.name), ['notificacao_leituras'],
    'só o estado de leitura é persistido');
});

test('a ordenação é por recência do fato', async t => {
  const {db, session} = await bancada(t);
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido,criado_em)
    VALUES(80,'t80','Antigo','000',5000,'k80','MANUAL','PENDENTE','NOVO','2026-09-01T10:00:00Z')`).run();
  await db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido,criado_em)
    VALUES(81,'t81','Recente','000',5000,'k81','MANUAL','PENDENTE','NOVO','2026-09-18T10:00:00Z')`).run();

  const r = await corpo(await listar(db, session));
  assert.deepEqual(chaves(r.body.notificacoes), ['pedido:81:novo', 'pedido:80:novo']);
});
