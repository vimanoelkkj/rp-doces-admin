import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { app, fixture, state, barrier } from './helpers/b3.mjs';
import {
  bancoProducao,
  aplicarB5,
  aplicarEstoquePorItem,
  aplicarOperacaoPorItem,
} from './helpers/b5.mjs';

const env = db => ({DB: db, MP_ACCESS_TOKEN: 'fake'});
const silenciar = t => t.mock.method(console, 'error', () => {});

async function prepararComanda(t, {
  financeiro = 'PAGO',
  liquido = financeiro === 'PENDENTE' ? 0 : financeiro === 'PARCIAL' ? 1000 : 3000,
  statusPedido = 'NOVO',
} = {}) {
  const reserva = financeiro === 'PAGO' ? 'CONVERTIDA' : 'ATIVA';
  const db = await fixture(t, {paid: financeiro !== 'PENDENTE', reserve: reserva});
  await db.batch([
    db.prepare(`UPDATE pedidos
      SET origem_pedido='MANUAL', status_pedido=?, status_comanda='ABERTA',
          valor_total_centavos=3000, status_pagamento=?
      WHERE id=1`).bind(statusPedido, financeiro),
    db.prepare(`UPDATE pedido_itens
      SET quantidade=2, valor_unitario_centavos=1500, valor_total_centavos=3000
      WHERE id=1`),
    db.prepare(`UPDATE pedido_pagamentos
      SET valor_centavos=?, status=?, pago_em=CASE WHEN ?='PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id=1`).bind(liquido || 3000, financeiro === 'PENDENTE' ? 'PENDENTE' : 'PAGO', financeiro),
    db.prepare('UPDATE pedido_pagamento_alocacoes SET valor_centavos=? WHERE id=1')
      .bind(liquido || 3000),
    db.prepare(`INSERT INTO produtos(
      id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel
    ) VALUES(2,'Produto C','BOLO',1200,10,0,1,1)`),
  ]);
  return {db, session: await app.auth.createSession(db, 1)};
}

async function adicionar(db, session, {
  key = 'item-add-00000001',
  produtoId = 2,
  quantidade = 1,
  preco = 1200,
} = {}) {
  return app.adminItems.onRequestPost({
    env: env(db),
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens', {
      method: 'POST',
      headers: {
        Cookie: session.cookie.split(';')[0],
        Origin: 'https://local.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationKey: key,
        produtoId,
        quantidade,
        precoEsperadoCentavos: preco,
      }),
    }),
  });
}

async function gerarPix(db, session, {
  key = 'live-tab-pix-00000001',
  valorCentavos,
} = {}) {
  return app.adminPix.onRequestPost({
    env: env(db),
    params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/pix', {
      method: 'POST',
      headers: {
        Cookie: session.cookie.split(';')[0],
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({operationKey: key, ...(valorCentavos ? {valorCentavos} : {})}),
    }),
  });
}

const itensNovos = async db => (await db.prepare(
  'SELECT * FROM pedido_itens WHERE pedido_id=1 AND id<>1 ORDER BY id',
).all()).results;

test('PAGO 3000 + 1200 converge para PARCIAL sem tocar dinheiro nem itens baixados', async t => {
  const {db, session} = await prepararComanda(t);
  const itemAntigo = await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first();
  const produtoAntigo = await db.prepare('SELECT * FROM produtos WHERE id=1').first();
  const pagamento = await db.prepare('SELECT * FROM pedido_pagamentos WHERE id=1').first();

  const response = await adicionar(db, session);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.financeiro, {
    totalCentavos: 4200,
    brutoPagoCentavos: 3000,
    reembolsadoCentavos: 0,
    liquidoCentavos: 3000,
    saldoCentavos: 1200,
    statusPagamento: 'PARCIAL',
  });
  assert.deepEqual(body.item, {
    id: body.item.id,
    produtoId: 2,
    nome: 'Produto C',
    quantidade: 1,
    precoUnitarioCentavos: 1200,
    valorTotalCentavos: 1200,
    statusItem: 'ATIVO',
    estoqueEstado: 'RESERVADO',
  });

  const depois = await state(db);
  assert.equal(depois.pedido.valor_total_centavos, 4200);
  assert.equal(depois.pedido.status_pagamento, 'PARCIAL');
  assert.equal(depois.pedido.reserva_status, 'ATIVA');
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first(), itemAntigo);
  assert.deepEqual(await db.prepare('SELECT * FROM produtos WHERE id=1').first(), produtoAntigo);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_pagamentos WHERE id=1').first(), pagamento);
  assert.equal(depois.produtos.find(p => p.id === 2).estoque_reservado, 1);
  assert.equal(depois.itens.find(i => i.id === body.item.id).estoque_estado, 'RESERVADO');
});

