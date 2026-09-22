import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './helpers/b3.mjs';
import {
  bancoProducao, aplicarB5, aplicarEstoquePorItem, aplicarOperacaoPorItem,
  aplicarCancelamentoPorItem, aplicarCheckoutRateLimit,
  aplicarTrocaPorItem, aplicarRefundPixMpRecuperavel, aplicarCoberturaFinanceiraLinhagem, aplicarPedidoAnulacoes,
  validarB5, snapshot, SCRIPT_B5,
} from './helpers/b5.mjs';

// B5 — simulação do cutover contra a TOPOLOGIA real do D1 de produção.
//
// Nada aqui toca o banco remoto: o harness monta um D1 local descartável com
// o schema histórico observado na auditoria, aplica
// `scripts/b5-production-compat.sql` e exercita os handlers REAIS do rebuild.

const silenciar = t => t.mock.method(console, 'error', () => {});
const env = db => ({ DB: db, MP_ACCESS_TOKEN: 'fake' });
const KEY_SITE = 'b5-site-0000-0000-000000000001';
const KEY_ADMIN = 'b5-admin-0000-0000-00000000001';

const contar = async (db, tabela) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).first()).n;

function mpPixOk(t) {
  return t.mock.method(globalThis, 'fetch', async () => Response.json({
    id: 777001, status: 'pending', date_of_expiration: '2099-01-01T00:00:00Z',
    point_of_interaction: { transaction_data: { qr_code: 'qr', qr_code_base64: 'b64' } },
  }));
}

async function checkoutSite(db, items, operationKey = KEY_SITE) {
  return app.checkout.onRequestPost({
    env: env(db),
    request: new Request('https://local.test/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        items, cliente: { nome: 'Cliente Teste', whatsapp: '11999999999' },
        recado: 'sem cebola', operationKey,
      }),
    }),
  });
}

async function pedidoAdmin(db, itens, operationKey = KEY_ADMIN, extra = {}) {
  const session = await app.auth.createSession(db, 1);
  return app.admin.onRequestPost({
    env: env(db),
    request: new Request('https://local.test/api/admin/pedidos', {
      method: 'POST',
      headers: { Cookie: session.cookie.split(';')[0], Origin: 'https://local.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteNome: 'Balcao Teste', clienteWhatsapp: '11988888888',
        itens, metodoPagamento: 'DINHEIRO', statusPagamento: 'PENDENTE',
        operationKey, ...extra,
      }),
    }),
  });
}

/* ═══════════════ PARTE 5 — simulação do cutover ═══════════════ */

test('A→B: o script B5 é puramente aditivo e preserva 100% dos dados', async t => {
  const db = await bancoProducao(t);
  const antes = await snapshot(db);

  // ESTADO A — confere que a topologia reproduz a auditoria.
  assert.equal(antes.produtos.length, 5);
  assert.equal(antes.categorias.length, 3);
  assert.equal(antes.pedidos.length, 26);
  assert.equal(antes.pedido_itens.length, 34);
  assert.equal(antes.pedido_pagamentos.length, 27);
  assert.equal(antes.pedido_pagamento_alocacoes.length, 35);
  assert.equal(antes.pedido_reembolsos.length, 0);
  assert.equal(antes.__fk, 0);
  assert.equal(antes.__objetos.some(o => o.name === 'pedido_operacoes'), false,
    'pedido_operacoes não existe antes do B5');

  await aplicarB5(db);
  const depois = await snapshot(db);

  // Nenhuma linha de nenhuma tabela histórica mudou — comparação integral,
  // linha a linha, coluna a coluna (inclui ids, valores e timestamps).
  for (const tabela of ['produtos', 'categorias', 'pedidos', 'pedido_itens',
    'pedido_pagamentos', 'pedido_pagamento_alocacoes', 'pedido_reembolsos',
    'usuarios_admin', 'configuracoes_loja']) {
    assert.deepEqual(depois[tabela], antes[tabela], `${tabela} preservada byte a byte`);
  }

  // Nenhum objeto de schema foi removido.
  for (const objeto of antes.__objetos) {
    assert.ok(depois.__objetos.some(o => o.type === objeto.type && o.name === objeto.name),
      `objeto preservado: ${objeto.type} ${objeto.name}`);
  }
  assert.equal(depois.__fk, 0, 'FKs continuam válidas');

  // E apenas os objetos esperados foram acrescentados.
  const novos = depois.__objetos
    .filter(o => !antes.__objetos.some(a => a.type === o.type && a.name === o.name))
    .map(o => o.name).sort();
  assert.deepEqual(novos, [
    'idx_pedido_operacoes_fase', 'idx_pedido_operacoes_pedido',
    'idx_pedido_pagamentos_mp_payment_id', 'pedido_operacoes',
    'uq_pedido_operacoes_key', 'uq_pedidos_mp_payment_id',
  ].sort());
});

