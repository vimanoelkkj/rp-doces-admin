import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture } from './helpers/b3.mjs';
import { bancoProducao, aplicarB5, aplicarEstoquePorItem, aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem, aplicarTrocaPorItem } from './helpers/b5.mjs';

async function setup(t,{state='RESERVADO',paid=0,method='DINHEIRO',value=1500}={}){
  const db=await fixture(t,{ledger:false,reserve:'ATIVA'});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL',status_pedido='NOVO',status_comanda='ABERTA',
      valor_total_centavos=?,status_pagamento=? WHERE id=1`).bind(value,paid?'PAGO':'PENDENTE'),
    db.prepare(`UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=?,
      valor_total_centavos=?,status_item='ATIVO',estoque_estado=?,estoque_baixado_em=CASE WHEN ?='BAIXADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
      estoque_reservado_em=CASE WHEN ?='RESERVADO' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=1`)
      .bind(value,value,state,state,state),
    db.prepare(`UPDATE produtos SET nome='A',preco_centavos=?,estoque=10,estoque_reservado=? WHERE id=1`)
      .bind(value,state==='RESERVADO'?1:0),
  ]);
  if(paid){await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(1,1,?,'ADMIN',?,'PAGO','paid-1',CURRENT_TIMESTAMP)`).bind(method,paid),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,?)`).bind(paid),
  ]);}
  return db;
}

async function addB(db,price=2000,stock=10){
  await db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
    VALUES(2,'B','BOLO',?,?,0,1,1)`).bind(price,stock).run();
}

async function cancel(db,{action='LIBERAR_RESERVA',key='cancel-operation-01'}={}){
  const preview=await app.itemCancellationPreview.getItemCancellationPreview(db,1,1);
  const result=await app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:1,usuarioId:1,operationKey:key,
    motivo:'cliente pediu',estoqueAcao:action,previewFingerprint:preview.previewFingerprint});
  return {preview,result};
}

async function exchange(db,{price=2000,action='LIBERAR_RESERVA',key='exchange-operation-01'}={}){
  const input={pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,precoEsperadoCentavos:price,estoqueAcaoOrigem:action};
  const preview=await app.itemExchange.getItemExchangePreview(db,input);
  const result=await app.itemExchange.createItemExchange(db,{...input,usuarioId:1,operationKey:key,motivo:'troca',previewFingerprint:preview.previewFingerprint});
  return {preview,result};
}

test('cancelamento não pago conclui, libera reserva uma vez e retry é replay',async t=>{
  const db=await setup(t);const {preview,result:first}=await cancel(db);assert.equal(first.ok,true);assert.equal(first.cancelamento.status,'CONCLUIDO');
  const again=await app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:1,usuarioId:1,operationKey:'cancel-operation-01',
    motivo:'cliente pediu',estoqueAcao:'LIBERAR_RESERVA',previewFingerprint:preview.previewFingerprint});
  assert.equal(again.ok,true);assert.equal(again.replay,true);
  const item=await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=1`).first();
  assert.deepEqual(item,{status_item:'CANCELADO',estoque_estado:'LIBERADO'});
  assert.equal((await db.prepare(`SELECT estoque_reservado FROM produtos WHERE id=1`).first()).estoque_reservado,0);
  assert.equal((await db.prepare(`SELECT valor_total_centavos FROM pedidos WHERE id=1`).first()).valor_total_centavos,0);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_cancelamentos`).first()).n,1);
});

test('cancelamento BAIXADO respeita NAO_REPOR e REPOR idempotente',async t=>{
  for(const [action,expected] of [['NAO_REPOR',10],['REPOR',11]]){
    const db=await setup(t,{state:'BAIXADO'});const {preview,result}=await cancel(db,{action,key:`cancel-${action}-01`});
    assert.equal(result.ok,true);assert.equal((await db.prepare(`SELECT estoque FROM produtos WHERE id=1`).first()).estoque,expected);
    const retry=await app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:1,usuarioId:1,operationKey:`cancel-${action}-01`,
      motivo:'cliente pediu',estoqueAcao:action,previewFingerprint:preview.previewFingerprint});assert.equal(retry.ok,true);
    assert.equal((await db.prepare(`SELECT estoque FROM produtos WHERE id=1`).first()).estoque,expected);
  }
});