test('PARCIAL e PENDENTE preservam o agregado financeiro ao adicionar item', async t => {
  for (const caso of [
    {financeiro: 'PARCIAL', liquido: 1000, saldo: 3200},
    {financeiro: 'PENDENTE', liquido: 0, saldo: 4200},
  ]) {
    const {db, session} = await prepararComanda(t, caso);
    const response = await adicionar(db, session, {key: `item-${caso.financeiro.toLowerCase()}-0001`});
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.financeiro.totalCentavos, 4200);
    assert.equal(body.financeiro.liquidoCentavos, caso.liquido);
    assert.equal(body.financeiro.saldoCentavos, caso.saldo);
    assert.equal(body.financeiro.statusPagamento, caso.financeiro);
  }
});

test('comanda MANUAL/PENDENTE legada sem ledger aceita item sem inventar pagamento', async t => {
  const db = await fixture(t, {ledger: false, reserve: 'ATIVA'});
  await db.batch([
    db.prepare("UPDATE pedidos SET origem_pedido='MANUAL' WHERE id=1"),
    db.prepare(`INSERT INTO produtos(
      id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel
    ) VALUES(2,'Produto C','BOLO',1200,10,0,1,1)`),
  ]);
  const session = await app.auth.createSession(db, 1);
  const response = await adicionar(db, session, {key: 'item-legacy-no-ledger-01'});
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).financeiro, {
    totalCentavos: 11200,
    brutoPagoCentavos: 0,
    reembolsadoCentavos: 0,
    liquidoCentavos: 0,
    saldoCentavos: 11200,
    statusPagamento: 'PENDENTE',
  });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pedido_pagamentos').first()).n, 0);
});

test('item NAO_APLICAVEL preexistente permanece fisicamente neutro', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  await db.batch([
    db.prepare(`INSERT INTO pedido_itens(
      pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
      valor_total_centavos,status_item,estoque_estado
    ) VALUES(1,NULL,'Item legado sem estoque',1,500,500,'ATIVO','NAO_APLICAVEL')`),
    db.prepare('UPDATE pedidos SET valor_total_centavos=3500 WHERE id=1'),
  ]);
  const legado = await db.prepare(
    "SELECT * FROM pedido_itens WHERE estoque_estado='NAO_APLICAVEL'",
  ).first();

  const response = await adicionar(db, session, {key: 'item-nao-aplicavel-01'});
  assert.equal(response.status, 201);
  assert.deepEqual(
    await db.prepare('SELECT * FROM pedido_itens WHERE id=?').bind(legado.id).first(),
    legado,
  );
  assert.equal((await response.json()).financeiro.totalCentavos, 4700);
});

