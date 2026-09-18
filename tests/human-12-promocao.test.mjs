import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture} from './helpers/b3.mjs';

// HUMAN-12 — promoção com preço e agendamento, regra ÚNICA de vigência.
//
// Antes: o admin só persistia `promocao_ativa`; `preco_promocional_centavos`,
// `promocao_inicio` e `promocao_fim` nunca eram escritos, e a regra pública
// ignorava o booleano. Ligar o checkbox não mudava preço nenhum.
//
// Nenhuma migration: as colunas existem desde 0001/0005.

const cookieDe = session => session.cookie.split(';')[0];
const {estadoPromocao, precoVigenteCentavos, parseInstantePromocao} = app.promocao;

const AGORA = Date.parse('2026-09-18T12:00:00Z');
const base = {preco_centavos: 5000, preco_promocional_centavos: 4000, promocao_ativa: 1,
  promocao_inicio: null, promocao_fim: null};

/* ───────────────── regra única de vigência (shared) ───────────────── */

test('regra de vigência distingue os cinco estados', () => {
  assert.equal(estadoPromocao({...base, promocao_ativa: 0}, AGORA), 'DESLIGADA');
  assert.equal(estadoPromocao({...base, preco_promocional_centavos: null}, AGORA), 'SEM_PRECO');
  assert.equal(estadoPromocao(base, AGORA), 'VIGENTE', 'sem agendamento vale agora');
  assert.equal(estadoPromocao({...base, promocao_inicio: '2026-09-19T00:00:00Z'}, AGORA), 'FUTURA');
  assert.equal(estadoPromocao({...base, promocao_fim: '2026-09-17T00:00:00Z'}, AGORA), 'EXPIRADA');
  assert.equal(estadoPromocao({
    ...base, promocao_inicio: '2026-09-17T00:00:00Z', promocao_fim: '2026-09-19T00:00:00Z',
  }, AGORA), 'VIGENTE', 'dentro da janela');
});

test('preço vigente segue o estado — expiração é consequência do dado, sem cron', () => {
  assert.equal(precoVigenteCentavos(base, AGORA), 4000);
  assert.equal(precoVigenteCentavos({...base, promocao_ativa: 0}, AGORA), 5000);
  // A MESMA linha, avaliada em três instantes, responde sozinha.
  const agendada = {...base, promocao_inicio: '2026-09-18T10:00:00Z', promocao_fim: '2026-09-18T14:00:00Z'};
  assert.equal(precoVigenteCentavos(agendada, Date.parse('2026-09-18T09:00:00Z')), 5000, 'antes');
  assert.equal(precoVigenteCentavos(agendada, Date.parse('2026-09-18T12:00:00Z')), 4000, 'durante');
  assert.equal(precoVigenteCentavos(agendada, Date.parse('2026-09-18T15:00:00Z')), 5000, 'depois');
});

test('datas são inequívocas: ISO com Z e formato SQLite legado valem o mesmo instante', () => {
  assert.equal(parseInstantePromocao('2026-09-18T12:00:00Z'), AGORA);
  assert.equal(parseInstantePromocao('2026-09-18 12:00:00'), AGORA,
    'CURRENT_TIMESTAMP do SQLite é UTC por definição');
  assert.equal(parseInstantePromocao(null), null);
  assert.equal(parseInstantePromocao('nao e data'), null);
});

/* ─────────────────────── persistência (API admin) ─────────────────────── */

async function catalogo(t) {
  const db = await fixture(t, {ledger: false, reserve: 'SEM_RESERVA'});
  await db.prepare('DELETE FROM pedidos WHERE id=1').run();
  await db.prepare('UPDATE produtos SET estoque=50, estoque_reservado=0, preco_centavos=5000 WHERE id=1').run();
  return {db, session: await app.auth.createSession(db, 1)};
}

const salvar = (db, session, body, id) =>
  (id ? app.adminProdutoId.onRequestPut : app.adminProdutos.onRequestPost)({
    env: {DB: db}, params: {id: String(id ?? '')},
    request: new Request('https://local.test/api/admin/produtos', {
      method: id ? 'PUT' : 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({
        nome: 'Bolo', categoria: 'BOLO', descricao: '', precoCentavos: 5000, estoque: 50, ...body,
      }),
    }),
  });