test('cancelamento pago manual aguarda refund, preserva total e conclui após perna exata',async t=>{
  const db=await setup(t,{paid:1500});const {result:created}=await cancel(db);assert.equal(created.cancelamento.status,'AGUARDANDO_REEMBOLSO');
  assert.equal((await db.prepare(`SELECT valor_total_centavos FROM pedidos WHERE id=1`).first()).valor_total_centavos,1500);
  const leg=created.cancelamento.pernasPendentes[0];
  const refunded=await app.itemCancellation.confirmCancellationRefund(db,{pedidoId:1,cancellationId:created.cancelamento.id,usuarioId:1,
    operationKey:'cancel-refund-01',pagamentoId:leg.pagamentoId,pagamentoAlocacaoId:leg.pagamentoAlocacaoId,valorCentavos:leg.valorCentavos,confirmacao:true});
  assert.equal(refunded.ok,true);assert.equal(refunded.cancelamento.status,'CONCLUIDO');
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_alocacoes`).first()).n,1);
  const replay=await app.itemCancellation.confirmCancellationRefund(db,{pedidoId:1,cancellationId:created.cancelamento.id,usuarioId:1,
    operationKey:'cancel-refund-01',pagamentoId:leg.pagamentoId,pagamentoAlocacaoId:leg.pagamentoAlocacaoId,valorCentavos:leg.valorCentavos,confirmacao:true});
  assert.equal(replay.ok,true);assert.equal(replay.replay,true);assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n,1);
});

test('cancelamento PIX_MP aguarda sem chamada remota',async t=>{
  const db=await setup(t,{paid:1500,method:'PIX_MP'});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('não deveria chamar');});
  const {result}=await cancel(db);assert.equal(result.cancelamento.status,'AGUARDANDO_REEMBOLSO');
  const leg=result.cancelamento.pernasPendentes[0];assert.equal(leg.confirmacaoManualPermitida,false);assert.equal(calls,0);
});

test('Pix vivo e preview obsoleto bloqueiam cancelamento sem efeito',async t=>{
  const db=await setup(t);const preview=await app.itemCancellationPreview.getItemCancellationPreview(db,1,1);
  await db.prepare(`INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key)
    VALUES(1,'PIX_MP','ADMIN',100,'PENDENTE','pending-pix')`).run();
  const result=await app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:1,usuarioId:1,operationKey:'cancel-stale-01',motivo:'',
    estoqueAcao:'LIBERAR_RESERVA',previewFingerprint:preview.previewFingerprint});
  assert.equal(result.ok,false);assert.ok(['PREVIEW_OBSOLETO','PIX_PENDENTE'].includes(result.erro));
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_cancelamentos`).first()).n,0);
});