test('guards aceitam NOVO/PREPARANDO e recusam SITE, ENCERRADA e estados terminais', async t => {
  for (const statusPedido of ['NOVO', 'PREPARANDO']) {
    const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE', statusPedido});
    const response = await adicionar(db, session, {key: `item-ok-${statusPedido.toLowerCase()}-01`});
    assert.equal(response.status, 201, statusPedido);
  }

  const recusas = [
    ['SITE', "UPDATE pedidos SET origem_pedido='SITE' WHERE id=1"],
    ['ENCERRADA', "UPDATE pedidos SET status_comanda='ENCERRADA' WHERE id=1"],
    ['PRONTO', "UPDATE pedidos SET status_pedido='PRONTO' WHERE id=1"],
    ['ENTREGUE', "UPDATE pedidos SET status_pedido='ENTREGUE' WHERE id=1"],
    ['CANCELADO', "UPDATE pedidos SET status_pedido='CANCELADO' WHERE id=1"],
  ];
  for (const [nome, sql] of recusas) {
    const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
    await db.prepare(sql).run();
    const antes = await state(db);
    const response = await adicionar(db, session, {key: `item-block-${nome.toLowerCase()}-01`});
    assert.equal(response.status, 409, nome);
    assert.equal((await response.json()).code, 'PEDIDO_NAO_EDITAVEL');
    assert.deepEqual(await state(db), antes);
  }
});

test('preco divergente e estoque insuficiente falham sem item, reserva, total ou claim', async t => {
  for (const caso of ['PRECO', 'ESTOQUE']) {
    const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
    if (caso === 'ESTOQUE') {
      await db.prepare('UPDATE produtos SET estoque=0, disponivel=1 WHERE id=2').run();
    }
    const antes = await state(db);
    const response = await adicionar(db, session, {
      key: `item-falha-${caso.toLowerCase()}-01`,
      preco: caso === 'PRECO' ? 1100 : 1200,
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, caso === 'PRECO' ? 'PRECO_ALTERADO' : 'ESTOQUE_INSUFICIENTE');
    if (caso === 'PRECO') assert.equal(body.precoAtualCentavos, 1200);
    assert.deepEqual(await state(db), antes);
  }
});

test('falha interna entre item e reserva reverte integralmente o batch', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  const antes = await state(db);
  db.hook = (statements, operation) => {
    if (operation !== 'batch' || !statements.some(s => s.sql.includes('ITEM_ADICAO_ADMIN'))) {
      return statements;
    }
    return statements.map(s => s.sql.includes('SET estoque_reservado = estoque_reservado + ?')
      ? {...s, sql: `${s.sql} AND 0`}
      : s);
  };
  const response = await adicionar(db, session, {key: 'item-injected-rollback-01'});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ESTADO_ALTERADO');
  assert.deepEqual(await state(db), antes);
});

test('POST exige sessao, mesma origem e payload valido antes de escrever', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  const antes = await state(db);
  const cookie = session.cookie.split(';')[0];
  const body = JSON.stringify({
    operationKey: 'item-security-000001', produtoId: 2,
    quantidade: 1, precoEsperadoCentavos: 1200,
  });
  const semOrigem = await app.adminItems.onRequestPost({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens', {
      method: 'POST', headers: {Cookie: cookie, 'Content-Type': 'application/json'}, body,
    }),
  });
  assert.equal(semOrigem.status, 403);
  const semSessao = await app.adminItems.onRequestPost({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens', {
      method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json'}, body,
    }),
  });
  assert.equal(semSessao.status, 401);
  const invalido = await adicionar(db, session, {key: 'item-security-000002', quantidade: 0});
  assert.equal(invalido.status, 400);
  assert.deepEqual(await state(db), antes);
});

test('retry A1 devolve o item exato mesmo depois de guard mutavel mudar', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  const primeira = await adicionar(db, session, {key: 'item-replay-00000001'});
  assert.equal(primeira.status, 201);
  const primeiroBody = await primeira.json();
  await db.prepare("UPDATE pedidos SET status_pedido='PRONTO' WHERE id=1").run();

  const segunda = await adicionar(db, session, {key: 'item-replay-00000001'});
  assert.equal(segunda.status, 201);
  assert.deepEqual(await segunda.json(), primeiroBody);
  assert.equal((await itensNovos(db)).length, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=2').first()).estoque_reservado, 1);
  assert.equal((await db.prepare('SELECT valor_total_centavos FROM pedidos WHERE id=1').first()).valor_total_centavos, 4200);

  const conflito = await adicionar(db, session, {
    key: 'item-replay-00000001', quantidade: 2,
  });
  assert.equal(conflito.status, 409);
  assert.equal((await conflito.json()).code, 'OPERACAO_CONFLITO_PAYLOAD');
  assert.equal((await itensNovos(db)).length, 1);
});

