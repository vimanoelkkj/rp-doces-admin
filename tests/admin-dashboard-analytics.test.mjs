import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

const cookieDe = session => session.cookie.split(';')[0];

const dashboardRequest = (db, cookie = '', date = '2099-01-01') =>
  app.dashboard.onRequestGet({
    env: {DB: db},
    request: new Request(
      `https://local.test/api/admin/dashboard?date=${date}`,
      {headers: cookie ? {Cookie: cookie} : {}},
    ),
  });

test('caixa total usa somente fatos confirmados e alocacoes nao duplicam valores', async t => {
  const db = await fixture(t, {paid: true, reserve: 'CONVERTIDA'});
  await db.batch([
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(2,1,1,'Bolo',1,1500,1500,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      idempotency_key,pago_em) VALUES(2,1,'CARTAO','ADMIN',2500,'PAGO','card-paid',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      idempotency_key) VALUES(3,1,'PIX_EXTERNO','ADMIN',900,'PENDENTE','pix-pending')`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(2,2,1,1000)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(3,2,2,1500)`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,
      valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro) VALUES(20,1,1,'FALHOU',10000,1000,400,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,
      valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro) VALUES(21,1,2,'FALHOU',1500,1500,600,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,
      valor_centavos,status,idempotency_key,concluido_em)
      VALUES(1,1,2,'MANUAL','CARTAO',1000,'REEMBOLSADO','refund-confirmed',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,
      pedido_item_cancelamento_id,valor_centavos) VALUES(1,2,20,400)`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,
      pedido_item_cancelamento_id,valor_centavos) VALUES(1,3,21,600)`),
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,
      valor_centavos,status,idempotency_key)
      VALUES(2,1,2,'MANUAL','CARTAO',700,'PENDENTE','refund-pending')`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      idempotency_key,pago_em) VALUES(4,1,'DINHEIRO','ADMIN',500,'PAGO','cash-after-refund',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
      VALUES(4,4,1,500)`),
  ]);

  assert.deepEqual((await app.dashboardAnalytics.getStoreAnalytics(db)).financeiro, {
    brutoCentavos: 13000,
    reembolsadoCentavos: 1000,
    liquidoCentavos: 12000,
  });
});

async function rankingFixture(t) {
  const db = await fixture(t, {ledger: false, reserve: 'CONVERTIDA'});
  await db.batch([
    db.prepare(`UPDATE produtos SET nome='Nome atual do catalogo' WHERE id=1`),
    db.prepare(`UPDATE pedidos SET valor_total_centavos=300,status_pagamento='PAGO' WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET produto_nome='Ninho historico',quantidade=3,
      valor_unitario_centavos=100,valor_total_centavos=300 WHERE id=1`),
    ...[
      [2,'A origem'],[3,'B intermediario'],[4,'C final'],[5,'Alfa'],
      [6,'Sem pagamento'],[7,'Parcial'],[8,'Reembolsado'],[9,'Sabor removido'],
    ].map(([id,nome]) => db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,
      estoque,estoque_reservado) VALUES(?,?,'BOLO',100,100,0)`).bind(id,nome)),
    ...[
      [2,0],[3,400],[4,200],[5,300],[6,4900],[7,2000],[8,700],
    ].map(([id,total]) => db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,
      cliente_whatsapp,valor_total_centavos,idempotency_key,reserva_status,status_pagamento)
      VALUES(?,?,'Cliente','000',?,?,'CONVERTIDA','PAGO')`)
      .bind(id,`token-${id}`,total,`pedido-${id}`)),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(2,2,2,'A origem cancelada',10,100,1000,'CANCELADO','REPOSTO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(3,3,2,'A origem',4,100,400,'CANCELADO','REPOSTO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(4,3,3,'B intermediario',4,100,400,'CANCELADO','REPOSTO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(5,3,4,'C final',4,100,400,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(6,4,9,'Sabor removido',2,100,200,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(7,5,5,'Alfa',3,100,300,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(8,6,6,'Sem pagamento',49,100,4900,'ATIVO','RESERVADO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(9,7,7,'Parcial',20,100,2000,'ATIVO','RESERVADO')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(10,8,8,'Reembolsado',7,100,700,'ATIVO','BAIXADO')`),
    db.prepare(`DELETE FROM produtos WHERE id=9`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,
      produto_destino_id,quantidade_destino,preco_unitario_destino_centavos,
      valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,
      estoque_acao_origem,status,snapshot_financeiro)
      VALUES(1,3,3,4,3,4,100,400,400,0,'ZERO','REPOR','CONCLUIDA','{}')`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,
      produto_destino_id,quantidade_destino,preco_unitario_destino_centavos,
      valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,
      estoque_acao_origem,status,snapshot_financeiro)
      VALUES(2,3,4,5,4,4,100,400,400,0,'ZERO','REPOR','CONCLUIDA','{}')`),
    ...[
      [1,1,'PAGO',300,'normal'],[2,2,'PAGO',1000,'cancelled'],
      [3,3,'PAGO',400,'chain'],[4,4,'PAGO',200,'removed'],
      [5,5,'PAGO',300,'alpha'],[6,6,'PENDENTE',4900,'unpaid'],
      [7,7,'PAGO',1000,'partial'],[8,8,'PAGO',700,'refunded'],
    ].map(([id,pedidoId,status,valor,key]) => db.prepare(`INSERT INTO pedido_pagamentos(
      id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(?,?,'DINHEIRO','ADMIN',?,?,?,CASE WHEN ?='PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END)`)
      .bind(id,pedidoId,valor,status,key,status)),
    ...[
      [1,1,1,300],[2,2,2,1000],[3,3,3,400],[4,4,6,200],
      [5,5,7,300],[6,6,8,4900],[7,7,9,1000],[8,8,10,700],
    ].map(([id,pagamentoId,itemId,valor]) => db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
      id,pagamento_id,pedido_item_id,valor_centavos) VALUES(?,?,?,?)`)
      .bind(id,pagamentoId,itemId,valor)),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,
      valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,snapshot_financeiro) VALUES(80,8,10,'FALHOU',700,700,100,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,
      valor_centavos,status,idempotency_key,concluido_em)
      VALUES(80,8,8,'MANUAL','DINHEIRO',100,'REEMBOLSADO','ranking-refund',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,
      pedido_item_cancelamento_id,valor_centavos) VALUES(80,8,80,100)`),
  ]);
  return db;
}