test('troca 1500→2000 conclui estrutura, total 2000, líquido 1500 e saldo 500',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,2000);const {result}=await exchange(db);assert.equal(result.ok,true);
  assert.equal(result.troca.status,'AGUARDANDO_COBRANCA');
  const pedido=await db.prepare(`SELECT valor_total_centavos,status_pagamento FROM pedidos WHERE id=1`).first();
  assert.deepEqual(pedido,{valor_total_centavos:2000,status_pagamento:'PARCIAL'});
  assert.equal((await app.ledger.getFinanceiroPedido(db,1)).saldoCentavos,500);
  assert.equal(await app.pix.getCapacidadeCobravel(db,1),500);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_pagamentos`).first()).n,1);
});

test('troca ZERO de origem BAIXADO com REPOR mantém PAGO e baixa o destino',async t=>{
  const db=await setup(t,{state:'BAIXADO',paid:1,value:1});await addB(db,1);const {result}=await exchange(db,{price:1,action:'REPOR'});
  assert.equal(result.ok,true);assert.equal(result.troca.status,'CONCLUIDA');
  const financeiro=await app.ledger.getFinanceiroPedido(db,1);assert.equal(financeiro.status,'PAGO');assert.equal(financeiro.saldoCentavos,0);
  const destination=await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=?`).bind(result.troca.itemDestinoId).first();
  assert.deepEqual(destination,{status_item:'ATIVO',estoque_estado:'BAIXADO'});
  assert.deepEqual(await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=1`).first(),
    {status_item:'CANCELADO',estoque_estado:'REPOSTO'});
  assert.equal((await db.prepare(`SELECT estoque FROM produtos WHERE id=1`).first()).estoque,11);
  assert.deepEqual(await db.prepare(`SELECT estoque,estoque_reservado FROM produtos WHERE id=2`).first(),{estoque:9,estoque_reservado:0});
});

test('destino ATIVO de troca concluída pode originar nova troca sem alterar o histórico anterior',async t=>{
  const db=await setup(t,{state:'BAIXADO',paid:1500});await addB(db,1500);
  const first=(await exchange(db,{price:1500,action:'NAO_REPOR',key:'exchange-sequential-first'})).result;
  assert.equal(first.ok,true);assert.equal(first.troca.status,'CONCLUIDA');
  const firstBefore=await db.prepare(`SELECT * FROM pedido_item_trocas WHERE id=?`).bind(first.troca.id).first();
  await db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
    VALUES(3,'C','BOLO',1500,10,0,1,1)`).run();
  const input={pedidoId:1,itemId:first.troca.itemDestinoId,produtoDestinoId:3,quantidadeDestino:1,
    precoEsperadoCentavos:1500,estoqueAcaoOrigem:'NAO_REPOR'};
  const preview=await app.itemExchange.getItemExchangePreview(db,input);
  assert.equal(preview.trocaExecutavel,true);
  const second=await app.itemExchange.createItemExchange(db,{...input,usuarioId:1,motivo:'segunda troca',
    operationKey:'exchange-sequential-second',previewFingerprint:preview.previewFingerprint});
  assert.equal(second.ok,true);assert.equal(second.troca.status,'CONCLUIDA');
  assert.equal(second.troca.itemOrigemId,first.troca.itemDestinoId);
  assert.deepEqual(await db.prepare(`SELECT * FROM pedido_item_trocas WHERE id=?`).bind(first.troca.id).first(),firstBefore);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,2);
});

