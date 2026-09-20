import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture, state } from './helpers/b3.mjs';

// GET /api/admin/pedidos/:id/historico — leitura pura, sem efeito colateral.
// Cobre: exige sessão; nenhuma escrita ocorre ao consultar; item adicionado
// não duplica quando é destino de troca; troca e cancelamento concluídos
// geram os dois eventos (solicitado + concluído); refund atribuído a um
// cancelamento/troca não aparece de novo como evento avulso; refund sem
// atribuição (legado) aparece como evento avulso; ordenação mais recente
// primeiro.

const env = db => ({ DB: db });

const buscar = (db, session) =>
  app.adminHistorico.onRequestGet({
    env: env(db), params: { id: '1' },
    request: new Request('https://local.test/api/admin/pedidos/1/historico', {
      headers: session ? { Cookie: session.cookie.split(';')[0] } : {},
    }),
  });

async function montarCenario(t) {
  const db = await fixture(t, { ledger: false, reserve: 'ATIVA' });
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL', status_pedido='NOVO', status_comanda='ABERTA',
      valor_total_centavos=1500, status_pagamento='PAGO' WHERE id=1`),
    // Item 1: comprado no checkout original, depois cancelado com refund
    // atribuído — cobre CANCELAMENTO_SOLICITADO/CONCLUIDO e PAGAMENTO.
    db.prepare(`UPDATE pedido_itens SET produto_nome='Bolo', quantidade=1, valor_unitario_centavos=1500,
      valor_total_centavos=1500, status_item='CANCELADO', estoque_estado='REPOSTO',
      criado_em='2026-01-01 10:00:00' WHERE id=1`),
    db.prepare(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
      VALUES(2,'Operadora','operadora','op@example.invalid','x','ADMIN')`),
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em,registrado_por_usuario_id)
      VALUES(2,1,'DINHEIRO','ADMIN',1500,'PAGO','pag-2','2026-01-01 10:05:00',2)`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,2,1,1500)`),
    db.prepare(`INSERT INTO pedido_item_cancelamentos(
      id,pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,
      valor_reembolso_necessario_centavos,estoque_acao,motivo,registrado_por_usuario_id,snapshot_financeiro,
      criado_em,concluido_em
    ) VALUES(1,1,1,'CONCLUIDO',1500,1500,1500,'REPOR','cliente desistiu',2,'{}','2026-01-01 11:00:00','2026-01-01 11:05:00')`),
    db.prepare(`INSERT INTO pedido_reembolsos(
      id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,registrado_por_usuario_id,
      criado_em,concluido_em
    ) VALUES(1,1,2,'MANUAL','DINHEIRO',1500,'REEMBOLSADO','ref-1',2,'2026-01-01 11:05:00','2026-01-01 11:05:00')`),
    db.prepare(`INSERT INTO pedido_reembolso_alocacoes(id,reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos,criado_em)
      VALUES(1,1,2,1,1500,'2026-01-01 11:05:00')`),
    // Item 3: adicionado pelo admin depois, vira origem de uma troca ZERO
    // pra item 4 (destino) — cobre ITEM_ADICIONADO, TROCA_SOLICITADA e
    // TROCA_CONCLUIDA, e a supressão do ITEM_ADICIONADO do destino.
    db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
      VALUES(2,'Torta', 'BOLO',1200,10,0,1,1)`),
    db.prepare(`INSERT INTO pedido_itens(
      id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,
      status_item,estoque_estado,adicionado_em,adicionado_por_usuario_id,criado_em
    ) VALUES(3,1,2,'Torta',1,1200,1200,'CANCELADO','REPOSTO','2026-01-02 09:00:00',2,'2026-01-02 09:00:00')`),
    db.prepare(`INSERT INTO pedido_itens(
      id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,
      status_item,estoque_estado,criado_em
    ) VALUES(4,1,2,'Torta',1,1200,1200,'ATIVO','BAIXADO','2026-01-02 09:00:00')`),
    db.prepare(`INSERT INTO pedido_item_trocas(
      id,pedido_id,item_origem_id,item_destino_id,produto_destino_id,quantidade_destino,
      preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,diferenca_centavos,
      tipo_diferenca,estoque_acao_origem,status,motivo,registrado_por_usuario_id,snapshot_financeiro,
      criado_em,concluido_em
    ) VALUES(1,1,3,4,2,1,1200,1200,1200,0,'ZERO','REPOR','CONCLUIDA','trocou de sabor',2,'{}',
      '2026-01-02 10:00:00','2026-01-02 10:05:00')`),
    // Reembolso legado sem atribuição — deve aparecer como evento avulso.
    db.prepare(`INSERT INTO pedido_reembolsos(
      id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,motivo,
      criado_em,concluido_em
    ) VALUES(2,1,2,'MANUAL','DINHEIRO',100,'REEMBOLSADO','ref-2','cortesia','2026-01-03 08:00:00','2026-01-03 08:00:00')`),
  ]);
  return db;
}

test('histórico exige sessão', async t => {
  const db = await montarCenario(t);
  const response = await buscar(db, null);
  assert.equal(response.status, 401);
});

test('histórico é somente leitura: nenhuma linha muda ao consultar', async t => {
  const db = await montarCenario(t);
  const session = await app.auth.createSession(db, 1);
  const antes = await state(db);
  const response = await buscar(db, session);
  assert.equal(response.status, 200);
  const depois = await state(db);
  assert.deepEqual(depois, antes, 'GET não grava nada');
});

test('monta os eventos esperados, sem duplicar item adicionado do destino da troca', async t => {
  const db = await montarCenario(t);
  const session = await app.auth.createSession(db, 1);
  const body = await (await buscar(db, session)).json();
  const tipos = body.eventos.map((e) => e.tipo);

  // Item 1 (Bolo, comprado no checkout) e item 3 (Torta, origem da troca)
  // geram evento — item 4 (destino da troca) não, pra não duplicar com o
  // próprio evento de troca.
  const itensAdicionados = body.eventos.filter((e) => e.tipo === 'ITEM_ADICIONADO');
  assert.equal(itensAdicionados.length, 2);
  assert.deepEqual(itensAdicionados.map((e) => e.item.id).sort(), [1, 3]);
  assert.equal(tipos.filter((tp) => tp === 'TROCA_SOLICITADA').length, 1);
  assert.equal(tipos.filter((tp) => tp === 'TROCA_CONCLUIDA').length, 1);
  assert.equal(tipos.filter((tp) => tp === 'CANCELAMENTO_SOLICITADO').length, 1);
  assert.equal(tipos.filter((tp) => tp === 'CANCELAMENTO_CONCLUIDO').length, 1);
  assert.equal(tipos.filter((tp) => tp === 'PAGAMENTO').length, 1);

  const itemAdicionado = itensAdicionados.find((e) => e.item.id === 3);
  assert.equal(itemAdicionado.item.nome, 'Torta');
  assert.equal(itemAdicionado.usuario, 'Operadora');

  const trocaConcluida = body.eventos.find((e) => e.tipo === 'TROCA_CONCLUIDA');
  assert.equal(trocaConcluida.itemOrigem.nome, 'Torta');
  assert.equal(trocaConcluida.itemDestino.nome, 'Torta');
  assert.equal(trocaConcluida.itemDestino.estoqueEstado, 'BAIXADO');
  assert.equal(trocaConcluida.referenciaId, 3, 'referência é o item origem, pra abrir a troca por ele');

  const cancConcluido = body.eventos.find((e) => e.tipo === 'CANCELAMENTO_CONCLUIDO');
  assert.equal(cancConcluido.item.nome, 'Bolo');
  assert.equal(cancConcluido.valorReembolsoCentavos, 1500);
  assert.deepEqual(cancConcluido.metodosReembolso, ['DINHEIRO']);

  const pagamento = body.eventos.find((e) => e.tipo === 'PAGAMENTO');
  assert.equal(pagamento.metodo, 'DINHEIRO');
  assert.equal(pagamento.valorCentavos, 1500);
});

test('refund atribuído não duplica como evento avulso; refund legado sem atribuição aparece', async t => {
  const db = await montarCenario(t);
  const session = await app.auth.createSession(db, 1);
  const body = await (await buscar(db, session)).json();
  const reembolsosAvulsos = body.eventos.filter((e) => e.tipo === 'REEMBOLSO');

  assert.equal(reembolsosAvulsos.length, 1, 'só o legado sem atribuição vira evento avulso');
  assert.equal(reembolsosAvulsos[0].valorReembolsoCentavos, 100);
  assert.equal(reembolsosAvulsos[0].motivo, 'cortesia');
});

test('eventos vêm ordenados do mais recente para o mais antigo', async t => {
  const db = await montarCenario(t);
  const session = await app.auth.createSession(db, 1);
  const body = await (await buscar(db, session)).json();
  const datas = body.eventos.map((e) => e.data);
  const ordenadas = [...datas].sort().reverse();
  assert.deepEqual(datas, ordenadas);
});
