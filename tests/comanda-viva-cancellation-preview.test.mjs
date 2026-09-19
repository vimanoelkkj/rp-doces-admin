import test from 'node:test';
import assert from 'node:assert/strict';
import { app, fixture } from './helpers/b3.mjs';
import {
  bancoProducao,
  aplicarB5,
  aplicarEstoquePorItem,
  aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem,
} from './helpers/b5.mjs';

const env = db => ({DB: db});

async function preparar(t, {
  valor = 1500,
  estoqueEstado = 'RESERVADO',
  statusPedido = 'NOVO',
  statusComanda = 'ABERTA',
} = {}) {
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.batch([
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL', valor_total_centavos=?,
      status_pedido=?, status_comanda=?, status_pagamento='PENDENTE'
      WHERE id=1`).bind(valor, statusPedido, statusComanda),
    db.prepare(`UPDATE pedido_itens SET produto_nome='Item B', quantidade=1,
      valor_unitario_centavos=?, valor_total_centavos=?, status_item='ATIVO',
      estoque_estado=?, estoque_baixado_em=CASE WHEN ?='BAIXADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
      estoque_liberado_em=CASE WHEN ?='LIBERADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
      estoque_reposto_em=CASE WHEN ?='REPOSTO' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id=1`).bind(valor, valor, estoqueEstado, estoqueEstado, estoqueEstado, estoqueEstado),
    db.prepare('UPDATE produtos SET estoque_reservado=? WHERE id=1')
      .bind(estoqueEstado === 'RESERVADO' ? 1 : 0),
  ]);
  return {db, session: await app.auth.createSession(db, 1)};
}

async function pagamento(db, {
  id,
  valor,
  alocado = valor,
  metodo = 'DINHEIRO',
  status = 'PAGO',
  itemId = 1,
  allocationId = id,
} ) {
  await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(
      id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em
    ) VALUES(1 * ?,1,?,'ADMIN',?,?,?,CASE WHEN ?='PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END)`)
      .bind(id, metodo, valor, status, `preview-pag-${id}`, status),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
      id,pagamento_id,pedido_item_id,valor_centavos
    ) VALUES(?,?,?,?)`).bind(allocationId, id, itemId, alocado),
  ]);
}

async function preview(db, session, {pedidoId = 1, itemId = 1} = {}) {
  return app.adminItemCancellationPreview.onRequestGet({
    env: env(db),
    params: {id: String(pedidoId), itemId: String(itemId)},
    request: new Request(
      `https://local.test/api/admin/pedidos/${pedidoId}/itens/${itemId}/cancelamento-preview`,
      {headers: {Cookie: session.cookie.split(';')[0]}},
    ),
  });
}

const bodyOk = async (db, session, ids) => {
  const response = await preview(db, session, ids);
  assert.equal(response.status, 200);
  return response.json();
};

test('item não pago tem cobertura e refund zero', async t => {
  const {db, session} = await preparar(t);
  const body = await bodyOk(db, session);
  assert.deepEqual(body.financeiro, {
    valorItemCentavos: 1500,
    coberturaConfirmadaCentavos: 0,
    valorNaoPagoCentavos: 1500,
    reembolsoNecessarioCentavos: 0,
  });
  assert.deepEqual(body.pagamentos, []);
});

test('item parcialmente pago propõe somente os 800 confirmados', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 800});
  const body = await bodyOk(db, session);
  assert.equal(body.financeiro.coberturaConfirmadaCentavos, 800);
  assert.equal(body.financeiro.valorNaoPagoCentavos, 700);
  assert.equal(body.financeiro.reembolsoNecessarioCentavos, 800);
  assert.equal(body.pagamentos[0].reembolsoPropostoCentavos, 800);
});

test('item totalmente pago propõe refund integral', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 1500});
  const body = await bodyOk(db, session);
  assert.equal(body.financeiro.coberturaConfirmadaCentavos, 1500);
  assert.equal(body.financeiro.valorNaoPagoCentavos, 0);
  assert.equal(body.financeiro.reembolsoNecessarioCentavos, 1500);
});

test('dois pagamentos preservam ids, alocações, métodos e ordem determinística', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 11, valor: 500, metodo: 'PIX_MP'});
  await pagamento(db, {id: 22, valor: 1000, metodo: 'DINHEIRO'});
  const body = await bodyOk(db, session);
  assert.deepEqual(body.pagamentos.map(p => ({
    pagamentoId: p.pagamentoId,
    pagamentoAlocacaoId: p.pagamentoAlocacaoId,
    metodo: p.metodo,
    refund: p.reembolsoPropostoCentavos,
  })), [
    {pagamentoId: 11, pagamentoAlocacaoId: 11, metodo: 'PIX_MP', refund: 500},
    {pagamentoId: 22, pagamentoAlocacaoId: 22, metodo: 'DINHEIRO', refund: 1000},
  ]);
});