test('destino ATIVO de troca concluída pode ser cancelado sem alterar o histórico anterior',async t=>{
  const db=await setup(t,{state:'BAIXADO',paid:1,value:1});await addB(db,1);
  const first=(await exchange(db,{price:1,action:'NAO_REPOR',key:'exchange-before-destination-cancel'})).result;
  assert.equal(first.ok,true);assert.equal(first.troca.status,'CONCLUIDA');
  const firstBefore=await db.prepare(`SELECT * FROM pedido_item_trocas WHERE id=?`).bind(first.troca.id).first();
  const allocationBefore=await db.prepare(`SELECT * FROM pedido_pagamento_alocacoes WHERE id=1`).first();
  const preview=await app.itemCancellationPreview.getItemCancellationPreview(db,1,first.troca.itemDestinoId);
  const cancelled=await app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:first.troca.itemDestinoId,
    usuarioId:1,operationKey:'cancel-exchange-destination',motivo:'cancelar destino',estoqueAcao:'NAO_REPOR',
    previewFingerprint:preview.previewFingerprint});
  assert.equal(cancelled.ok,true);assert.equal(cancelled.cancelamento.status,'AGUARDANDO_REEMBOLSO');
  const leg=cancelled.cancelamento.pernasPendentes[0];
  const refunded=await app.itemCancellation.confirmCancellationRefund(db,{pedidoId:1,
    cancellationId:cancelled.cancelamento.id,usuarioId:1,operationKey:'refund-exchange-destination',
    pagamentoId:leg.pagamentoId,pagamentoAlocacaoId:leg.pagamentoAlocacaoId,
    valorCentavos:leg.valorCentavos,confirmacao:true});
  assert.equal(refunded.ok,true);assert.equal(refunded.cancelamento.status,'CONCLUIDO');
  assert.deepEqual(await db.prepare(`SELECT * FROM pedido_item_trocas WHERE id=?`).bind(first.troca.id).first(),firstBefore);
  assert.deepEqual(await db.prepare(`SELECT * FROM pedido_pagamento_alocacoes WHERE id=1`).first(),allocationBefore);
  assert.deepEqual(await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=?`)
    .bind(first.troca.itemDestinoId).first(),{status_item:'CANCELADO',estoque_estado:'BAIXADO'});
});

test('recovery repara troca CONCLUIDA antiga ainda RESERVADA e retry não repete a baixa',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,1500);const {result}=await exchange(db,{price:1500});
  await db.batch([
    db.prepare(`UPDATE pedido_itens SET estoque_estado='RESERVADO',estoque_baixado_em=NULL WHERE id=?`).bind(result.troca.itemDestinoId),
    db.prepare(`UPDATE produtos SET estoque=estoque+1,estoque_reservado=estoque_reservado+1 WHERE id=2`),
  ]);
  await app.itemExchange.reconcileExchangeCharges(db,1);
  const recovered=await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=?`).bind(result.troca.itemDestinoId).first();
  assert.deepEqual(recovered,{status_item:'ATIVO',estoque_estado:'BAIXADO'});
  const first=await db.prepare(`SELECT estoque,estoque_reservado FROM produtos WHERE id=2`).first();
  assert.deepEqual(first,{estoque:9,estoque_reservado:0});
  await app.itemExchange.reconcileExchangeCharges(db,1);
  assert.deepEqual(await db.prepare(`SELECT estoque,estoque_reservado FROM produtos WHERE id=2`).first(),first);
});