test('admin persiste preço promocional e agendamento (criação e edição)', async t => {
  const {db, session} = await catalogo(t);
  await db.prepare("INSERT OR IGNORE INTO categorias(id,nome) VALUES('BOLO','Bolo')").run();

  const criado = await salvar(db, session, {
    promocaoAtiva: true, precoPromocionalCentavos: 3990,
    promocaoInicio: '2026-09-17T00:00:00.000Z', promocaoFim: '2026-09-30T00:00:00.000Z',
  });
  assert.equal(criado.status, 201);
  const {id} = await criado.json();

  const novo = await db.prepare(
    `SELECT promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
     FROM produtos WHERE id=?`).bind(id).first();
  assert.equal(novo.promocao_ativa, 1);
  assert.equal(novo.preco_promocional_centavos, 3990, 'centavos, não reais');
  assert.equal(novo.promocao_inicio, '2026-09-17T00:00:00.000Z');
  assert.equal(novo.promocao_fim, '2026-09-30T00:00:00.000Z');

  // Editar preserva o mesmo contrato.
  const editado = await salvar(db, session, {
    promocaoAtiva: true, precoPromocionalCentavos: 4500, promocaoInicio: null, promocaoFim: null,
  }, id);
  assert.equal(editado.status, 200);
  const depois = await db.prepare(
    'SELECT preco_promocional_centavos, promocao_inicio FROM produtos WHERE id=?').bind(id).first();
  assert.equal(depois.preco_promocional_centavos, 4500);
  assert.equal(depois.promocao_inicio, null, 'agendamento pode ser removido');
});

test('desligar a promoção preserva o que já foi configurado, para poder religar', async t => {
  const {db, session} = await catalogo(t);
  await db.prepare("INSERT OR IGNORE INTO categorias(id,nome) VALUES('BOLO','Bolo')").run();
  const {id} = await (await salvar(db, session, {
    promocaoAtiva: true, precoPromocionalCentavos: 3990, promocaoInicio: '2026-09-17T00:00:00.000Z',
  })).json();

  const desligado = await salvar(db, session, {
    promocaoAtiva: false, precoPromocionalCentavos: 3990, promocaoInicio: '2026-09-17T00:00:00.000Z',
  }, id);
  assert.equal(desligado.status, 200);

  const row = await db.prepare(
    `SELECT promocao_ativa, preco_promocional_centavos, promocao_inicio, preco_centavos
     FROM produtos WHERE id=?`).bind(id).first();
  assert.equal(row.promocao_ativa, 0);
  assert.equal(row.preco_promocional_centavos, 3990, 'não é apagado');
  assert.equal(estadoPromocao(row, AGORA), 'DESLIGADA');
  assert.equal(precoVigenteCentavos(row, AGORA), 5000, 'desligada cobra o preço normal');
});

test('validações recusam promoção incoerente sem gravar nada', async t => {
  const {db, session} = await catalogo(t);
  await db.prepare("INSERT OR IGNORE INTO categorias(id,nome) VALUES('BOLO','Bolo')").run();
  const antes = (await db.prepare('SELECT COUNT(*) AS n FROM produtos').first()).n;

  const invalidos = [
    ['sem preço promocional', {promocaoAtiva: true}],
    ['preço promocional zero', {promocaoAtiva: true, precoPromocionalCentavos: 0}],
    ['promocional igual ao normal', {promocaoAtiva: true, precoPromocionalCentavos: 5000}],
    ['promocional maior que o normal', {promocaoAtiva: true, precoPromocionalCentavos: 6000}],
    ['início inválido', {promocaoAtiva: true, precoPromocionalCentavos: 4000, promocaoInicio: 'ontem'}],
    ['fim inválido', {promocaoAtiva: true, precoPromocionalCentavos: 4000, promocaoFim: 'amanha'}],
    ['fim antes do início', {promocaoAtiva: true, precoPromocionalCentavos: 4000,
      promocaoInicio: '2026-09-20T00:00:00Z', promocaoFim: '2026-09-19T00:00:00Z'}],
    ['fim igual ao início', {promocaoAtiva: true, precoPromocionalCentavos: 4000,
      promocaoInicio: '2026-09-20T00:00:00Z', promocaoFim: '2026-09-20T00:00:00Z'}],
  ];
  for (const [nome, body] of invalidos) {
    const r = await salvar(db, session, body);
    assert.equal(r.status, 400, nome);
    assert.equal(typeof (await r.json()).error, 'string', nome);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM produtos').first()).n, antes,
    'nenhum produto criado nas recusas');
});