test('exemplo A/B mantém Pix 500 e Dinheiro 1000 sobre B', async t => {
  const {db, session} = await preparar(t, {valor: 3000});
  await db.batch([
    db.prepare(`UPDATE pedido_itens SET produto_nome='Item A',valor_unitario_centavos=1500,
      valor_total_centavos=1500 WHERE id=1`),
    db.prepare(`INSERT INTO pedido_itens(
      id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado,estoque_reservado_em
    ) VALUES(2,1,1,'Item B',1,1500,1500,'ATIVO','RESERVADO',CURRENT_TIMESTAMP)`),
    db.prepare('UPDATE produtos SET estoque_reservado=2 WHERE id=1'),
  ]);
  await pagamento(db, {id: 1, valor: 2000, alocado: 1500, metodo: 'PIX_MP', itemId: 1});
  await db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
    id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,1,2,500)`).run();
  await pagamento(db, {id: 2, valor: 1000, metodo: 'DINHEIRO', itemId: 2, allocationId: 3});

  const body = await bodyOk(db, session, {itemId: 2});
  assert.equal(body.financeiro.reembolsoNecessarioCentavos, 1500);
  assert.deepEqual(body.pagamentos.map(p => [p.pagamentoId, p.metodo, p.reembolsoPropostoCentavos]), [
    [1, 'PIX_MP', 500],
    [2, 'DINHEIRO', 1000],
  ]);
});

test('Pix pendente e pagamento falho não entram na cobertura; Pix vivo bloqueia execução', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 700, metodo: 'PIX_MP', status: 'PENDENTE'});
  await pagamento(db, {id: 2, valor: 800, metodo: 'CARTAO', status: 'FALHOU'});
  const body = await bodyOk(db, session);
  assert.equal(body.financeiro.coberturaConfirmadaCentavos, 0);
  assert.deepEqual(body.pagamentos, []);
  assert.equal(body.cancelamentoExecutavel, false);
  assert.deepEqual(body.bloqueios.map(b => b.codigo), ['PIX_PENDENTE']);
});

test('refund confirmado atribuído reduz cobertura efetiva; pendente ou falho não reduz', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 1500});
  await db.prepare(`INSERT INTO pedido_item_cancelamentos(
    id,pedido_id,pedido_item_id,status,valor_item_centavos,
    valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
    estoque_acao,motivo,registrado_por_usuario_id,snapshot_financeiro
  ) VALUES(1,1,1,'FALHOU',1500,1500,500,'LIBERAR_RESERVA','teste',1,'{}')`).run();
  for (const [id, status, valor] of [[1, 'REEMBOLSADO', 300], [2, 'PENDENTE', 100], [3, 'FALHOU', 100]]) {
    await db.prepare(`INSERT INTO pedido_reembolsos(
      id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,
      idempotency_key,registrado_por_usuario_id
    ) VALUES(?,1,1,'MANUAL','DINHEIRO',?,?,?,1)`)
      .bind(id, valor, status, `refund-${id}`).run();
    await db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
      id,reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos
    ) VALUES(?,?,?,?,?)`).bind(id, id, 1, 1, valor).run();
  }
  const body = await bodyOk(db, session);
  assert.equal(body.pagamentos[0].valorJaReembolsadoDaAlocacaoCentavos, 300);
  assert.equal(body.pagamentos[0].coberturaEfetivaCentavos, 1200);
  assert.equal(body.financeiro.reembolsoNecessarioCentavos, 1200);
  assert.equal(body.financeiro.valorNaoPagoCentavos, 300);
});

test('refund legado confirmado sem atribuição completa torna a cobertura indeterminada', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 1500});
  await db.prepare(`INSERT INTO pedido_reembolsos(
    pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key
  ) VALUES(1,1,'MANUAL','DINHEIRO',400,'REEMBOLSADO','legacy-refund')`).run();
  const response = await preview(db, session);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'COBERTURA_INDETERMINADA');
  assert.match(body.error, /histórico sem atribuição completa/i);
});