test('duas chamadas simultaneas com a mesma key produzem um item e uma reserva', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements.some(s => s.sql.includes('ITEM_ADICAO_ADMIN'))) {
      await gate();
    }
    return statements;
  };
  const [a, b] = await Promise.all([
    adicionar(db, session, {key: 'item-concurrent-same-01'}),
    adicionar(db, session, {key: 'item-concurrent-same-01'}),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal((await itensNovos(db)).length, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=2').first()).estoque_reservado, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM pedido_operacoes WHERE tipo='ITEM_ADICAO_ADMIN'").first()).n, 1);
});

test('keys legitimas concorrentes somam itens por projecao, inclusive para o mesmo produto', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  await db.prepare(`INSERT INTO produtos(
    id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel
  ) VALUES(3,'Produto D','BOLO',800,10,0,1,1)`).run();
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements.some(s => s.sql.includes('ITEM_ADICAO_ADMIN'))) await gate();
    return statements;
  };
  const [a, b] = await Promise.all([
    adicionar(db, session, {key: 'item-different-key-001', produtoId: 2, preco: 1200}),
    adicionar(db, session, {key: 'item-different-key-002', produtoId: 3, preco: 800}),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 201]);
  assert.equal((await itensNovos(db)).length, 2);
  assert.equal((await db.prepare('SELECT valor_total_centavos FROM pedidos WHERE id=1').first()).valor_total_centavos, 5000);

  db.hook = null;
  const c = await adicionar(db, session, {key: 'item-same-product-key-01'});
  const d = await adicionar(db, session, {key: 'item-same-product-key-02'});
  assert.deepEqual([c.status, d.status], [201, 201]);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=2').first()).estoque_reservado, 3);
  assert.equal((await db.prepare('SELECT valor_total_centavos FROM pedidos WHERE id=1').first()).valor_total_centavos, 7400);
});

test('estoque para uma unica intencao concorrente admite exatamente uma operacao', async t => {
  silenciar(t);
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  await db.prepare('UPDATE produtos SET estoque=1 WHERE id=2').run();
  const gate = barrier(2);
  db.hook = async (statements, operation) => {
    if (operation === 'batch' && statements.some(s => s.sql.includes('ITEM_ADICAO_ADMIN'))) await gate();
    return statements;
  };
  const responses = await Promise.all([
    adicionar(db, session, {key: 'item-one-stock-key-001'}),
    adicionar(db, session, {key: 'item-one-stock-key-002'}),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal((await itensNovos(db)).length, 1);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=2').first()).estoque_reservado, 1);
  assert.equal((await db.prepare('SELECT valor_total_centavos FROM pedidos WHERE id=1').first()).valor_total_centavos, 4200);
});

test('Pix ADMIN pendente conserva valor e capacidade futura absorve somente o novo saldo', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  await db.prepare("UPDATE pedido_pagamentos SET origem='ADMIN' WHERE id=1").run();
  const pixAntes = await db.prepare('SELECT * FROM pedido_pagamentos WHERE id=1').first();
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);

  const response = await adicionar(db, session, {key: 'item-with-pending-pix-01'});
  assert.equal(response.status, 201);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_pagamentos WHERE id=1').first(), pixAntes);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 1200);
});