test('troca 1500→1200 propõe e registra somente 300, concluindo atomicamente',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,1200);
  const originalPayment=await db.prepare(`SELECT * FROM pedido_pagamentos WHERE id=1`).first();
  const originalAllocation=await db.prepare(`SELECT * FROM pedido_pagamento_alocacoes WHERE id=1`).first();
  const {preview,result}=await exchange(db,{price:1200});
  assert.equal(preview.financeiro.excessoProjetadoCentavos,300);assert.equal(preview.refundsPropostos[0].valorCentavos,300);
  assert.equal(result.troca.status,'AGUARDANDO_REEMBOLSO');
  assert.deepEqual((await db.prepare(`SELECT status_item FROM pedido_itens ORDER BY id`).all()).results.map(x=>x.status_item),['ATIVO','TROCA_PENDENTE']);
  assert.equal((await db.prepare(`SELECT valor_total_centavos FROM pedidos WHERE id=1`).first()).valor_total_centavos,1500);
  const leg=result.troca.refundsPendentes[0];const refunded=await app.itemExchange.confirmExchangeRefund(db,{pedidoId:1,exchangeId:result.troca.id,
    usuarioId:1,operationKey:'exchange-refund-01',pagamentoId:leg.pagamentoId,pagamentoAlocacaoId:leg.pagamentoAlocacaoId,
    valorCentavos:leg.valorCentavos,confirmacao:true});
  assert.equal(refunded.ok,true);assert.equal(refunded.troca.status,'CONCLUIDA');
  assert.deepEqual((await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens ORDER BY id`).all()).results,
    [{status_item:'CANCELADO',estoque_estado:'LIBERADO'},{status_item:'ATIVO',estoque_estado:'BAIXADO'}]);
  assert.deepEqual(await db.prepare(`SELECT estoque,estoque_reservado FROM produtos WHERE id=2`).first(),{estoque:9,estoque_reservado:0});
  assert.deepEqual(await db.prepare(`SELECT valor_total_centavos,status_pagamento FROM pedidos WHERE id=1`).first(),{valor_total_centavos:1200,status_pagamento:'PAGO'});
  assert.deepEqual(await db.prepare(`SELECT * FROM pedido_pagamentos WHERE id=1`).first(),originalPayment);
  assert.deepEqual(await db.prepare(`SELECT * FROM pedido_pagamento_alocacoes WHERE id=1`).first(),originalAllocation);
});

test('LIFO usa Dinheiro recente antes de Pix MP e deixa perna remota pendente',async t=>{
  const db=await setup(t,{paid:0});await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,1,'PIX_MP','ADMIN',1000,'PAGO','pix-paid')`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,1,1000)`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(2,1,'DINHEIRO','ADMIN',500,'PAGO','cash-paid')`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,2,1,500)`),
    db.prepare(`UPDATE pedidos SET status_pagamento='PAGO' WHERE id=1`),
  ]);await addB(db,800);const {preview,result}=await exchange(db,{price:800});
  assert.deepEqual(preview.refundsPropostos.map(x=>[x.metodo,x.valorCentavos]),[['DINHEIRO',500],['PIX_MP',200]]);
  const cash=result.troca.refundsPendentes.find(x=>x.metodo==='DINHEIRO');
  const refunded=await app.itemExchange.confirmExchangeRefund(db,{pedidoId:1,exchangeId:result.troca.id,usuarioId:1,operationKey:'lifo-refund-01',
    pagamentoId:cash.pagamentoId,pagamentoAlocacaoId:cash.pagamentoAlocacaoId,valorCentavos:cash.valorCentavos,confirmacao:true});
  assert.equal(refunded.troca.status,'AGUARDANDO_REEMBOLSO');assert.deepEqual(refunded.troca.refundsPendentes.map(x=>[x.metodo,x.valorCentavos]),[['PIX_MP',200]]);
  assert.equal((await db.prepare(`SELECT status_item FROM pedido_itens WHERE id=1`).first()).status_item,'ATIVO');
});

test('troca é idempotente: uma entidade, um destino e uma reserva',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,2000);const first=await exchange(db);
  const second={result:await app.itemExchange.createItemExchange(db,{pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,
    precoEsperadoCentavos:2000,estoqueAcaoOrigem:'LIBERAR_RESERVA',usuarioId:1,operationKey:'exchange-operation-01',
    motivo:'troca',previewFingerprint:first.preview.previewFingerprint})};
  assert.equal(first.result.ok,true);assert.equal(second.result.ok,true);assert.equal(second.result.replay,true);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_itens WHERE produto_id=2`).first()).n,1);
  assert.equal((await db.prepare(`SELECT estoque_reservado FROM produtos WHERE id=2`).first()).estoque_reservado,1);
});

test('estoque insuficiente e preço alterado não produzem efeito',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,2000,0);
  const input={pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,precoEsperadoCentavos:2000,estoqueAcaoOrigem:'LIBERAR_RESERVA'};
  const preview=await app.itemExchange.getItemExchangePreview(db,input);assert.equal(preview.trocaExecutavel,false);
  await db.prepare(`UPDATE produtos SET estoque=10,disponivel=1 WHERE id=2`).run();const fresh=await app.itemExchange.getItemExchangePreview(db,input);
  await db.prepare(`UPDATE produtos SET preco_centavos=2100 WHERE id=2`).run();
  const result=await app.itemExchange.createItemExchange(db,{...input,usuarioId:1,operationKey:'stale-exchange-01',previewFingerprint:fresh.previewFingerprint});
  assert.equal(result.ok,false);assert.equal(result.erro,'PRECO_ALTERADO');
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,0);
});