test('preview representa RESERVADO, BAIXADO e estados fisicamente neutros sem efeitos', async t => {
  for (const [estado, acao] of [
    ['RESERVADO', 'LIBERAR_RESERVA'],
    ['BAIXADO', 'NAO_REPOR'],
    ['SEM_RESERVA', 'NENHUMA'],
    ['LIBERADO', 'NENHUMA'],
    ['NAO_APLICAVEL', 'NENHUMA'],
    ['REPOSTO', 'NENHUMA'],
  ]) {
    const {db, session} = await preparar(t, {estoqueEstado: estado});
    if (estado === 'NAO_APLICAVEL') {
      await db.prepare('UPDATE pedido_itens SET produto_id=NULL WHERE id=1').run();
    }
    const body = await bodyOk(db, session);
    assert.deepEqual(body.estoque, {estadoAtual: estado, acaoPadrao: acao});
  }
});

test('item cancelado, item de outro pedido e cancelamento existente são recusados', async t => {
  const {db, session} = await preparar(t);
  await db.batch([
    db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
      valor_total_centavos,idempotency_key) VALUES(2,'p2','Outro','0',100,'p2-key')`),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado)
      VALUES(2,2,NULL,'Outro',1,100,100,'ATIVO','NAO_APLICAVEL')`),
  ]);
  let response = await preview(db, session, {itemId: 2});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ITEM_FORA_DO_PEDIDO');

  await db.prepare("UPDATE pedido_itens SET status_item='CANCELADO' WHERE id=1").run();
  response = await preview(db, session);
  assert.equal((await response.json()).code, 'ITEM_JA_CANCELADO');

  await db.prepare("UPDATE pedido_itens SET status_item='ATIVO' WHERE id=1").run();
  await db.prepare(`INSERT INTO pedido_item_cancelamentos(
    pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,
    valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro
  ) VALUES(1,1,'SOLICITADO',1500,0,0,'LIBERAR_RESERVA','{}')`).run();
  response = await preview(db, session);
  assert.equal((await response.json()).code, 'CANCELAMENTO_JA_EXISTENTE');
});

test('pedido ausente, item ausente e ids inválidos são recusados', async t => {
  const {db, session} = await preparar(t);
  const semSessao = await app.adminItemCancellationPreview.onRequestGet({
    env: env(db), params: {id: '1', itemId: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens/1/cancelamento-preview'),
  });
  assert.equal(semSessao.status, 401);
  let response = await preview(db, session, {pedidoId: 99});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'PEDIDO_NAO_ENCONTRADO');
  response = await preview(db, session, {itemId: 99});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'ITEM_NAO_ENCONTRADO');
  response = await preview(db, session, {itemId: 0});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'ITEM_ID_INVALIDO');
});

test('ENTREGUE, CANCELADO e comanda ENCERRADA são recusados; PRONTO retorna bloqueio explícito', async t => {
  for (const [config, code] of [
    [{statusPedido: 'ENTREGUE'}, 'PEDIDO_ENTREGUE'],
    [{statusPedido: 'CANCELADO'}, 'PEDIDO_CANCELADO'],
    [{statusComanda: 'ENCERRADA'}, 'COMANDA_ENCERRADA'],
  ]) {
    const {db, session} = await preparar(t, config);
    const response = await preview(db, session);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, code);
  }
  const {db, session} = await preparar(t, {statusPedido: 'PRONTO'});
  const body = await bodyOk(db, session);
  assert.equal(body.cancelamentoExecutavel, false);
  assert.deepEqual(body.bloqueios.map(b => b.codigo), ['STATUS_PEDIDO_PRONTO']);
});

test('100 GETs produzem zero efeitos persistidos', async t => {
  const {db, session} = await preparar(t);
  await pagamento(db, {id: 1, valor: 800});
  const tabelas = [
    'pedidos', 'pedido_itens', 'produtos', 'pedido_pagamentos',
    'pedido_pagamento_alocacoes', 'pedido_reembolsos',
    'pedido_reembolso_alocacoes', 'pedido_item_cancelamentos', 'pedido_operacoes',
  ];
  const fotografia = async () => Object.fromEntries(await Promise.all(tabelas.map(async nome => [
    nome,
    (await db.prepare(`SELECT * FROM ${nome} ORDER BY id`).all()).results,
  ])));
  const antes = await fotografia();
  for (let i = 0; i < 100; i += 1) {
    const response = await preview(db, session);
    assert.equal(response.status, 200);
  }
  assert.deepEqual(await fotografia(), antes);
});