test('adicao PAGO expoe saldo autoritativo, Pix exato e confirmacao baixa somente o item novo', async t => {
  const {db, session} = await prepararComanda(t);
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'POST') {
      posts += 1;
      assert.equal(JSON.parse(options.body).transaction_amount, 12);
      return Response.json({
        id: 777,
        status: 'pending',
        date_of_expiration: '2099-01-01T00:00:00Z',
        point_of_interaction: {transaction_data: {
          qr_code: 'pix-copia-e-cola-777',
          qr_code_base64: 'cXItNzc3',
          ticket_url: 'https://mp.test/777',
        }},
      });
    }
    const id = Number(String(url).split('/').at(-1));
    return Response.json({id, status: id === 777 ? 'approved' : 'pending'});
  });

  const addResponse = await adicionar(db, session, {key: 'live-tab-add-00000001'});
  assert.equal(addResponse.status, 201);
  const novoItem = (await addResponse.json()).item;
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 1200);

  const detalhe = await app.adminOrder.onRequestGet({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      headers: {Cookie: session.cookie.split(';')[0]},
    }),
  });
  assert.equal(detalhe.status, 200);
  const detalheBody = await detalhe.json();
  assert.equal(detalheBody.pedido.origem_pedido, 'MANUAL');
  assert.equal(detalheBody.capacidadeCobravelCentavos, 1200);
  assert.deepEqual(detalheBody.financeiro, {
    status: 'PARCIAL',
    brutoPagoCentavos: 3000,
    reembolsadoCentavos: 0,
    liquidoCentavos: 3000,
    saldoCentavos: 1200,
    pagoCentavos: 3000,
    totalCentavos: 4200,
    metodosConfirmados: ['PIX_MP'],
  });

  const oldItemBefore = await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first();
  const oldProductBefore = await db.prepare('SELECT * FROM produtos WHERE id=1').first();
  const primeira = await gerarPix(db, session, {
    key: 'live-tab-pix-00000001', valorCentavos: 1200,
  });
  assert.equal(primeira.status, 201);
  const pixBody = await primeira.json();
  assert.equal(pixBody.valorCentavos, 1200);
  assert.equal(pixBody.qrCode, 'pix-copia-e-cola-777');

  const retry = await gerarPix(db, session, {
    key: 'live-tab-pix-00000001', valorCentavos: 1200,
  });
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).pagamentoId, pixBody.pagamentoId);
  assert.equal(posts, 1, 'retry A1 nao envia nem persiste segunda cobranca');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM pedido_pagamentos WHERE origem='ADMIN'").first()).n, 1);

  const secret = 'live-tab-webhook-secret';
  const ts = '1';
  const requestId = 'live-tab-payment';
  const signature = createHmac('sha256', secret)
    .update(`id:777;request-id:${requestId};ts:${ts};`)
    .digest('hex');
  const webhook = await app.webhook.onRequestPost({
    env: {...env(db), MP_WEBHOOK_SECRET: secret},
    request: new Request('https://local.test/api/webhooks/mercadopago?data.id=777&type=payment', {
      method: 'POST',
      headers: {'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': requestId},
    }),
  });
  assert.equal(webhook.status, 200);

  const final = await state(db);
  assert.equal(final.pedido.status_pagamento, 'PAGO');
  assert.equal(final.itens.find(item => item.id === novoItem.id).estoque_estado, 'BAIXADO');
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first(), oldItemBefore);
  assert.deepEqual(await db.prepare('SELECT * FROM produtos WHERE id=1').first(), oldProductBefore);
  assert.equal(final.produtos.find(produto => produto.id === 2).estoque, 9);
  assert.equal(final.produtos.find(produto => produto.id === 2).estoque_reservado, 0);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);
});

test('Pix pendente parcial reduz capacidade e capacidade zero impede nova cobranca', async t => {
  const {db, session} = await prepararComanda(t);
  await adicionar(db, session, {key: 'live-tab-add-pending-01'});
  await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(
      id,pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key
    ) VALUES(2,1,'PIX_MP','ADMIN',500,'PENDENTE','501','pending-partial-500')`),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(
      pagamento_id,pedido_item_id,valor_centavos
    ) VALUES(2,2,500)`),
  ]);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 700);

  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options = {}) => {
    assert.equal(options.method, 'POST');
    posts += 1;
    assert.equal(JSON.parse(options.body).transaction_amount, 7);
    return Response.json({
      id: 778, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {transaction_data: {qr_code: 'pix-778'}},
    });
  });
  const nova = await gerarPix(db, session, {
    key: 'live-tab-pix-partial-01', valorCentavos: 700,
  });
  assert.equal(nova.status, 201);
  assert.equal(await app.pix.getCapacidadeCobravel(db, 1), 0);

  const bloqueada = await gerarPix(db, session, {key: 'live-tab-pix-zero-0001'});
  assert.equal(bloqueada.status, 400);
  assert.equal((await bloqueada.json()).code, 'VALOR_INVALIDO');
  assert.equal(posts, 1);
  assert.deepEqual(
    (await db.prepare("SELECT valor_centavos FROM pedido_pagamentos WHERE origem='ADMIN' ORDER BY id").all()).results,
    [{valor_centavos: 500}, {valor_centavos: 700}],
  );
});

