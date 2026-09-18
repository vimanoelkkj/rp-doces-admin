import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state, refund} from './helpers/b3.mjs';

// Política: o pedido NÃO pode ser cancelado enquanto existir qualquer
// `PIX_MP/PENDENTE` seu. A regra pertence ao PEDIDO (coerente com o B4) e é
// decidida dentro da própria escrita, para que uma criação de Pix, um webhook
// ou a recuperação B-3 concorrentes não caibam entre a checagem e o UPDATE.
//
// O guard não toca a cobrança: nada vira CANCELADO/FALHOU, nada vai ao
// Mercado Pago, nenhuma verdade financeira muda.

const silenciar = t => t.mock.method(console, 'error', () => {});
const env = db => ({DB: db, MP_ACCESS_TOKEN: 'fake'});

async function patchStatus(db, statusPedido = 'CANCELADO') {
  const session = await app.auth.createSession(db, 1);
  const response = await app.adminOrder.onRequestPatch({
    env: env(db), params: {id: '1'},
    request: new Request('https://local.test/api/admin/pedidos/1', {
      method: 'PATCH',
      headers: {Cookie: session.cookie.split(';')[0], 'Content-Type': 'application/json'},
      body: JSON.stringify({statusPedido}),
    }),
  });
  return {response, body: await response.json()};
}

const segundaTentativa = (db, origem, status, mpId = null) =>
  db.prepare(`INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,
    mp_payment_id,idempotency_key) VALUES(1,'PIX_MP',?,10000,?,?,?)`)
    .bind(origem, status, mpId, `extra-${origem}-${status}`).run();

function bloqueado({response, body}) {
  assert.equal(response.status, 409);
  assert.equal(body.code, 'PEDIDO_COM_PIX_PENDENTE');
  assert.match(body.error, /Pix pendente/i);
}

/* ─────────────────────────── casos diretos ─────────────────────────── */

test('1. pedido sem nenhum Pix continua cancelável', async t => {
  const db = await fixture(t, {ledger: false});
  const {response, body} = await patchStatus(db);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  const s = await state(db);
  assert.equal(s.pedido.status_pedido, 'CANCELADO');
  assert.equal(s.pedido.reserva_status, 'LIBERADA', 'liberação explícita continua valendo');
  assert.equal(s.produtos[0].estoque_reservado, 0);
});

for (const origem of ['SITE', 'ADMIN']) {
  test(`2/4/5. Pix ${origem}/PENDENTE recusa o cancelamento sem tocar nada`, async t => {
    const db = await fixture(t);
    await db.prepare('UPDATE pedido_pagamentos SET origem=? WHERE id=1').bind(origem).run();
    const antes = await state(db);

    bloqueado(await patchStatus(db));

    const depois = await state(db);
    assert.equal(depois.pedido.status_pedido, antes.pedido.status_pedido, 'pedido intocado');
    assert.equal(depois.pedido.reserva_status, 'ATIVA', 'reserva intocada');
    assert.deepEqual(depois.produtos, antes.produtos, 'estoque intocado');
    assert.deepEqual(depois.pagamentos, antes.pagamentos, 'cobrança NÃO é terminalizada');
  });
}

test('3. tentativa de ENVIO_INCONCLUSIVO (sem mp_payment_id) também recusa', async t => {
  const db = await fixture(t);
  await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
  const antes = await state(db);
  bloqueado(await patchStatus(db));
  assert.deepEqual(await state(db), antes);
});

test('3b. Pix substituído ainda PENDENTE também recusa', async t => {
  const db = await fixture(t);
  await segundaTentativa(db, 'ADMIN', 'PENDENTE', '202');
  await db.prepare('UPDATE pedido_pagamentos SET substitui_pagamento_id=1 WHERE id=2').run();
  bloqueado(await patchStatus(db));
  assert.equal((await state(db)).pagamentos.filter(p => p.status === 'PENDENTE').length, 2);
});

for (const status of ['EXPIRADO', 'FALHOU', 'CANCELADO']) {
  test(`6/7/8. Pix ${status} não bloqueia o cancelamento`, async t => {
    const db = await fixture(t);
    await db.prepare('UPDATE pedido_pagamentos SET status=? WHERE id=1').bind(status).run();
    const {response} = await patchStatus(db);
    assert.equal(response.status, 200, 'histórico terminal não prende o pedido para sempre');
    const s = await state(db);
    assert.equal(s.pedido.status_pedido, 'CANCELADO');
    assert.equal(s.pagamentos[0].status, status, 'a cobrança permanece como estava');
  });
}

test('9. Pix realmente PAGO continua decidido pelo guard financeiro existente', async t => {
  const db = await fixture(t, {paid: true});
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const {response, body} = await patchStatus(db);
  assert.equal(response.status, 409);
  assert.equal(body.code, undefined, 'guard financeiro mantém o contrato anterior');
  assert.match(body.error, /estorno antes de cancelar/i);
  assert.equal((await state(db)).pedido.status_pedido, 'NOVO');
});

