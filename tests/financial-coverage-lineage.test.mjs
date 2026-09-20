import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, barrier } from './helpers/b3.mjs';
import { bancoProducao, aplicarB5, aplicarEstoquePorItem, aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem, aplicarTrocaPorItem, aplicarRefundPixMpRecuperavel,
  aplicarCoberturaFinanceiraLinhagem } from './helpers/b5.mjs';

async function refundedOrder(t){
  const db=await fixture(t,{ledger:false,reserve:'CONVERTIDA'});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',status_pedido='NOVO',
      valor_total_centavos=3,status_pagamento='PARCIAL' WHERE id=1`),
    db.prepare(`UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=3,valor_total_centavos=3,
      status_item='ATIVO',estoque_estado='BAIXADO' WHERE id=1`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(1,1,'DINHEIRO','ADMIN',3,'PAGO','gross-three',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,3)`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,valor_item_centavos,
      valor_pago_associado_centavos,valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro)
      VALUES(90,1,1,'FALHOU',3,3,1,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,concluido_em)
      VALUES(1,1,1,'MANUAL','DINHEIRO',1,'REEMBOLSADO','refund-one',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos)
      VALUES(1,1,90,1)`),
  ]);
  return db;
}

function mockPix(t){
  let id=700;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    assert.equal(JSON.parse(init.body).transaction_amount,0.01);
    return Response.json({id:++id,status:'pending',date_of_expiration:'2099-01-01T00:00:00Z',
      point_of_interaction:{transaction_data:{qr_code:`pix-${id}`}}});
  });
}

test('case 50 charges only the net reopened balance and converges after payment',async t=>{
  const db=await refundedOrder(t);mockPix(t);
  assert.equal(await app.pix.getCapacidadeCobravel(db,1),1);
  assert.deepEqual(await app.ledger.getItensComSaldo(db,1),
    [{itemId:1,valorTotalCentavos:3,pagoPorOutrosCentavos:2}]);
  const created=await app.pix.createAdminPixCharge({DB:db,MP_ACCESS_TOKEN:'test'},{pedidoId:1,valorCentavos:1,
    usuarioId:1,operationKey:'refund-balance-pix-one'});
  assert.equal(created.ok,true);assert.equal(created.valorCentavos,1);
  assert.equal(await app.pix.getCapacidadeCobravel(db,1),0);
  await db.prepare(`UPDATE pedido_pagamentos SET status='PAGO',pago_em=CURRENT_TIMESTAMP WHERE id=?`).bind(created.pagamentoId).run();
  await app.reconcile.reconcilePedidoAfterFinancialChange(db,1);
  const financeiro=await app.ledger.getFinanceiroPedido(db,1);
  assert.deepEqual({bruto:financeiro.brutoPagoCentavos,reembolso:financeiro.reembolsadoCentavos,
    liquido:financeiro.liquidoCentavos,total:financeiro.totalCentavos,saldo:financeiro.saldoCentavos,status:financeiro.status},
  {bruto:4,reembolso:1,liquido:3,total:3,saldo:0,status:'PAGO'});
});

test('pending Pix consumes capacity and two tabs cannot create a second charge',async t=>{
  const db=await refundedOrder(t);mockPix(t);const gate=barrier(2);
  db.hook=async(statements,operation)=>{
    if(operation==='batch'&&statements.some(s=>s.sql.includes('INSERT INTO pedido_pagamentos')))await gate();
    return statements;
  };
  const results=await Promise.all([
    app.pix.createAdminPixCharge({DB:db,MP_ACCESS_TOKEN:'test'},{pedidoId:1,valorCentavos:1,usuarioId:1,operationKey:'refund-tab-one'}),
    app.pix.createAdminPixCharge({DB:db,MP_ACCESS_TOKEN:'test'},{pedidoId:1,valorCentavos:1,usuarioId:1,operationKey:'refund-tab-two'}),
  ]);
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_pagamentos WHERE origem='ADMIN' AND metodo='PIX_MP'`).first()).n,1);
  assert.equal(await app.pix.getCapacidadeCobravel(db,1),0);
});

test('manual payment after refund uses effective coverage and the net guard',async t=>{
  const db=await refundedOrder(t);
  const first=await app.ledger.registerAdminPayment(db,{pedidoId:1,metodo:'DINHEIRO',valorCentavos:1,
    usuarioId:1,operationKey:'manual-after-refund'});
  assert.equal(first.ok,true);
  const second=await app.ledger.registerAdminPayment(db,{pedidoId:1,metodo:'DINHEIRO',valorCentavos:1,
    usuarioId:1,operationKey:'manual-after-refund-extra'});
  assert.equal(second.ok,false);assert.equal(second.erro,'VALOR_ACIMA_DO_SALDO');
  assert.deepEqual((await db.prepare(`SELECT pedido_item_id,valor_centavos FROM pedido_pagamento_alocacoes ORDER BY id`).all()).results,
    [{pedido_item_id:1,valor_centavos:3},{pedido_item_id:1,valor_centavos:1}]);
});

test('migration 0021 preserves old data and accepts a refund through lineage',async t=>{
  const db=await bancoProducao(t);
  await aplicarB5(db);await aplicarEstoquePorItem(db);await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);await aplicarTrocaPorItem(db);await aplicarRefundPixMpRecuperavel(db);
  await db.batch([
    db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO' WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado) VALUES(100,1,2,'B',1,5000,5000,'ATIVO','BAIXADO')`),
    db.prepare(`INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,produto_destino_id,quantidade_destino,
      preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,
      estoque_acao_origem,status,snapshot_financeiro) VALUES(1,1,1,100,2,1,5000,5000,5000,0,'ZERO','NAO_REPOR','AGUARDANDO_COBRANCA','{}')`),
  ]);
  const preservedTables=['pedidos','pedido_itens','pedido_pagamentos','pedido_pagamento_alocacoes',
    'pedido_reembolsos','pedido_item_cancelamentos','pedido_item_trocas','pedido_operacoes',
    'pedido_reembolso_pix_mp_intencoes'];
  const before=Object.fromEntries(await Promise.all(preservedTables.map(async table=>
    [table,(await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results])));
  await aplicarCoberturaFinanceiraLinhagem(db);
  for(const table of preservedTables){
    assert.deepEqual((await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results,before[table]);
  }
  await db.batch([
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,valor_item_centavos,
      valor_pago_associado_centavos,valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro)
      VALUES(1,1,100,'AGUARDANDO_REEMBOLSO',5000,5000,500,'NAO_REPOR','{}')`),
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key)
      VALUES(1,1,1,'MANUAL','PIX_MP',500,'REEMBOLSADO','ancestral')`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos)
      VALUES(1,1,1,500)`),
  ]);
  assert.deepEqual((await db.prepare(`SELECT * FROM pedido_pagamento_alocacoes ORDER BY id`).all()).results,
    before.pedido_pagamento_alocacoes);
  await db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key)
    VALUES(2,1,1,'MANUAL','PIX_MP',4600,'REEMBOLSADO','over-allocation')`).run();
  await assert.rejects(db.prepare(`INSERT INTO pedido_item_troca_reembolso_alocacoes(
    reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos) VALUES(2,1,1,4600)`).run(),
  /troca_reembolso_alocacao_inconsistente/);
  await db.prepare(`UPDATE pedido_item_trocas SET status='CONCLUIDA' WHERE id=1`).run();
  await assert.rejects(db.prepare(`UPDATE pedido_item_trocas SET status='FALHOU' WHERE id=1`).run(),/reembolso_linhagem_inconsistente/);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pragma_foreign_key_check`).first()).n,0);
});