test('a validação B5 aprova tudo depois da aplicação e reprova antes', async t => {
  const db = await bancoProducao(t);
  const antes = (await validarB5(db)).filter(l => l.resultado);
  assert.ok(antes.some(l => l.resultado === 'FALHA'),
    'sem o script, a validação precisa acusar FALHA');

  await aplicarB5(db);
  const depois = (await validarB5(db)).filter(l => l.resultado);
  const falhas = depois.filter(l => l.resultado === 'FALHA');
  assert.deepEqual(falhas, [], 'nenhuma verificação pode falhar após o B5');
  assert.ok(depois.length >= 12, 'a validação cobre as verificações esperadas');
});

test('pedido_operacoes homônima e divergente é rejeitada, nunca aceita em silêncio', async t => {
  const db = await bancoProducao(t);
  // Alguém já criou uma tabela com esse nome e estrutura errada.
  await db.prepare(`CREATE TABLE pedido_operacoes (id INTEGER PRIMARY KEY, operation_key TEXT)`).run();

  // Rede 1: o `CREATE TABLE IF NOT EXISTS` silencia, mas os índices seguintes
  // referenciam colunas que não existem e derrubam o script.
  await assert.rejects(aplicarB5(db), /no such column/i);

  // Rede 2: a validação confere o schema e acusa, independentemente do script.
  const falhas = (await validarB5(db)).filter(l => l.resultado === 'FALHA').map(l => l.verificacao);
  assert.ok(falhas.includes('pedido_operacoes: 18 colunas'));
  assert.ok(falhas.includes('pedido_operacoes: colunas esperadas'));
  assert.ok(falhas.includes('pedido_operacoes: NOT NULL obrigatorios'));
  assert.ok(falhas.includes('pedido_operacoes: indices de apoio'));
});

test('aplicar o script duas vezes é seguro e não duplica objetos', async t => {
  const db = await bancoProducao(t);
  await aplicarB5(db);
  const primeira = await snapshot(db);
  await aplicarB5(db);
  const segunda = await snapshot(db);
  assert.deepEqual(segunda, primeira, 'reexecução é inerte');
  assert.deepEqual((await validarB5(db)).filter(l => l.resultado === 'FALHA'), []);
});

/* ═══════════════ PARTE 6 — UNIQUE de pedidos.mp_payment_id ═══════════════ */

test('UNIQUE mp_payment_id: rejeita duplicata, permite NULLs e ids distintos', async t => {
  const db = await bancoProducao(t);
  await aplicarB5(db);

  const inserir = (id, mpId) => db.prepare(
    `INSERT INTO pedidos(id,token_publico,produto_nome,quantidade,valor_unitario_centavos,
       valor_total_centavos,cliente_nome,cliente_email,idempotency_key,mp_payment_id)
     VALUES(?,?,'',1,0,0,'X','',?,?)`).bind(id, `tk-${id}`, `idem-${id}`, mpId).run();

  // O pedido 1 do fixture já usa '90001'.
  await assert.rejects(inserir(900, '90001'), /UNIQUE|constraint/i,
    'segundo pedido com o mesmo mp_payment_id é rejeitado');
  assert.equal(await contar(db, 'pedidos'), 26, 'nada foi gravado na tentativa');

  await inserir(901, null);
  await inserir(902, null);
  assert.equal(await contar(db, 'pedidos'), 28, 'múltiplos NULL continuam permitidos');

  await inserir(903, '90999');
  assert.equal(await contar(db, 'pedidos'), 29, 'mp_payment_id distinto continua permitido');
});

/* ═══════════════ PARTE 10 — duplicata pré-existente: fail-closed ═══════════════ */

