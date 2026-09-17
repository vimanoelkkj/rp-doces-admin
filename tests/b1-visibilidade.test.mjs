import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// B-1 — pedido MANUAL/PENDENTE operacionalmente visível + política de
// reserva do pedido de balcão.
//
// O defeito: a listagem administrativa filtrava só `PARCIAL/PAGO`, então o
// caminho DEFAULT do "Novo pedido" (DINHEIRO/PENDENTE) e todo `A_COMBINAR`
// desapareciam — com estoque reservado e sem nenhuma outra tela por onde
// alcançá-los.

const cookieDe = session => session.cookie.split(';')[0];
const uuid = n => `b1v-${n}-0000-4000-8000-000000000000`;

function listar(db, session, query = '') {
  return app.adminCreate.onRequestGet({
    env: {DB: db},
    request: new Request(`https://local.test/api/admin/pedidos${query}`, {
      headers: {Cookie: cookieDe(session)},
    }),
  });
}

async function listagem(db, session, query = '') {
  const response = await listar(db, session, query);
  assert.equal(response.status, 200);
  return response.json();
}

function criarManual(db, session, body) {
  return app.adminCreate.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/pedidos', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({
        itens: [{produtoId: 1, quantidade: 2}],
        clienteNome: 'Balcao',
        clienteWhatsapp: '000',
        metodoPagamento: 'DINHEIRO',
        statusPagamento: 'PENDENTE',
        ...body,
      }),
    }),
  });
}

// Bancada sem o pedido SITE da fixture, para a listagem começar vazia.
async function balcao(t, opcoes = {}) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA', ...opcoes});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=20, estoque_reservado=0 WHERE id=1').run();
  return {db, session: await app.auth.createSession(db, 1)};
}