test('migration 0018 preserva fatos existentes, amplia A1 e aplica constraints relacionais', async t => {
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await db.batch([
    db.prepare(`INSERT INTO pedido_reembolsos(
      id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,
      registrado_por_usuario_id,motivo,criado_em,atualizado_em,concluido_em
    ) VALUES(77,1,1,'MANUAL','PIX_MP',100,'REEMBOLSADO','refund-preservado',1,
      'histórico','2025-01-01','2025-01-02','2025-01-02')`),
    db.prepare(`INSERT INTO pedido_operacoes(
      id,operation_key,tipo,escopo,ator_usuario_id,fingerprint_versao,fingerprint,
      fase,pedido_id,pagamento_id,reembolso_id,pedido_item_id,resultado,erro,
      mp_idempotency_key,mp_request,mp_payment_id,criado_em,atualizado_em
    ) VALUES(88,'operacao-preservada','ITEM_ADICAO_ADMIN','ADMIN',1,1,'fp',
      'CONCLUIDA',1,1,77,1,'resultado','erro','mp-key','request','mp-id',
      '2025-02-01','2025-02-02')`),
  ]);
  const tabelas = ['pedido_pagamentos', 'pedido_pagamento_alocacoes', 'pedido_reembolsos', 'pedido_operacoes'];
  const antes = Object.fromEntries(await Promise.all(tabelas.map(async nome => [
    nome, (await db.prepare(`SELECT * FROM ${nome} ORDER BY id`).all()).results,
  ])));

  await aplicarCancelamentoPorItem(db);

  for (const nome of tabelas) {
    const depois = (await db.prepare(`SELECT * FROM ${nome} ORDER BY id`).all()).results;
    if (nome === 'pedido_operacoes') {
      assert.deepEqual(depois.map(({pedido_item_cancelamento_id, ...resto}) => resto), antes[nome]);
      assert.ok(depois.every(row => row.pedido_item_cancelamento_id === null));
    } else {
      assert.deepEqual(depois, antes[nome]);
    }
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_item_cancelamentos').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_reembolso_alocacoes').first()).n, 0);

  await db.prepare(`INSERT INTO pedido_item_cancelamentos(
    id,pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,
    valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro
  ) VALUES(1,1,1,'SOLICITADO',5000,5000,100,'NAO_REPOR','{}')`).run();
  await assert.rejects(db.prepare(`INSERT INTO pedido_item_cancelamentos(
    pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,
    valor_reembolso_necessario_centavos,estoque_acao,snapshot_financeiro
  ) VALUES(1,1,'INCONCLUSIVO',5000,5000,100,'NAO_REPOR','{}')`).run(), /UNIQUE/i);

  await db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
    reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos
  ) VALUES(77,1,1,100)`).run();
  await assert.rejects(db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
    reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos
  ) VALUES(77,4,1,1)`).run(), /reembolso_alocacao_inconsistente/);
  await assert.rejects(db.prepare('UPDATE pedido_pagamento_alocacoes SET valor_centavos=50 WHERE id=1').run(), /reembolso_alocacao_inconsistente/);
  await assert.rejects(db.prepare('UPDATE pedido_reembolsos SET pagamento_id=2 WHERE id=77').run(), /reembolso_alocacao_inconsistente/);
  await db.prepare(`INSERT INTO pedido_itens(
    id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
    valor_total_centavos,estoque_baixado_em,status_item,estoque_estado
  ) VALUES(999,1,1,'Outro item',1,100,100,CURRENT_TIMESTAMP,'ATIVO','BAIXADO')`).run();
  await assert.rejects(db.prepare('UPDATE pedido_item_cancelamentos SET pedido_item_id=999 WHERE id=1').run(), /reembolso_alocacao_inconsistente/);

  await db.prepare(`INSERT INTO pedido_operacoes(
    operation_key,tipo,escopo,ator_usuario_id,fingerprint_versao,fingerprint,
    fase,pedido_id,pedido_item_id,pedido_item_cancelamento_id
  ) VALUES('cancelamento-a1-01','ITEM_CANCELAMENTO_ADMIN','ADMIN',1,1,'fp-cancel',
    'LOCAL_CRIADA',1,1,1)`).run();
  const nova = await db.prepare(`SELECT tipo,pedido_item_cancelamento_id
    FROM pedido_operacoes WHERE operation_key='cancelamento-a1-01'`).first();
  assert.deepEqual(nova, {tipo: 'ITEM_CANCELAMENTO_ADMIN', pedido_item_cancelamento_id: 1});
  await assert.rejects(db.prepare('DELETE FROM pedido_item_cancelamentos WHERE id=1').run(), /FOREIGN KEY/i);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pragma_foreign_key_check').first()).n, 0);
});