test('10. estorno integral depois de PAGO destrava o cancelamento', async t => {
  const db = await fixture(t, {paid: true});
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  await refund(db, 10000);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);
  const {response} = await patchStatus(db);
  assert.equal(response.status, 200, 'líquido zero e nenhum Pix pendente');
  const s = await state(db);
  assert.equal(s.pedido.status_pedido, 'CANCELADO');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA', 'estorno não repõe estoque (dívida aceita)');
  assert.equal(s.produtos[0].estoque, 8);
});

test('outros status operacionais não são afetados pelo guard', async t => {
  const db = await fixture(t);
  for (const status of ['PREPARANDO', 'PRONTO', 'ENTREGUE']) {
    const {response} = await patchStatus(db, status);
    assert.equal(response.status, 200, `${status} continua permitido com Pix vivo`);
    assert.equal((await state(db)).pedido.status_pedido, status);
  }
});

/* ───────────────────────────── corridas ───────────────────────────── */

test('11. corrida: criação de Pix ADMIN entre a decisão e a escrita do cancelamento', async t => {
  silenciar(t);
  const db = await fixture(t, {ledger: false});
  const session = await app.auth.createSession(db, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    id: 777, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
    point_of_interaction: {transaction_data: {qr_code: 'qr'}},
  }));

  // Sem Pix nenhum, o cancelamento seria permitido. O hook faz nascer um Pix
  // ADMIN exatamente antes do UPDATE do pedido chegar ao banco.
  let criado = false;
  db.hook = async (s, op) => {
    if (op === 'run' && s[0].sql.includes('SET status_pedido = ?') && !criado) {
      criado = true;
      const r = await app.adminPix.onRequestPost({
        env: env(db), params: {id: '1'},
        request: new Request('https://local.test/api/admin/pedidos/1/pix', {
          method: 'POST',
          headers: {Cookie: session.cookie.split(';')[0], 'Content-Type': 'application/json'},
          body: JSON.stringify({valorCentavos: 10000, operationKey: 'corrida-pix-0000-0000-00000000'}),
        }),
      });
      assert.equal(r.status, 201, 'o Pix nasce normalmente');
    }
  };

  const resultado = await patchStatus(db);
  assert.equal(criado, true, 'a corrida foi realmente forçada');
  bloqueado(resultado);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, 'NOVO', 'CANCELADO não coexiste com Pix pendente nascido na corrida');
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos[0].status, 'PENDENTE');
  assert.equal(s.pedido.reserva_status, 'ATIVA', 'reserva do Pix recém-criado preservada');
});

// JANELA CONHECIDA (não introduzida por este guard): o guard financeiro
// continua sendo um SELECT anterior ao UPDATE. Se a aprovação cair exatamente
// entre os dois, no instante da escrita já não existe `PIX_MP/PENDENTE` — a
// política deste commit é respeitada e o cancelamento passa. O teste fixa o
// que É invariante (verdade financeira e baixa única) e registra o desfecho
// operacional para que ele seja uma decisão visível, não uma surpresa.
test('12. corrida: webhook aprova o Pix entre a decisão e a escrita do cancelamento', async t => {
  silenciar(t);
  const db = await fixture(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({id: 101, status: 'approved'}));

  let aprovou = false;
  db.hook = async (s, op) => {
    if (op === 'run' && s[0].sql.includes('SET status_pedido = ?') && !aprovou) {
      aprovou = true;
      const payment = await app.sync.fetchMpPayment('fake', '101');
      await app.sync.syncPaymentFromMp(db, 1, payment);
    }
  };

  const {response, body} = await patchStatus(db);
  assert.equal(aprovou, true, 'a corrida foi realmente forçada');

  const s = await state(db);
  assert.equal(s.pagamentos[0].status, 'PAGO', 'a verdade financeira é preservada');
  assert.equal(s.pagamentos.length, 1, 'nenhum fato duplicado');
  assert.equal(s.produtos[0].estoque, 8, 'baixa física uma única vez');
  assert.equal(s.pedido.reserva_status, 'CONVERTIDA', 'reserva convertida, nunca reaberta');
  assert.equal(s.pedido.status_pagamento, 'PAGO');
  console.log('CORRIDA-12 (janela conhecida) status_pedido=', s.pedido.status_pedido,
    'http=', response.status, 'code=', body.code);
});

test('13. corrida: recuperação B-3 confirma o Pix durante o cancelamento', async t => {
  silenciar(t);
  const db = await fixture(t);
  await db.prepare('UPDATE pedido_pagamentos SET mp_payment_id=NULL WHERE id=1').run();
  const antes = await state(db);

  let recuperou = false;
  db.hook = async (s, op) => {
    if (op === 'run' && s[0].sql.includes('SET status_pedido = ?') && !recuperou) {
      recuperou = true; // a recuperação real não roda aqui (sem operação A1);
      // o que importa é que a tentativa segue PENDENTE no instante da escrita.
    }
  };

  bloqueado(await patchStatus(db));
  assert.equal(recuperou, true);
  const depois = await state(db);
  assert.deepEqual(depois.pagamentos, antes.pagamentos, 'tentativa inconclusiva intocada');
  assert.equal(depois.pedido.status_pedido, 'NOVO');
  assert.equal(depois.pedido.reserva_status, 'ATIVA');
});