test('MANUAL/PENDENTE (default do Novo Pedido) aparece na listagem e o detalhe abre', async t => {
  const {db, session} = await balcao(t);

  const vazia = await listagem(db, session);
  assert.equal(vazia.total, 0, 'listagem começa vazia');

  const criado = await (await criarManual(db, session, {operationKey: uuid(1)})).json();
  assert.equal(criado.ok, true);

  const lista = await listagem(db, session);
  assert.equal(lista.total, 1, 'pedido de balcão pendente é visível');
  assert.equal(lista.pedidos.length, 1);
  assert.equal(lista.pedidos[0].id, criado.pedidoId);
  assert.equal(lista.pedidos[0].status_pagamento, 'PENDENTE');
  assert.equal(lista.pedidos[0].financeiro.status, 'PENDENTE');
  assert.equal(lista.pedidos[0].financeiro.pagoCentavos, 0);

  // O detalhe — e com ele status, pagamento manual e geração de Pix — abre.
  const detalhe = await app.adminOrder.onRequestGet({
    env: {DB: db}, params: {id: String(criado.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1', {headers: {Cookie: cookieDe(session)}}),
  });
  assert.equal(detalhe.status, 200);
  const corpo = await detalhe.json();
  assert.equal(corpo.pedido.id, criado.pedidoId);
  assert.equal(corpo.pedido.status_comanda, 'ABERTA');
  assert.equal(corpo.itens.length, 1);
});

test('A_COMBINAR pendente permanece operacionalmente visível', async t => {
  const {db, session} = await balcao(t);
  const criado = await (await criarManual(db, session, {
    metodoPagamento: 'A_COMBINAR', statusPagamento: 'PENDENTE', operationKey: uuid(2),
  })).json();

  const lista = await listagem(db, session);
  assert.equal(lista.total, 1);
  assert.equal(lista.pedidos[0].id, criado.pedidoId);

  // O placeholder financeiro real do ledger continua existindo por trás.
  const s = await state(db);
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos[0].metodo, 'A_COMBINAR');
  assert.equal(s.pagamentos[0].status, 'PENDENTE');
});

test('pedido SITE/PENDENTE continua fora da listagem; entra ao virar PARCIAL/PAGO', async t => {
  // Fixture padrão: pedido 1 é SITE com Pix PENDENTE.
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  assert.equal((await db.prepare('SELECT origem_pedido FROM pedidos WHERE id=1').first()).origem_pedido, 'SITE');

  const oculta = await listagem(db, session);
  assert.equal(oculta.total, 0, 'carrinho não pago não é compromisso operacional');
  assert.equal(oculta.counts.todos, 0);

  // Confirma o pagamento e reconcilia: agora entra pelo critério antigo.
  await db.prepare("UPDATE pedido_pagamentos SET status='PAGO' WHERE id=1").run();
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const visivel = await listagem(db, session);
  assert.equal(visivel.total, 1);
  assert.equal(visivel.pedidos[0].financeiro.status, 'PAGO');
});

test('contagens das abas e paginação usam o mesmo critério da listagem', async t => {
  const {db, session} = await balcao(t);

  // 9 pedidos MANUAL pendentes (> ITEMS_PER_PAGE = 8) para exercitar página 2.
  for (let i = 0; i < 9; i++) {
    const r = await criarManual(db, session, {
      itens: [{produtoId: 1, quantidade: 1}], operationKey: uuid(100 + i),
    });
    assert.equal(r.status, 201, `criação ${i}`);
  }
  // Um SITE pendente que deve continuar invisível em tudo.
  await db.prepare(`INSERT INTO pedidos(token_publico,cliente_nome,cliente_whatsapp,
    valor_total_centavos,idempotency_key,origem_pedido,status_pagamento)
    VALUES('tok-site','Site','000',5000,'k-site','SITE','PENDENTE')`).run();

  const p1 = await listagem(db, session, '?page=1');
  assert.equal(p1.total, 9, 'só os MANUAL entram');
  assert.equal(p1.totalPages, 2);
  assert.equal(p1.pedidos.length, 8);
  assert.equal(p1.counts.todos, 9, 'contador da aba bate com o total da listagem');
  assert.equal(p1.counts.hoje, 9);
  assert.equal(p1.counts.em_producao, 9, 'todos nascem NOVO');
  assert.equal(p1.counts.prontos, 0);
  assert.equal(p1.counts.entregues, 0);

  const p2 = await listagem(db, session, '?page=2');
  assert.equal(p2.pedidos.length, 1, 'resto exato na segunda página');
  const ids = [...p1.pedidos, ...p2.pedidos].map(p => p.id);
  assert.equal(new Set(ids).size, 9, 'nenhuma linha repetida ou perdida entre páginas');

  // Aba filtrada por status operacional permanece coerente com seu contador.
  await db.prepare("UPDATE pedidos SET status_pedido='PRONTO' WHERE id=(SELECT MIN(id) FROM pedidos WHERE origem_pedido='MANUAL')").run();
  const prontos = await listagem(db, session, '?status=prontos');
  assert.equal(prontos.total, 1);
  assert.equal(prontos.pedidos.length, 1);
  assert.equal(prontos.counts.prontos, 1);
  assert.equal(prontos.counts.em_producao, 8);
});

test('busca alcança o pedido de balcão pendente por id e por nome', async t => {
  const {db, session} = await balcao(t);
  const criado = await (await criarManual(db, session, {
    clienteNome: 'Fulana Balcao', operationKey: uuid(3),
  })).json();

  const porId = await listagem(db, session, `?search=RP-${criado.pedidoId}`);
  assert.equal(porId.total, 1);
  assert.equal(porId.pedidos[0].id, criado.pedidoId);

  const porNome = await listagem(db, session, '?search=Fulana');
  assert.equal(porNome.total, 1);
  assert.equal(porNome.pedidos[0].id, criado.pedidoId);
});

/* ───────────────── política de reserva do pedido MANUAL ───────────────── */

test('reserva do pedido MANUAL nasce ATIVA e sem prazo, e NÃO expira sozinha', async t => {
  const {db, session} = await balcao(t);
  const criado = await (await criarManual(db, session, {operationKey: uuid(4)})).json();

  const pedido = await db.prepare('SELECT reserva_status, reserva_expira_em, origem_pedido FROM pedidos WHERE id=?')
    .bind(criado.pedidoId).first();
  assert.equal(pedido.origem_pedido, 'MANUAL');
  assert.equal(pedido.reserva_status, 'ATIVA');
  assert.equal(pedido.reserva_expira_em, null, 'compromisso de balcão não tem prazo de Pix');
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);

  // Mesmo com o relógio muito à frente, a varredura local (restrita a SITE)
  // não toca nesta reserva: liberar sozinha venderia o doce prometido.
  await db.prepare("UPDATE pedidos SET reserva_expira_em='2000-01-01T00:00:00Z' WHERE id=?")
    .bind(criado.pedidoId).run();
  await app.sync.liberarReservasVencidasLocalmente({DB: db});
  const depois = await db.prepare('SELECT reserva_status FROM pedidos WHERE id=?').bind(criado.pedidoId).first();
  assert.equal(depois.reserva_status, 'ATIVA');
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);
});