/* ──────────────── catálogo público e checkout autoritativo ──────────────── */

test('catálogo público expõe a fonte única de ativação', async t => {
  const {db} = await catalogo(t);
  await db.prepare(`UPDATE produtos SET promocao_ativa=1, preco_promocional_centavos=4000,
    promocao_inicio=NULL, promocao_fim=NULL, disponivel=1 WHERE id=1`).run();

  const r = await app.produtos.onRequestGet({env: {DB: db}});
  assert.equal(r.status, 200);
  const {produtos} = await r.json();
  const produto = produtos.find(p => p.id === 1);
  assert.equal(produto.promocao_ativa, 1, 'sem isso o catálogo não aplicaria a regra');
  assert.equal(produto.preco_promocional_centavos, 4000);
  // Catálogo e backend chegam ao mesmo número com a mesma função.
  assert.equal(precoVigenteCentavos(produto, AGORA), 4000);
});

const comprar = (db, operationKey) =>
  app.checkout.onRequestPost({
    env: {DB: db, MP_ACCESS_TOKEN: 'fake'},
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: [{id: 1, quantity: 2}],
        cliente: {nome: 'Teste', whatsapp: '11999999999'},
        // Preço enviado pelo cliente é deliberadamente absurdo: o servidor
        // não pode olhar para ele.
        precoCentavos: 1, price: 0.01,
        operationKey,
      }),
    }),
  });

for (const [nome, promo, esperado] of [
  ['vigente sem agendamento', {ativa: 1, inicio: null, fim: null}, 8000],
  ['desligada', {ativa: 0, inicio: null, fim: null}, 10000],
  ['futura', {ativa: 1, inicio: '2099-01-01T00:00:00Z', fim: null}, 10000],
  ['expirada', {ativa: 1, inicio: null, fim: '2000-01-01T00:00:00Z'}, 10000],
  ['dentro da janela', {ativa: 1, inicio: '2000-01-01T00:00:00Z', fim: '2099-01-01T00:00:00Z'}, 8000],
]) {
  test(`checkout é autoridade do preço: promoção ${nome}`, async t => {
    const {db} = await catalogo(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json({
      id: 5000 + Math.floor(Math.random() * 1000), status: 'pending',
      date_of_expiration: '2099-01-01T00:00:00Z',
      point_of_interaction: {transaction_data: {qr_code: 'qr'}},
    }));
    await db.prepare(`UPDATE produtos SET preco_centavos=5000, preco_promocional_centavos=4000,
      promocao_ativa=?, promocao_inicio=?, promocao_fim=? WHERE id=1`)
      .bind(promo.ativa, promo.inicio, promo.fim).run();

    const r = await comprar(db, `h12-${nome.replace(/\W+/g, '-')}-0000-4000-8000-000000000000`);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.totalCentavos, esperado, '2 unidades pelo preço que o SERVIDOR resolveu');

    const pedido = await db.prepare('SELECT valor_total_centavos FROM pedidos WHERE id=?')
      .bind(corpo.pedidoId).first();
    assert.equal(pedido.valor_total_centavos, esperado);
    const item = await db.prepare('SELECT valor_unitario_centavos FROM pedido_itens WHERE pedido_id=?')
      .bind(corpo.pedidoId).first();
    assert.equal(item.valor_unitario_centavos, esperado / 2, 'preço unitário congelado no pedido');
  });
}

test('pedido manual do admin usa a mesma regra de preço', async t => {
  const {db, session} = await catalogo(t);
  await db.prepare(`UPDATE produtos SET preco_centavos=5000, preco_promocional_centavos=4000,
    promocao_ativa=1, promocao_inicio=NULL, promocao_fim=NULL WHERE id=1`).run();

  const r = await app.adminCreate.onRequestPost({
    env: {DB: db},
    request: new Request('https://local.test/api/admin/pedidos', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify({
        itens: [{produtoId: 1, quantidade: 2}], clienteNome: 'Balcao',
        clienteWhatsapp: '11999999999', metodoPagamento: 'DINHEIRO', statusPagamento: 'PENDENTE',
        operationKey: 'h12-manual-0000-4000-8000-000000000000',
      }),
    }),
  });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).valorTotalCentavos, 8000, 'balcão e site concordam');
});