test('duplicata pré-existente faz o B5 FALHAR sem alterar nenhum dado', async t => {
  const db = await bancoProducao(t);
  // Cria a condição que produção hoje não tem, ANTES do upgrade.
  await db.prepare(
    `INSERT INTO pedidos(id,token_publico,produto_nome,quantidade,valor_unitario_centavos,
       valor_total_centavos,cliente_nome,cliente_email,idempotency_key,mp_payment_id)
     VALUES(500,'tk-dup','',1,0,0,'X','','idem-dup','90001')`).run();
  const antes = await snapshot(db);
  assert.equal(antes.pedidos.length, 27);

  await assert.rejects(aplicarB5(db), /UNIQUE|constraint/i,
    'o índice único não pode ser criado sobre dados duplicados');

  const depois = await snapshot(db);
  assert.deepEqual(depois.pedidos, antes.pedidos,
    'nenhuma duplicata foi apagada, nenhum vencedor foi escolhido');
  assert.deepEqual(depois.pedido_pagamentos, antes.pedido_pagamentos);
  assert.equal(depois.__fk, 0);
  // A parte aditiva anterior ao índice pode ter sido criada; o que não pode
  // é a validação passar com o banco nesse estado.
  const falhas = (await validarB5(db)).filter(l => l.resultado === 'FALHA');
  assert.ok(falhas.length > 0, 'validação acusa o banco como incompatível');
  assert.ok(falhas.some(l => l.verificacao === 'pedidos: mp_payment_id UNICO'));
  assert.ok(falhas.some(l => l.verificacao === 'pedidos: zero duplicatas mp_payment_id'));
});

/* ═══════════════ PARTE 7 — handlers reais contra o schema legado ═══════════════ */

test('SITE: checkout real cria pedido multi-item contra o schema de produção', async t => {
  silenciar(t);
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  await aplicarCheckoutRateLimit(db);
  mpPixOk(t);
  const pedidosAntes = await contar(db, 'pedidos');

  const resposta = await checkoutSite(db, [{ id: 1, quantity: 2 }, { id: 2, quantity: 3 }]);
  assert.equal(resposta.status, 200, 'INSERT não pode falhar por NOT NULL legado');
  const corpo = await resposta.json();

  assert.equal(await contar(db, 'pedidos'), pedidosAntes + 1);
  const novo = await db.prepare('SELECT * FROM pedidos WHERE id = ?').bind(corpo.pedidoId).first();

  // Total correto: 2×5000 + 3×300 = 10900.
  assert.equal(novo.valor_total_centavos, 10900);
  assert.equal(novo.status_pagamento, 'PENDENTE');
  assert.equal(novo.origem_pedido, 'SITE');
  assert.equal(novo.reserva_status, 'ATIVA');
  assert.ok(novo.reserva_expira_em, 'reserva com prazo');
  assert.equal(novo.mp_payment_id, '777001');

  // Colunas legadas: preenchidas com os valores neutros, sem semântica.
  assert.equal(novo.cliente_email, '');
  assert.equal(novo.produto_nome, '');
  assert.equal(novo.quantidade, 1);
  assert.equal(novo.valor_unitario_centavos, 0);
  assert.equal(novo.produto_id, null, 'legado produto_id continua NULL em multi-item');

  // A verdade do pedido está nos itens.
  const itens = (await db.prepare(
    'SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id').bind(corpo.pedidoId).all()).results;
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map(i => [i.produto_id, i.quantidade, i.valor_total_centavos]),
    [[1, 2, 10000], [2, 3, 900]]);
  assert.ok(itens.every(i => i.status_item === 'ATIVO' && i.estoque_estado === 'RESERVADO'));
  assert.equal(itens.reduce((s, i) => s + i.valor_total_centavos, 0), novo.valor_total_centavos);

  // Reserva física aplicada nos produtos.
  const p1 = await db.prepare('SELECT * FROM produtos WHERE id=1').first();
  assert.equal(p1.estoque_reservado, 2);

  // Ledger + A1.
  const pag = await db.prepare(
    'SELECT * FROM pedido_pagamentos WHERE pedido_id = ?').bind(corpo.pedidoId).first();
  assert.equal(pag.metodo, 'PIX_MP');
  assert.equal(pag.origem, 'SITE');
  assert.equal(pag.valor_centavos, 10900);
  const op = await db.prepare(
    'SELECT * FROM pedido_operacoes WHERE operation_key = ?').bind(KEY_SITE).first();
  assert.equal(op.tipo, 'CHECKOUT_SITE');
  assert.equal(op.fase, 'CONCLUIDA');
  assert.equal(op.pedido_id, corpo.pedidoId);
});