test('A to B expensive then C cheaper refunds direct and ancestral allocations without moving them',async t=>{
  const db=await setup(t,{state:'BAIXADO',paid:1500});await addB(db,2000);
  const first=(await exchange(db,{price:2000,action:'NAO_REPOR',key:'lineage-expensive-first'})).result;
  assert.equal(first.troca.status,'AGUARDANDO_COBRANCA');
  const payment=await app.ledger.registerAdminPayment(db,{pedidoId:1,metodo:'DINHEIRO',valorCentavos:500,
    usuarioId:1,operationKey:'lineage-difference-payment'});
  assert.equal(payment.ok,true);
  assert.equal((await db.prepare(`SELECT status FROM pedido_item_trocas WHERE id=?`).bind(first.troca.id).first()).status,'CONCLUIDA');
  await db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
    VALUES(3,'C','BOLO',1200,10,0,1,1)`).run();
  const input={pedidoId:1,itemId:first.troca.itemDestinoId,produtoDestinoId:3,quantidadeDestino:1,
    precoEsperadoCentavos:1200,estoqueAcaoOrigem:'NAO_REPOR'};
  const preview=await app.itemExchange.getItemExchangePreview(db,input);
  assert.deepEqual(preview.refundsPropostos.map(x=>[x.pagamentoAlocacaoId,x.valorCentavos]),[[2,500],[1,300]]);
  const second=await app.itemExchange.createItemExchange(db,{...input,usuarioId:1,motivo:'cheaper',
    operationKey:'lineage-cheaper-second',previewFingerprint:preview.previewFingerprint});
  assert.equal(second.ok,true);let current=second.troca;
  for(let index=0;current.refundsPendentes.length>0;index++){
    const leg=current.refundsPendentes[0];
    const result=await app.itemExchange.confirmExchangeRefund(db,{pedidoId:1,exchangeId:current.id,usuarioId:1,
      operationKey:`lineage-cheaper-refund-${index}`,pagamentoId:leg.pagamentoId,
      pagamentoAlocacaoId:leg.pagamentoAlocacaoId,valorCentavos:leg.valorCentavos,confirmacao:true});
    assert.equal(result.ok,true);current=result.troca;
  }
  assert.equal(current.status,'CONCLUIDA');
  assert.deepEqual((await db.prepare(`SELECT id,pedido_item_id,valor_centavos FROM pedido_pagamento_alocacoes ORDER BY id`).all()).results,
    [{id:1,pedido_item_id:1,valor_centavos:1500},{id:2,pedido_item_id:first.troca.itemDestinoId,valor_centavos:500}]);
  assert.deepEqual((await db.prepare(`SELECT item_origem_id,item_destino_id,status FROM pedido_item_trocas ORDER BY id`).all()).results,
    [{item_origem_id:1,item_destino_id:first.troca.itemDestinoId,status:'CONCLUIDA'},
     {item_origem_id:first.troca.itemDestinoId,item_destino_id:current.itemDestinoId,status:'CONCLUIDA'}]);
  assert.equal((await db.prepare(`SELECT SUM(valor_centavos) total FROM pedido_reembolsos WHERE status='REEMBOLSADO'`).first()).total,800);
});

test('TROCA_PENDENTE fica fora do waterfall e nunca é baixado pela reconciliação',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,1200);const {result}=await exchange(db,{price:1200});
  const balances=await app.ledger.getItensComSaldo(db,1);assert.deepEqual(balances.map(x=>x.itemId),[1]);
  await app.stock.baixarEstoquePedido(db,1);
  const destination=await db.prepare(`SELECT status_item,estoque_estado FROM pedido_itens WHERE id=?`).bind(result.troca.itemDestinoId).first();
  assert.deepEqual(destination,{status_item:'TROCA_PENDENTE',estoque_estado:'RESERVADO'});
});

test('duas abas criam um único cancelamento ou uma única troca efetiva',async t=>{
  const cancelDb=await setup(t);const cp=await app.itemCancellationPreview.getItemCancellationPreview(cancelDb,1,1);
  const cancelParams={pedidoId:1,itemId:1,usuarioId:1,motivo:'concorrente',estoqueAcao:'LIBERAR_RESERVA',previewFingerprint:cp.previewFingerprint};
  const cancelResults=await Promise.all([
    app.itemCancellation.createItemCancellation(cancelDb,{...cancelParams,operationKey:'cancel-tab-one'}),
    app.itemCancellation.createItemCancellation(cancelDb,{...cancelParams,operationKey:'cancel-tab-two'}),
  ]);assert.equal(cancelResults.filter(x=>x.ok).length,1);assert.equal((await cancelDb.prepare(`SELECT COUNT(*) n FROM pedido_item_cancelamentos`).first()).n,1);

  const exchangeDb=await setup(t,{paid:1500});await addB(exchangeDb,2000);const input={pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,precoEsperadoCentavos:2000,estoqueAcaoOrigem:'LIBERAR_RESERVA'};
  const ep=await app.itemExchange.getItemExchangePreview(exchangeDb,input);const exchangeResults=await Promise.all([
    app.itemExchange.createItemExchange(exchangeDb,{...input,usuarioId:1,motivo:'',previewFingerprint:ep.previewFingerprint,operationKey:'exchange-tab-one'}),
    app.itemExchange.createItemExchange(exchangeDb,{...input,usuarioId:1,motivo:'',previewFingerprint:ep.previewFingerprint,operationKey:'exchange-tab-two'}),
  ]);assert.equal(exchangeResults.filter(x=>x.ok).length,1);assert.equal((await exchangeDb.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,1);
  assert.equal((await exchangeDb.prepare(`SELECT COUNT(*) n FROM pedido_itens WHERE produto_id=2`).first()).n,1);
});

test('duas abas trocando a mesma origem por destinos diferentes admitem uma única verdade',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,2000);
  await db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
    VALUES(3,'C','BOLO',1800,10,0,1,1)`).run();
  const first={pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,precoEsperadoCentavos:2000,estoqueAcaoOrigem:'LIBERAR_RESERVA'};
  const second={...first,produtoDestinoId:3,precoEsperadoCentavos:1800};
  const [firstPreview,secondPreview]=await Promise.all([
    app.itemExchange.getItemExchangePreview(db,first),
    app.itemExchange.getItemExchangePreview(db,second),
  ]);
  const results=await Promise.all([
    app.itemExchange.createItemExchange(db,{...first,usuarioId:1,motivo:'aba B',previewFingerprint:firstPreview.previewFingerprint,operationKey:'exchange-destination-b'}),
    app.itemExchange.createItemExchange(db,{...second,usuarioId:1,motivo:'aba C',previewFingerprint:secondPreview.previewFingerprint,operationKey:'exchange-destination-c'}),
  ]);
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_itens WHERE status_item IN ('ATIVO','TROCA_PENDENTE') AND id<>1`).first()).n,1);
  assert.equal((await db.prepare(`SELECT SUM(estoque_reservado) n FROM produtos WHERE id IN (2,3)`).first()).n,1);
});

test('cancelamento e troca concorrentes da mesma origem admitem uma única operação efetiva',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,1200);
  const cancellationPreview=await app.itemCancellationPreview.getItemCancellationPreview(db,1,1);
  const exchangeInput={pedidoId:1,itemId:1,produtoDestinoId:2,quantidadeDestino:1,precoEsperadoCentavos:1200,estoqueAcaoOrigem:'LIBERAR_RESERVA'};
  const exchangePreview=await app.itemExchange.getItemExchangePreview(db,exchangeInput);
  const results=await Promise.all([
    app.itemCancellation.createItemCancellation(db,{pedidoId:1,itemId:1,usuarioId:1,motivo:'cancelar',estoqueAcao:'LIBERAR_RESERVA',previewFingerprint:cancellationPreview.previewFingerprint,operationKey:'cancel-versus-exchange'}),
    app.itemExchange.createItemExchange(db,{...exchangeInput,usuarioId:1,motivo:'trocar',previewFingerprint:exchangePreview.previewFingerprint,operationKey:'exchange-versus-cancel'}),
  ]);
  assert.equal(results.filter(result=>result.ok).length,1);
  const cancellations=(await db.prepare(`SELECT COUNT(*) n FROM pedido_item_cancelamentos WHERE status<>'FALHOU'`).first()).n;
  const exchanges=(await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas WHERE status<>'FALHOU'`).first()).n;
  assert.equal(cancellations+exchanges,1);
});