test('refund legado nao atribuido nao bloqueia a adicao', async t => {
  const {db, session} = await prepararComanda(t);
  await db.prepare(`INSERT INTO pedido_reembolsos(
    pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key
  ) VALUES(1,1,'MANUAL','DINHEIRO',500,'REEMBOLSADO','legacy-refund-unallocated')`).run();
  await db.prepare("UPDATE pedidos SET status_pagamento='PARCIAL'").run();

  const response = await adicionar(db, session, {key: 'item-with-legacy-refund-01'});
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.financeiro.reembolsadoCentavos, 500);
  assert.equal(body.financeiro.liquidoCentavos, 2500);
  assert.equal(body.financeiro.saldoCentavos, 1700);
});

test('webhook/reconcile concorrente converge sem repetir baixa de item antigo', async t => {
  const {db, session} = await prepararComanda(t);
  const produtoAntes = await db.prepare('SELECT * FROM produtos WHERE id=1').first();
  const itemAntes = await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first();
  const secret = 'phase-3-local-only';
  const ts = '1';
  const requestId = 'phase-3';
  const signature = createHmac('sha256', secret)
    .update(`id:101;request-id:${requestId};ts:${ts};`)
    .digest('hex');
  const webhook = () => app.webhook.onRequestPost({
    env: {...env(db), MP_WEBHOOK_SECRET: secret},
    request: new Request('https://local.test/api/webhooks/mercadopago?data.id=101&type=payment', {
      method: 'POST',
      headers: {'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': requestId},
    }),
  });

  const [addResponse, webhookResponse] = await Promise.all([
    adicionar(db, session, {key: 'item-webhook-concurrent-01'}),
    webhook(),
    app.reconcile.reconcilePedidoAfterFinancialChange(db, 1),
  ]);
  assert.equal(addResponse.status, 201);
  assert.equal(webhookResponse.status, 200);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  assert.deepEqual(await db.prepare('SELECT * FROM pedido_itens WHERE id=1').first(), itemAntes);
  assert.deepEqual(await db.prepare('SELECT * FROM produtos WHERE id=1').first(), produtoAntes);
  assert.equal((await db.prepare('SELECT status_pagamento FROM pedidos WHERE id=1').first()).status_pagamento, 'PARCIAL');
});

test('detalhe admin expoe ids e estados estaveis; PUT integral continua bloqueado', async t => {
  const {db, session} = await prepararComanda(t, {financeiro: 'PENDENTE'});
  const addResponse = await adicionar(db, session, {key: 'item-detail-stable-id-01'});
  const criado = (await addResponse.json()).item;
  const cookie = session.cookie.split(';')[0];

  const detalhe = await app.adminOrder.onRequestGet({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {headers: {Cookie: cookie}}),
  });
  assert.equal(detalhe.status, 200);
  const itens = (await detalhe.json()).itens;
  assert.deepEqual(itens.map(i => [i.id, i.status_item, i.estoque_estado]), [
    [1, 'ATIVO', 'RESERVADO'],
    [criado.id, 'ATIVO', 'RESERVADO'],
  ]);

  const put = await app.adminItems.onRequestPut({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1/itens', {
      method: 'PUT', headers: {Cookie: cookie, 'Content-Type': 'application/json'},
      body: JSON.stringify({itens: [{produtoId: 2, quantidade: 2}]}),
    }),
  });
  assert.equal(put.status, 409);
  assert.equal((await put.json()).code, 'EDICAO_ITENS_BLOQUEADA');
});