test('SITE: A1 continua idempotente contra o schema legado', async t => {
  silenciar(t);
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  await aplicarCheckoutRateLimit(db);
  mpPixOk(t);

  const primeira = await (await checkoutSite(db, [{ id: 1, quantity: 1 }])).json();
  const segunda = await (await checkoutSite(db, [{ id: 1, quantity: 1 }])).json();
  assert.deepEqual(segunda, primeira, 'replay devolve o mesmo resultado');
  assert.equal(await contar(db, 'pedidos'), 27, 'nenhum segundo pedido');
  assert.equal(await contar(db, 'pedido_operacoes'), 1);
});

test('ADMIN: pedido manual real é criado contra o schema de produção', async t => {
  silenciar(t);
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  const pedidosAntes = await contar(db, 'pedidos');

  const resposta = await pedidoAdmin(db, [
    { produtoId: 3, quantidade: 1 }, { produtoId: 2, quantidade: 2 },
  ]);
  assert.equal(resposta.status, 201, 'INSERT não pode falhar por NOT NULL legado');
  const corpo = await resposta.json();

  assert.equal(await contar(db, 'pedidos'), pedidosAntes + 1);
  const novo = await db.prepare('SELECT * FROM pedidos WHERE id = ?').bind(corpo.pedidoId).first();

  assert.equal(novo.valor_total_centavos, 7000 + 600);
  assert.equal(novo.origem_pedido, 'MANUAL');
  assert.equal(novo.reserva_status, 'ATIVA');
  assert.equal(novo.reserva_expira_em, null, 'reserva de balcão não expira sozinha (B-1)');
  assert.equal(novo.status_pagamento, 'PENDENTE');

  assert.equal(novo.cliente_email, '');
  assert.equal(novo.produto_nome, '');
  assert.equal(novo.quantidade, 1);
  assert.equal(novo.valor_unitario_centavos, 0);

  const itens = (await db.prepare(
    'SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id').bind(corpo.pedidoId).all()).results;
  assert.equal(itens.length, 2);
  assert.equal(itens.reduce((s, i) => s + i.valor_total_centavos, 0), novo.valor_total_centavos);
  assert.ok(itens.every(i => i.status_item === 'ATIVO' && i.estoque_estado === 'RESERVADO'));

  const p3 = await db.prepare('SELECT * FROM produtos WHERE id=3').first();
  assert.equal(p3.estoque_reservado, 1, 'reserva do balcão aplicada');

  const op = await db.prepare(
    'SELECT * FROM pedido_operacoes WHERE operation_key = ?').bind(KEY_ADMIN).first();
  assert.equal(op.tipo, 'PEDIDO_ADMIN');
  assert.equal(op.pedido_id, corpo.pedidoId);
});

test('ADMIN: replay da mesma key não cria segundo pedido de balcão', async t => {
  silenciar(t);
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  const a = await (await pedidoAdmin(db, [{ produtoId: 2, quantidade: 1 }])).json();
  const b = await (await pedidoAdmin(db, [{ produtoId: 2, quantidade: 1 }])).json();
  assert.equal(b.pedidoId, a.pedidoId);
  assert.equal(await contar(db, 'pedidos'), 27);
});

/* ═══════════════ PARTE 9 — pedido histórico inconsistente ═══════════════ */