test('refund manual concorrente registra um único fato',async t=>{
  const db=await setup(t,{paid:1500});const {result:created}=await cancel(db);const leg=created.cancelamento.pernasPendentes[0];
  const base={pedidoId:1,cancellationId:created.cancelamento.id,usuarioId:1,pagamentoId:leg.pagamentoId,
    pagamentoAlocacaoId:leg.pagamentoAlocacaoId,valorCentavos:leg.valorCentavos,confirmacao:true};
  const results=await Promise.all([
    app.itemCancellation.confirmCancellationRefund(db,{...base,operationKey:'refund-tab-one'}),
    app.itemCancellation.confirmCancellationRefund(db,{...base,operationKey:'refund-tab-two'}),
  ]);assert.equal(results.filter(x=>x.ok).length,1);assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolsos`).first()).n,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_reembolso_alocacoes`).first()).n,1);
});

test('pagamento que chega durante troca pendente vira nova obrigação antes da conclusão',async t=>{
  const db=await setup(t,{paid:1500});await addB(db,1200);const {result}=await exchange(db,{price:1200});
  const oldLeg=result.troca.refundsPendentes[0];
  await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em)
      VALUES(2,1,'DINHEIRO','ADMIN',100,'PAGO','late-paid',CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,2,1,100)`),
  ]);
  const refunded=await app.itemExchange.confirmExchangeRefund(db,{pedidoId:1,exchangeId:result.troca.id,usuarioId:1,operationKey:'late-refund-old-leg',
    pagamentoId:oldLeg.pagamentoId,pagamentoAlocacaoId:oldLeg.pagamentoAlocacaoId,valorCentavos:oldLeg.valorCentavos,confirmacao:true});
  assert.equal(refunded.ok,true);assert.equal(refunded.troca.status,'AGUARDANDO_REEMBOLSO');
  assert.equal(refunded.troca.reembolsoPendenteCentavos,100);
  assert.equal((await db.prepare(`SELECT status_item FROM pedido_itens WHERE id=1`).first()).status_item,'ATIVO');
  assert.equal((await db.prepare(`SELECT valor_total_centavos FROM pedidos WHERE id=1`).first()).valor_total_centavos,1500);
});

test('migration 0019 preserva itens, FKs, timestamps, alocações e estados existentes',async t=>{
  const db=await bancoProducao(t);await aplicarB5(db);await aplicarEstoquePorItem(db);await aplicarOperacaoPorItem(db);await aplicarCancelamentoPorItem(db);
  await db.batch([
    db.prepare(`INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,criado_em,atualizado_em,concluido_em)
      VALUES(77,1,1,'MANUAL','PIX_MP',100,'REEMBOLSADO','migration-refund','2025-01-01','2025-01-02','2025-01-02')`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,
      valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro,criado_em)
      VALUES(77,1,1,'FALHOU',5000,5000,100,'NAO_REPOR','{}','2025-02-01')`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(id,reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos,criado_em)
      VALUES(77,77,1,77,100,'2025-02-02')`),
    db.prepare(`INSERT INTO pedido_operacoes(id,operation_key,tipo,escopo,fingerprint_versao,fingerprint,fase,pedido_id,pedido_item_id,pedido_item_cancelamento_id,criado_em,atualizado_em)
      VALUES(77,'migration-cancel-op','ITEM_CANCELAMENTO_ADMIN','ADMIN',1,'fp','CONCLUIDA',1,1,77,'2025-02-03','2025-02-04')`),
  ]);
  const tables=['pedido_itens','pedido_pagamento_alocacoes','pedido_item_cancelamentos','pedido_reembolso_alocacoes','pedido_operacoes'];
  const before=Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()).results])));
  await aplicarTrocaPorItem(db);
  for(const name of tables){const after=(await db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()).results;
    if(name==='pedido_itens')assert.deepEqual(after.map(({pedido_item_troca_id,...rest})=>rest),before[name]);
    else if(name==='pedido_operacoes')assert.deepEqual(after.map(({pedido_item_troca_id,...rest})=>rest),before[name]);
    else assert.deepEqual(after,before[name]);}
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pragma_foreign_key_check`).first()).n,0);
  assert.equal((await db.prepare(`SELECT COUNT(*) n FROM pedido_item_trocas`).first()).n,0);
});