test('cancelar o pedido MANUAL libera a reserva — não fica presa', async t => {
  const {db, session} = await balcao(t);
  const criado = await (await criarManual(db, session, {
    metodoPagamento: 'A_COMBINAR', operationKey: uuid(5),
  })).json();
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);

  const cancelar = await app.adminOrder.onRequestPatch({
    env: {DB: db}, params: {id: String(criado.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({statusPedido: 'CANCELADO'}),
    }),
  });
  assert.equal(cancelar.status, 200);

  const pedido = await db.prepare('SELECT reserva_status, reserva_liberada_em FROM pedidos WHERE id=?')
    .bind(criado.pedidoId).first();
  assert.equal(pedido.reserva_status, 'LIBERADA', 'placeholder local não retém reserva');
  assert.ok(pedido.reserva_liberada_em);
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 0);
  assert.equal((await db.prepare('SELECT estoque FROM produtos WHERE id=1').first()).estoque, 20,
    'cancelamento não baixa estoque físico');
});

test('pagamento posterior converte a reserva do pedido MANUAL em baixa física', async t => {
  const {db, session} = await balcao(t);
  const criado = await (await criarManual(db, session, {
    metodoPagamento: 'A_COMBINAR', operationKey: uuid(6),
  })).json();

  const pagamento = await app.adminPayment.onRequestPost({
    env: {DB: db}, params: {id: String(criado.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1/pagamentos', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({metodo: 'DINHEIRO', valorCentavos: 10000, operationKey: uuid(7)}),
    }),
  });
  assert.equal(pagamento.status, 201);

  const pedido = await db.prepare('SELECT reserva_status, estoque_baixado_em, status_pagamento FROM pedidos WHERE id=?')
    .bind(criado.pedidoId).first();
  assert.equal(pedido.status_pagamento, 'PAGO');
  assert.equal(pedido.reserva_status, 'CONVERTIDA');
  assert.ok(pedido.estoque_baixado_em);
  const produto = await db.prepare('SELECT estoque, estoque_reservado FROM produtos WHERE id=1').first();
  assert.equal(produto.estoque, 18);
  assert.equal(produto.estoque_reservado, 0);
});

test('Pix ADMIN sobre pedido MANUAL preserva B4: reserva única e retida enquanto pendente', async t => {
  const {db, session} = await balcao(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options?.method, 'POST');
    return Response.json({
      id: 777, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {transaction_data: {qr_code: 'qr'}},
    });
  });
  const criado = await (await criarManual(db, session, {
    metodoPagamento: 'A_COMBINAR', operationKey: uuid(8),
  })).json();

  const pix = await app.adminPix.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'}, params: {id: String(criado.pedidoId)},
    request: new Request('https://local.test/api/admin/pedidos/1/pix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({operationKey: uuid(9)}),
    }),
  });
  assert.equal(pix.status, 201);

  // Reserva preexistente NÃO é recriada nem duplicada.
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);

  // B4: com PIX_MP/PENDENTE vivo, nem o cancelamento libera a reserva.
  await app.stock.liberarReservaPedido(db, criado.pedidoId);
  assert.equal((await db.prepare('SELECT reserva_status FROM pedidos WHERE id=?')
    .bind(criado.pedidoId).first()).reserva_status, 'ATIVA');
  assert.equal((await db.prepare('SELECT estoque_reservado FROM produtos WHERE id=1').first()).estoque_reservado, 2);

  // O pedido continua visível durante tudo isso.
  const lista = await listagem(db, session);
  assert.equal(lista.total, 1);
  assert.equal(lista.pedidos[0].id, criado.pedidoId);
});