test('reconciliador reconhece a baixa histórica por item sem repetir efeito', async t => {
  silenciar(t);
  const db = await bancoProducao(t);
  await aplicarB5(db);
  await aplicarEstoquePorItem(db);
  await aplicarOperacaoPorItem(db);
  await aplicarCancelamentoPorItem(db);
  await aplicarTrocaPorItem(db);
  await aplicarRefundPixMpRecuperavel(db);
  await aplicarCoberturaFinanceiraLinhagem(db);
  await aplicarPedidoAnulacoes(db);
  const antes = await snapshot(db);

  // O pedido 5 é o caso observado: PAGO, reserva ATIVA, pedidos
  // .estoque_baixado_em NULL, itens já baixados.
  const resultado = await app.reconcile.reconcilePedidoAfterFinancialChange(db, 5);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.statusFinanceiro, 'PAGO');
  assert.deepEqual(resultado.estoque, {ok: true, baixado: false});

  // E a varredura oportunista do painel admin também não muta nada.
  await app.reconcile.reconcilePedidosDivergentes(db);

  const depois = await snapshot(db);
  assert.deepEqual(depois.produtos, antes.produtos, 'estoque e reservado intactos');
  assert.deepEqual(depois.pedido_itens, antes.pedido_itens, 'itens intactos');
  assert.deepEqual(depois.pedido_pagamentos, antes.pedido_pagamentos, 'financeiro intacto');
  assert.deepEqual(depois.pedido_pagamento_alocacoes, antes.pedido_pagamento_alocacoes);
  const pedido5depois = depois.pedidos.find(p => p.id === 5);
  assert.equal(pedido5depois.reserva_status, 'CONVERTIDA');
  assert.ok(pedido5depois.estoque_baixado_em, 'projecao global e reparada a partir do item');
  assert.equal(depois.pedido_itens.find(i => i.id === 7).estoque_estado, 'BAIXADO');
});

/* ═══════════════ PARTE 8 — compatibilidade com o código antigo ═══════════════ */

test('código antigo continuaria funcionando: nada foi removido nem endurecido', async t => {
  const db = await bancoProducao(t);
  const antes = await snapshot(db);
  await aplicarB5(db);

  // Nenhuma coluna desapareceu de nenhuma tabela usada pelo código antigo.
  for (const tabela of ['pedidos', 'pedido_itens', 'pedido_pagamentos', 'produtos']) {
    const colsAntes = Object.keys(antes[tabela][0] ?? {});
    const atual = await db.prepare(`SELECT * FROM ${tabela} LIMIT 1`).first();
    for (const col of colsAntes) {
      assert.ok(col in atual, `${tabela}.${col} continua existindo`);
    }
  }

  // Escrita no estilo do código antigo (um produto por pedido, com as
  // colunas legadas preenchidas de verdade) continua aceita.
  await db.prepare(
    `INSERT INTO pedidos(id,token_publico,produto_id,produto_nome,quantidade,
       valor_unitario_centavos,valor_total_centavos,cliente_nome,cliente_email,
       cliente_whatsapp,idempotency_key,metodo_pagamento,mp_order_id)
     VALUES(600,'tk-legado',1,'Produto 1',2,5000,10000,'Legado','x@example.invalid',
            '000','idem-legado','PIX','ord-legado')`).run();
  const legado = await db.prepare('SELECT * FROM pedidos WHERE id=600').first();
  assert.equal(legado.quantidade, 2, 'o modelo antigo continua gravável');
  assert.equal(legado.valor_unitario_centavos, 5000);

  // UPDATE no estilo antigo (sem mp_payment_id) segue aceito.
  await db.prepare(
    `UPDATE pedidos SET status_pagamento='PAGO', mp_status='approved' WHERE id=600`).run();
  assert.equal((await db.prepare('SELECT status_pagamento FROM pedidos WHERE id=600').first())
    .status_pagamento, 'PAGO');

  // O único endurecimento é o UNIQUE parcial — e ele só recusa o que o
  // rebuild já considerava proibido: dois pedidos com o MESMO id remoto.
  await db.prepare(`UPDATE pedidos SET mp_payment_id='novo-id' WHERE id=600`).run();
  await assert.rejects(
    db.prepare(`UPDATE pedidos SET mp_payment_id='novo-id' WHERE id=1`).run(),
    /UNIQUE|constraint/i);
});

test('o script não contém DDL destrutivo', async () => {
  const proibido = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|VACUUM|REPLACE)\b/i;
  for (const statement of SCRIPT_B5) {
    // `ON DELETE CASCADE/SET NULL` é declaração de FK, não comando de escrita.
    const semReferencial = statement.replace(/ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)/gi, '');
    assert.ok(!proibido.test(semReferencial),
      `statement do B5 deve ser apenas CREATE: ${statement.slice(0, 60)}`);
    assert.match(statement, /^CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/i);
  }
});
