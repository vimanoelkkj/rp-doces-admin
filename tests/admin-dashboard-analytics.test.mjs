import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

const cookieDe = session => session.cookie.split(';')[0];

const dashboardRequest = (db, cookie = '', date = '2099-01-01', today = date) =>
  app.dashboard.onRequestGet({
    env: {DB: db},
    request: new Request(
      `https://local.test/api/admin/dashboard?date=${date}&today=${today}`,
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
  let response = await dashboardRequest(db, cookieDe(session), '2099-01-01', '2099-01-01');
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

  response = await dashboardRequest(db, cookieDe(session), '2099-01-01', '2099-01-01');
  body = await response.json();
  assert.deepEqual(body.aReceber, {count: 0, total: 0, anteriores: 0});
  assert.deepEqual(body.pagamentosPendentes, []);
});