test('ranking conta quantidade coberta, troca efetiva e produto removido em ordem estavel', async t => {
  const db = await rankingFixture(t);
  const analytics = await app.dashboardAnalytics.getStoreAnalytics(db);
  assert.deepEqual(analytics.maisVendidos, [
    {produtoId: 4, nome: 'C final', quantidade: 4},
    {produtoId: 5, nome: 'Alfa', quantidade: 3},
    {produtoId: 1, nome: 'Ninho historico', quantidade: 3},
    {produtoId: null, nome: 'Sabor removido', quantidade: 2},
  ]);
});

test('dashboard exige autenticacao, agrega no backend e nao modifica o dominio', async t => {
  const db = await rankingFixture(t);
  assert.equal((await dashboardRequest(db)).status, 401);

  const session = await app.auth.createSession(db, 1);
  const tables = ['produtos','pedidos','pedido_itens','pedido_pagamentos',
    'pedido_pagamento_alocacoes','pedido_reembolsos','pedido_reembolso_alocacoes',
    'pedido_item_trocas','pedido_operacoes'];
  const before = Object.fromEntries(await Promise.all(tables.map(async table =>
    [table,(await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results])));

  const response = await dashboardRequest(db, cookieDe(session));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data, '2099-01-01');
  assert.deepEqual(body.financeiro, {
    brutoCentavos: 3900,
    reembolsadoCentavos: 100,
    liquidoCentavos: 3800,
  });
  assert.deepEqual(body.maisVendidos.slice(0, 2), [
    {produtoId: 4, nome: 'C final', quantidade: 4},
    {produtoId: 5, nome: 'Alfa', quantidade: 3},
  ]);

  for (const table of tables) {
    assert.deepEqual((await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results,
      before[table], `${table} permaneceu somente leitura`);
  }
});


test('a receber atravessa a virada do dia e some somente quando o saldo zera', async t => {
  // "Hoje" é derivado no backend: 01/01/2099 12:00 em São Paulo.
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2099-01-01T15:00:00Z')});
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.prepare(`UPDATE pedidos
    SET origem_pedido='MANUAL',
        status_pedido='ENTREGUE',
        status_comanda='ENCERRADA',
        status_pagamento='PENDENTE',
        valor_total_centavos=4000,
        criado_em='2098-12-31 10:00:00'
    WHERE id=1`).run();

  const session = await app.auth.createSession(db, 1);
  let response = await dashboardRequest(db, cookieDe(session), '2099-01-01');
  assert.equal(response.status, 200);
  let body = await response.json();

  assert.deepEqual(body.aReceber, {count: 1, total: 4000, anteriores: 1});
  assert.equal(body.pagamentosPendentes.length, 1);
  assert.equal(body.pagamentosPendentes[0].id, 1);
  assert.equal(body.pagamentosPendentes[0].saldo_centavos, 4000);
  assert.equal(body.pagamentosPendentes[0].dias_em_aberto, 1);

  await db.prepare(`INSERT INTO pedido_pagamentos(
    pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
    VALUES(1,'DINHEIRO','ADMIN',4000,'PAGO','quit-next-day',CURRENT_TIMESTAMP)`).run();
  await db.prepare(`UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1`).run();

  response = await dashboardRequest(db, cookieDe(session), '2099-01-01');
  body = await response.json();
  assert.deepEqual(body.aReceber, {count: 0, total: 0, anteriores: 0});
  assert.deepEqual(body.pagamentosPendentes, []);
});

// ── Dia comercial da loja (America/Sao_Paulo, UTC-03:00) ──
// 2026-09-26 01:30 UTC = 25/09 22:30 em SP -> dia 25.
// 2026-09-26 03:30 UTC = 26/09 00:30 em SP -> dia 26.
const agora = (t, iso) => t.mock.timers.enable({apis: ['Date'], now: Date.parse(iso)});

test('dia comercial: storeToday segue America/Sao_Paulo, não UTC', () => {
  const {storeToday} = app.storeDay;
  assert.equal(storeToday(new Date('2026-09-26T01:30:00Z')), '2026-09-25');
  assert.equal(storeToday(new Date('2026-09-26T02:59:59Z')), '2026-09-25');
  assert.equal(storeToday(new Date('2026-09-26T03:00:00Z')), '2026-09-26');
  assert.equal(storeToday(new Date('2026-09-26T03:30:00Z')), '2026-09-26');
});

test('dia comercial: storeDateSql converte CURRENT_TIMESTAMP (UTC) e ISO do Mercado Pago', async t => {
  const db = await fixture(t);
  const {storeDateSql, storeToday} = app.storeDay;
  const casos = [
    ['2026-09-26 01:30:00', '2026-09-25'],
    ['2026-09-26 02:59:59', '2026-09-25'],
    ['2026-09-26 03:00:00', '2026-09-26'],
    ['2026-09-26 03:30:00', '2026-09-26'],
    // date_approved do MP vem com offset explícito: 22:30-04:00 = 02:30 UTC = 23:30 SP.
    ['2026-09-25T22:30:00.000-04:00', '2026-09-25'],
    ['2026-09-26T03:30:00.000Z', '2026-09-26'],
  ];
  for (const [ts, esperado] of casos) {
    assert.equal(await db.prepare(`SELECT ${storeDateSql('?')} AS d`).bind(ts).first('d'), esperado, ts);
    // SQL (offset fixo) e JS (fuso IANA) concordam.
    assert.equal(storeToday(new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`)), esperado, ts);
  }
});

async function viradaFixture(t) {
  const db = await fixture(t, {ledger: false, reserve: 'CONVERTIDA'});
  await db.batch([
    // Pedido 1: criado 25/09 22:30 em SP (26/09 01:30 UTC).
    db.prepare(`UPDATE pedidos SET criado_em='2026-09-26 01:30:00', status_pagamento='PAGO',
      status_pedido='NOVO', status_comanda='ABERTA', valor_total_centavos=10000 WHERE id=1`),
    // Pedido 2: criado 26/09 00:30 em SP (26/09 03:30 UTC).
    db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,
      idempotency_key,reserva_status,status_pagamento,status_pedido,status_comanda,criado_em)
      VALUES(2,'token-2','Cliente 2','000',3000,'pedido-2','CONVERTIDA','PAGO','NOVO','ABERTA',
      '2026-09-26 03:30:00')`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      idempotency_key,pago_em) VALUES(1,1,'DINHEIRO','ADMIN',6000,'PAGO','p1','2026-09-26 01:30:00')`),
    // Pix MP aprovado às 22:30-04:00 = 23:30 em SP, ainda dia 25.
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key,pago_em)
      VALUES(2,1,'PIX_MP','SITE',4000,'PAGO','901','p2','2026-09-25T22:30:00.000-04:00')`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      idempotency_key,pago_em) VALUES(3,2,'DINHEIRO','ADMIN',3000,'PAGO','p3','2026-09-26 03:30:00')`),
  ]);
  return db;
}

test('virada UTC/Brasil: recebido, comandas, aguardando preparo e pedidos do dia seguem o dia da loja', async t => {
  const db = await viradaFixture(t);
  const session = await app.auth.createSession(db, 1);

  const dia25 = await (await dashboardRequest(db, cookieDe(session), '2026-09-25')).json();
  assert.equal(dia25.data, '2026-09-25');
  assert.deepEqual(dia25.recebidoHoje, {count: 2, total: 10000});
  assert.equal(dia25.comandasAbertas, 1);
  assert.equal(dia25.aguardandoPreparo, 1);
  assert.deepEqual(dia25.pedidosRecentes.map(p => p.id), [1]);

  const dia26 = await (await dashboardRequest(db, cookieDe(session), '2026-09-26')).json();
  assert.deepEqual(dia26.recebidoHoje, {count: 1, total: 3000});
  assert.equal(dia26.comandasAbertas, 1);
  assert.equal(dia26.aguardandoPreparo, 1);
  assert.deepEqual(dia26.pedidosRecentes.map(p => p.id), [2]);

  // Métricas globais não dependem do dia.
  assert.deepEqual(dia25.financeiro, dia26.financeiro);
  assert.equal(dia25.financeiro.brutoCentavos, 13000);
  assert.deepEqual(dia25.resultadoFinanceiro, dia26.resultadoFinanceiro);
  assert.deepEqual(dia25.catalogo, dia26.catalogo);
});

test('today vem do backend: 01:30 UTC ainda é hoje=25/09; parâmetro today do navegador é ignorado', async t => {
  agora(t, '2026-09-26T01:45:00Z');
  const db = await viradaFixture(t);
  const session = await app.auth.createSession(db, 1);

  for (const today of [null, '2026-09-26', '2031-01-01']) {
    const url = today
      ? `https://local.test/api/admin/dashboard?today=${today}`
      : 'https://local.test/api/admin/dashboard';
    const response = await app.dashboard.onRequestGet({
      env: {DB: db},
      request: new Request(url, {headers: {Cookie: cookieDe(session)}}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hoje, '2026-09-25');
    assert.equal(body.data, '2026-09-25');
    assert.deepEqual(body.recebidoHoje, {count: 2, total: 10000});
    assert.deepEqual(body.pedidosRecentes.map(p => p.id), [1]);
  }
});

test('today vem do backend: 03:30 UTC já é hoje=26/09', async t => {
  agora(t, '2026-09-26T03:30:00Z');
  const db = await viradaFixture(t);
  const session = await app.auth.createSession(db, 1);
  const body = await (await app.dashboard.onRequestGet({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/dashboard', {headers: {Cookie: cookieDe(session)}}),
  })).json();
  assert.equal(body.hoje, '2026-09-26');
  assert.equal(body.data, '2026-09-26');
  assert.deepEqual(body.recebidoHoje, {count: 1, total: 3000});
});

test('virada UTC/Brasil: pendências "anteriores" e dias em aberto usam o dia comercial', async t => {
  // Agora: 25/09 22:45 em SP (26/09 01:45 UTC).
  agora(t, '2026-09-26T01:45:00Z');
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.batch([
    // Criado 24/09 22:30 em SP (25/09 01:30 UTC): dia anterior, 1 dia em aberto.
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL', status_pedido='ENTREGUE',
      status_comanda='ENCERRADA', status_pagamento='PENDENTE', valor_total_centavos=4000,
      criado_em='2026-09-25 01:30:00' WHERE id=1`),
    // Criado 25/09 00:30 em SP (25/09 03:30 UTC): hoje, 0 dia.
    db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,
      idempotency_key,reserva_status,status_pagamento,status_pedido,status_comanda,origem_pedido,criado_em)
      VALUES(2,'token-2','Cliente 2','000',1500,'pedido-2','LIBERADA','PENDENTE','ENTREGUE','ENCERRADA',
      'MANUAL','2026-09-25 03:30:00')`),
  ]);
  const session = await app.auth.createSession(db, 1);

  // Mesmo com um dia histórico selecionado, a fila "a receber" usa o hoje da loja.
  for (const date of [null, '2026-09-01']) {
    const url = date
      ? `https://local.test/api/admin/dashboard?date=${date}`
      : 'https://local.test/api/admin/dashboard';
    const body = await (await app.dashboard.onRequestGet({
      env: {DB: db},
      request: new Request(url, {headers: {Cookie: cookieDe(session)}}),
    })).json();
    assert.deepEqual(body.aReceber, {count: 2, total: 5500, anteriores: 1});
    assert.deepEqual(
      body.pagamentosPendentes.map(p => [p.id, p.dias_em_aberto]),
      [[1, 1], [2, 0]],
    );
  }
});