test('migration 0017 preserva operacoes A1 antigas e restringe exclusao do item vinculado', async t => {
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  const tiposAntigos = [
    'CHECKOUT_SITE', 'PEDIDO_ADMIN', 'PAGAMENTO_ADMIN',
    'REFUND_ADMIN', 'PIX_ADMIN', 'PIX_ADMIN_REGENERACAO',
  ];
  for (const [index, tipo] of tiposAntigos.entries()) {
    await db.prepare(`INSERT INTO pedido_operacoes(
      id,operation_key,tipo,escopo,ator_usuario_id,fingerprint_versao,fingerprint,
      fase,pedido_id,pagamento_id,reembolso_id,resultado,erro,mp_idempotency_key,
      mp_request,mp_payment_id,criado_em,atualizado_em
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      91 + index,
      `legacy-a1-operation-${index}`,
      tipo,
      tipo === 'CHECKOUT_SITE' ? 'SITE' : 'ADMIN',
      tipo === 'CHECKOUT_SITE' ? null : 1,
      7,
      `legacy-fingerprint-${index}`,
      index % 2 ? 'ENVIO_INCONCLUSIVO' : 'CONCLUIDA',
      1,
      1,
      null,
      `{"ok":true,"index":${index}}`,
      `legacy-diagnostic-${index}`,
      `legacy-mp-key-${index}`,
      `{"amount":${5000 + index}}`,
      `90${index + 1}`,
      `2025-01-0${index + 1} 03:04:05`,
      `2025-06-0${index + 1} 08:09:10`,
    ).run();
  }
  const colunasAntigas = `id,operation_key,tipo,escopo,ator_usuario_id,
    fingerprint_versao,fingerprint,fase,pedido_id,pagamento_id,reembolso_id,
    resultado,erro,mp_idempotency_key,mp_request,mp_payment_id,criado_em,atualizado_em`;
  const antes = (await db.prepare(`SELECT ${colunasAntigas} FROM pedido_operacoes ORDER BY id`).all()).results;

  await aplicarOperacaoPorItem(db);
  assert.deepEqual(
    (await db.prepare(`SELECT ${colunasAntigas} FROM pedido_operacoes ORDER BY id`).all()).results,
    antes,
  );
  assert.ok((await db.prepare('SELECT pedido_item_id FROM pedido_operacoes ORDER BY id').all()).results
    .every(o => o.pedido_item_id === null));
  const indices = (await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pedido_operacoes'").all()).results.map(r => r.name);
  for (const nome of [
    'uq_pedido_operacoes_key',
    'idx_pedido_operacoes_pedido',
    'idx_pedido_operacoes_fase',
    'idx_pedido_operacoes_item',
  ]) assert.ok(indices.includes(nome), nome);
  const fkItem = (await db.prepare("PRAGMA foreign_key_list('pedido_operacoes')").all()).results
    .find(fk => fk.from === 'pedido_item_id');
  assert.equal(fkItem.table, 'pedido_itens');
  assert.equal(fkItem.on_delete, 'RESTRICT');

  await db.prepare(`INSERT INTO pedido_operacoes(
    operation_key,tipo,escopo,ator_usuario_id,fingerprint_versao,fingerprint,
    fase,pedido_id,pedido_item_id
  ) VALUES('new-item-operation','ITEM_ADICAO_ADMIN','ADMIN',1,1,'new-fingerprint',
    'CONCLUIDA',1,1)`).run();
  await assert.rejects(db.prepare('DELETE FROM pedido_itens WHERE id=1').run(), /FOREIGN KEY/i);
  const nova = await db.prepare("SELECT id,pedido_item_id FROM pedido_operacoes WHERE operation_key='new-item-operation'").first();
  assert.equal(nova.pedido_item_id, 1);
  assert.ok(nova.id > 96, 'sequencia preserva ids historicos');
});
