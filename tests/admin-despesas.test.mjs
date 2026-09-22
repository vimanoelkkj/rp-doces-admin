import test from 'node:test';
import assert from 'node:assert/strict';
import {app, fixture, state} from './helpers/b3.mjs';

// Despesas itemizadas (migration 0026) — domínio separado do ledger de
// pedidos. Cobre os cenários 1-42 e 48 do pedido original; 43-47 (sem F5,
// dark mode, mobile) estão em admin-despesas-ui.test.mjs.

const cookieDe = session => session.cookie.split(';')[0];

async function setup(t) {
  const db = await fixture(t, {paid: false, reserve: 'ATIVA'});
  const session = await app.auth.createSession(db, 1);
  return {db, session};
}

function listar(db, session, query = {}, origin = true) {
  const params = new URLSearchParams({desde: '2026-01-01', ate: '2026-12-31', ...query});
  return app.adminDespesas.onRequestGet({
    env: {DB: db}, params: {}, waitUntil() {},
    request: new Request(`https://local.test/api/admin/despesas?${params.toString()}`, {
      headers: session ? {Cookie: cookieDe(session)} : {},
    }),
  });
}

function criar(db, session, body, {origin = true, semSessao = false} = {}) {
  return app.adminDespesas.onRequestPost({
    env: {DB: db}, params: {}, waitUntil() {},
    request: new Request('https://local.test/api/admin/despesas', {
      method: 'POST',
      headers: {
        ...(origin ? {Origin: 'https://local.test'} : {}),
        'Content-Type': 'application/json',
        ...(semSessao ? {} : {Cookie: cookieDe(session)}),
      },
      body: JSON.stringify(body),
    }),
  });
}

function obter(db, session, id) {
  return app.adminDespesaId.onRequestGet({
    env: {DB: db}, params: {id: String(id)}, waitUntil() {},
    request: new Request(`https://local.test/api/admin/despesas/${id}`, {
      headers: {Cookie: cookieDe(session)},
    }),
  });
}

function editar(db, session, id, body) {
  return app.adminDespesaId.onRequestPut({
    env: {DB: db}, params: {id: String(id)}, waitUntil() {},
    request: new Request(`https://local.test/api/admin/despesas/${id}`, {
      method: 'PUT',
      headers: {Origin: 'https://local.test', 'Content-Type': 'application/json', Cookie: cookieDe(session)},
      body: JSON.stringify(body),
    }),
  });
}

function cancelar(db, session, id) {
  return app.adminDespesaCancelar.onRequestPost({
    env: {DB: db}, params: {id: String(id)}, waitUntil() {},
    request: new Request(`https://local.test/api/admin/despesas/${id}/cancelar`, {
      method: 'POST', headers: {Origin: 'https://local.test', Cookie: cookieDe(session)},
    }),
  });
}

async function corpo(response) { return {status: response.status, body: await response.json()}; }

function itemBasico(overrides = {}) {
  return {
    descricao: 'Ovos', categoria: 'INGREDIENTES', quantidade: 30, unidade: 'UN',
    valorUnitarioCentavos: 80, ...overrides,
  };
}

function despesaBasica(overrides = {}) {
  return {
    fornecedor: 'Atacadão', dataCompetencia: '2026-09-22', observacao: 'Compra da semana',
    itens: [itemBasico()], ...overrides,
  };
}

// 1) migration 0026 sobre schema atual
test('1: migration 0026 cria despesas/despesa_itens utilizáveis sobre o schema atual', async t => {
  const {db} = await setup(t);
  await db.prepare(`INSERT INTO despesas(fornecedor,data_competencia,status,total_centavos,criado_por_usuario_id)
    VALUES('X','2026-01-01','ATIVA',100,1)`).run();
  await db.prepare(`INSERT INTO despesa_itens(despesa_id,descricao,categoria,quantidade_milesimos,unidade,
    valor_unitario_centavos,valor_total_centavos) VALUES(1,'Y','OUTROS',1000,'UN',100,100)`).run();
  const row = await db.prepare('SELECT * FROM despesas WHERE id=1').first();
  assert.equal(row.fornecedor, 'X');
});

// 2) PRAGMA foreign_key_check vazio
test('2: foreign_key_check vazio após popular despesas', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica());
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

// 3) criar despesa com 1 item
test('3: cria despesa com 1 item', async t => {
  const {db, session} = await setup(t);
  const {status, body} = await corpo(await criar(db, session, despesaBasica()));
  assert.equal(status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.despesa.itemCount, 1);
  assert.equal(body.despesa.totalCentavos, 2400);
  assert.equal(body.despesa.status, 'ATIVA');
});

// 4) criar despesa com vários itens
test('4: cria despesa com vários itens', async t => {
  const {db, session} = await setup(t);
  const itens = [
    itemBasico({descricao: 'Ovos', quantidade: 30, valorUnitarioCentavos: 80}),
    itemBasico({descricao: 'Massa pronta', quantidade: 3, valorUnitarioCentavos: 800}),
    itemBasico({descricao: 'Leite condensado', quantidade: 6, valorUnitarioCentavos: 750}),
    itemBasico({descricao: 'Embalagem 220ml', categoria: 'EMBALAGENS', quantidade: 10, valorUnitarioCentavos: 100}),
  ];
  const {status, body} = await corpo(await criar(db, session, despesaBasica({itens})));
  assert.equal(status, 201);
  assert.equal(body.despesa.itemCount, 4);
  // 5) total correto: 24 + 24 + 45 + 10 = R$103,00
  assert.equal(body.despesa.totalCentavos, 10300);
});

// 6) total falso do frontend ignorado
test('6: valor total enviado pelo cliente é ignorado; servidor sempre recalcula', async t => {
  const {db, session} = await setup(t);
  const {body} = await corpo(await criar(db, session, despesaBasica({
    totalCentavos: 999999,
    itens: [itemBasico({valorTotalCentavos: 999999, total: 999999})],
  })));
  assert.equal(body.despesa.totalCentavos, 2400, 'ignora totalCentavos/valorTotalCentavos do cliente');
  assert.equal(body.despesa.itens[0].valorTotalCentavos, 2400);
});

// 7) quantidade 0 rejeitada
test('7: quantidade 0 é rejeitada', async t => {
  const {db, session} = await setup(t);
  const {status} = await corpo(await criar(db, session, despesaBasica({itens: [itemBasico({quantidade: 0})]})));
  assert.equal(status, 400);
});

// 8) quantidade negativa rejeitada
test('8: quantidade negativa é rejeitada', async t => {
  const {db, session} = await setup(t);
  const {status} = await corpo(await criar(db, session, despesaBasica({itens: [itemBasico({quantidade: -5})]})));
  assert.equal(status, 400);
});

// 9) valor unitário inválido rejeitado
for (const valorUnitarioCentavos of [0, -100, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`9: valor unitário inválido (${valorUnitarioCentavos}) é rejeitado`, async t => {
    const {db, session} = await setup(t);
    const {status} = await corpo(await criar(db, session, despesaBasica({itens: [itemBasico({valorUnitarioCentavos})]})));
    assert.equal(status, 400);
  });
}

// 10) categoria inválida
test('10: categoria inválida é rejeitada', async t => {
  const {db, session} = await setup(t);
  const {status} = await corpo(await criar(db, session, despesaBasica({itens: [itemBasico({categoria: 'BOLO'})]})));
  assert.equal(status, 400);
});

// 11) unidade inválida
test('11: unidade inválida é rejeitada', async t => {
  const {db, session} = await setup(t);
  const {status} = await corpo(await criar(db, session, despesaBasica({itens: [itemBasico({unidade: 'TONELADA'})]})));
  assert.equal(status, 400);
});

// 12) despesa sem itens
test('12: despesa sem itens é rejeitada', async t => {
  const {db, session} = await setup(t);
  const {status} = await corpo(await criar(db, session, despesaBasica({itens: []})));
  assert.equal(status, 400);
});

// 13) editar cabeçalho
test('13: edita cabeçalho preservando itens', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const {status, body} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({
    fornecedor: 'Assaí', dataCompetencia: '2026-09-23', observacao: 'Outra observação',
  })));
  assert.equal(status, 200);
  assert.equal(body.despesa.fornecedor, 'Assaí');
  assert.equal(body.despesa.dataCompetencia, '2026-09-23');
  assert.equal(body.despesa.itemCount, 1);
});

// 14) editar itens
test('14: edita valores de item existente', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const {body} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({
    itens: [itemBasico({quantidade: 10, valorUnitarioCentavos: 100})],
  })));
  assert.equal(body.despesa.totalCentavos, 1000);
  assert.equal(body.despesa.itens[0].quantidade, 10);
});

// 15) adicionar item
test('15: adiciona item numa edição', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const {body} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({
    itens: [itemBasico(), itemBasico({descricao: 'Leite', valorUnitarioCentavos: 520})],
  })));
  assert.equal(body.despesa.itemCount, 2);
  assert.equal(body.despesa.totalCentavos, 2400 + 15600);
});

// 16) remover item
test('16: remove item numa edição', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica({
    itens: [itemBasico(), itemBasico({descricao: 'Leite', valorUnitarioCentavos: 520})],
  })));
  assert.equal(criada.despesa.itemCount, 2);
  const {body} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({itens: [itemBasico()]})));
  assert.equal(body.despesa.itemCount, 1);
  assert.equal(body.despesa.totalCentavos, 2400);
});

// 17) impedir despesa ativa sem item
test('17: edição que zeraria os itens é rejeitada; despesa preserva os itens antigos', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const {status} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({itens: []})));
  assert.equal(status, 400);
  const despesa = await obter(db, session, criada.despesa.id).then(corpo);
  assert.equal(despesa.body.despesa.itemCount, 1, 'itens antigos preservados: edição inválida não teve efeito');
});

// 18) cancelar despesa
test('18: cancela despesa e preserva histórico', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const {status, body} = await corpo(await cancelar(db, session, criada.despesa.id));
  assert.equal(status, 200);
  assert.equal(body.despesa.status, 'CANCELADA');
  assert.ok(body.despesa.canceladoEm);
  assert.equal(body.despesa.canceladoPorUsuarioId, 1);
  assert.equal(body.despesa.itemCount, 1, 'itens continuam no histórico');
});

// 19) cancelar duas vezes
test('19: cancelar duas vezes é idempotente', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  await cancelar(db, session, criada.despesa.id);
  const {status, body} = await corpo(await cancelar(db, session, criada.despesa.id));
  assert.equal(status, 200);
  assert.equal(body.replay, true);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM despesas').first()).n, 1);
});

// 20) cancelada fora do total
test('20: despesa cancelada some do resumo/resultado financeiro', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  const antes = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(antes.body.resumo.totalCentavos, 2400);
  await cancelar(db, session, criada.despesa.id);
  const depois = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(depois.body.resumo.totalCentavos, 0);
  assert.equal(depois.body.resultadoFinanceiro.despesasCentavos, 0);
  // continua visível na listagem (histórico), só sai dos totais válidos.
  assert.equal(depois.body.despesas.find(d => d.id === criada.despesa.id).status, 'CANCELADA');
});

// 21) cancelada não editável
test('21: despesa cancelada não pode ser editada', async t => {
  const {db, session} = await setup(t);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  await cancelar(db, session, criada.despesa.id);
  const {status, body} = await corpo(await editar(db, session, criada.despesa.id, despesaBasica({fornecedor: 'Outro'})));
  assert.equal(status, 409);
  assert.equal(body.code, 'DESPESA_CANCELADA');
});

// 22) filtro por data
test('22: filtro por data (desde/ate) exclui despesas fora do período', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({dataCompetencia: '2026-09-22'}));
  await criar(db, session, despesaBasica({dataCompetencia: '2026-01-01'}));
  const {body} = await listar(db, session, {desde: '2026-09-01', ate: '2026-09-30'}).then(corpo);
  assert.equal(body.despesas.length, 1);
  assert.equal(body.despesas[0].dataCompetencia, '2026-09-22');
});

// 23) filtro por categoria (a categorização não mistura categorias distintas)
test('23: itens de categorias diferentes não se misturam no resumo', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({
    itens: [
      itemBasico({categoria: 'INGREDIENTES', valorUnitarioCentavos: 100, quantidade: 10}),
      itemBasico({descricao: 'Caixa', categoria: 'EMBALAGENS', valorUnitarioCentavos: 200, quantidade: 5}),
    ],
  }));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  const ingredientes = body.resumo.porCategoria.find(c => c.categoria === 'INGREDIENTES');
  const embalagens = body.resumo.porCategoria.find(c => c.categoria === 'EMBALAGENS');
  assert.equal(ingredientes.valorCentavos, 1000);
  assert.equal(embalagens.valorCentavos, 1000);
  assert.equal(body.resumo.porCategoria.length, 2);
});

// 24) busca por fornecedor
test('24: busca encontra por fornecedor', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({fornecedor: 'Atacadão'}));
  await criar(db, session, despesaBasica({fornecedor: 'Assaí'}));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22', search: 'Atacad'}).then(corpo);
  assert.equal(body.despesas.length, 1);
  assert.equal(body.despesas[0].fornecedor, 'Atacadão');
});

// 25) busca por item
test('25: busca encontra por descrição de item', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({fornecedor: 'Fornecedor A', itens: [itemBasico({descricao: 'Chocolate meio amargo'})]}));
  await criar(db, session, despesaBasica({fornecedor: 'Fornecedor B', itens: [itemBasico({descricao: 'Manteiga'})]}));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22', search: 'Chocolate'}).then(corpo);
  assert.equal(body.despesas.length, 1);
  assert.equal(body.despesas[0].fornecedor, 'Fornecedor A');
});

// 26) total por categoria
test('26: total por categoria soma corretamente entre despesas diferentes', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({itens: [itemBasico({categoria: 'INGREDIENTES', valorUnitarioCentavos: 100, quantidade: 10})]}));
  await criar(db, session, despesaBasica({itens: [itemBasico({categoria: 'INGREDIENTES', valorUnitarioCentavos: 200, quantidade: 10})]}));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resumo.porCategoria.length, 1);
  assert.equal(body.resumo.porCategoria[0].valorCentavos, 3000);
  assert.equal(body.resumo.porCategoria[0].percentual, 100);
});

// 27) ranking por item
test('27: ranking por item ordena por maior gasto', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({itens: [
    itemBasico({descricao: 'Leite condensado', valorUnitarioCentavos: 750, quantidade: 6}),
    itemBasico({descricao: 'Ovos', valorUnitarioCentavos: 80, quantidade: 30}),
  ]}));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.deepEqual(body.resumo.rankingItens.map(i => i.descricao), ['Leite condensado', 'Ovos']);
});

// 28) agrupamento case-insensitive
test('28: ranking agrupa "Ovos"/"ovos" mas não junta com "Ovo"', async t => {
  const {db, session} = await setup(t);
  await criar(db, session, despesaBasica({itens: [itemBasico({descricao: 'Ovos', valorUnitarioCentavos: 100, quantidade: 1})]}));
  await criar(db, session, despesaBasica({itens: [itemBasico({descricao: ' ovos ', valorUnitarioCentavos: 100, quantidade: 1})]}));
  await criar(db, session, despesaBasica({itens: [itemBasico({descricao: 'Ovo', valorUnitarioCentavos: 100, quantidade: 1})]}));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  const ovos = body.resumo.rankingItens.find(i => i.descricao.trim().toLowerCase() === 'ovos');
  const ovo = body.resumo.rankingItens.find(i => i.descricao === 'Ovo');
  assert.equal(ovos.valorCentavos, 200, '"Ovos" e "ovos" somados');
  assert.equal(ovo.valorCentavos, 100, '"Ovo" continua separado');
});

async function configurarFaturamento(db, {valorCentavos, data}) {
  await db.batch([
    db.prepare(`UPDATE pedidos SET valor_total_centavos=? WHERE id=1`).bind(valorCentavos),
    db.prepare(`UPDATE pedido_pagamentos SET valor_centavos=?, status='PAGO', pago_em=? WHERE id=1`)
      .bind(valorCentavos, `${data} 10:00:00`),
    db.prepare(`UPDATE pedido_pagamento_alocacoes SET valor_centavos=? WHERE id=1`).bind(valorCentavos),
  ]);
}

// 29/30) faturamento 100 / gasto 40 = lucro 60, margem 60%
test('29/30: faturamento 100 e gasto 40 resultam em lucro 60 (margem 60%)', async t => {
  const {db, session} = await setup(t);
  await configurarFaturamento(db, {valorCentavos: 10000, data: '2026-09-22'});
  await criar(db, session, despesaBasica({
    dataCompetencia: '2026-09-22', itens: [itemBasico({valorUnitarioCentavos: 4000 / 30, quantidade: 30})],
  }));
  // ajuste fino: item unitário exato para bater R$40,00 (4000 centavos)
  const {body: listaBody} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  const gastoReal = listaBody.resultadoFinanceiro.despesasCentavos;
  const esperadoLucro = 10000 - gastoReal;
  assert.equal(listaBody.resultadoFinanceiro.faturamentoLiquidoCentavos, 10000);
  assert.equal(listaBody.resultadoFinanceiro.lucroEstimadoCentavos, esperadoLucro);
  // Cenário exato do enunciado com valores que fecham sem arredondamento:
  const {db: db2, session: session2} = await setup(t);
  await configurarFaturamento(db2, {valorCentavos: 10000, data: '2026-09-22'});
  await criar(db2, session2, despesaBasica({
    dataCompetencia: '2026-09-22', itens: [itemBasico({valorUnitarioCentavos: 100, quantidade: 40})],
  }));
  const {body} = await listar(db2, session2, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resultadoFinanceiro.faturamentoLiquidoCentavos, 10000);
  assert.equal(body.resultadoFinanceiro.despesasCentavos, 4000);
  assert.equal(body.resultadoFinanceiro.lucroEstimadoCentavos, 6000);
  assert.equal(body.resultadoFinanceiro.margemEstimada, 60);
});

// 31/32) faturamento 100 / gasto 150 = lucro -50, margem -50% (nunca clampado em 0)
test('31/32: faturamento 100 e gasto 150 resultam em lucro -50 (margem -50%)', async t => {
  const {db, session} = await setup(t);
  await configurarFaturamento(db, {valorCentavos: 10000, data: '2026-09-22'});
  await criar(db, session, despesaBasica({
    dataCompetencia: '2026-09-22', itens: [itemBasico({valorUnitarioCentavos: 100, quantidade: 150})],
  }));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resultadoFinanceiro.despesasCentavos, 15000);
  assert.equal(body.resultadoFinanceiro.lucroEstimadoCentavos, -5000, 'prejuízo real, nunca clampado em 0');
  assert.equal(body.resultadoFinanceiro.margemEstimada, -50);
});

// 33/34) faturamento 0 / gasto 50 = lucro -50, margem null
test('33/34: faturamento 0 e gasto 50 resultam em lucro -50 e margem null (nunca NaN/Infinity)', async t => {
  const {db, session} = await setup(t); // fixture(paid:false) => faturamento 0
  await criar(db, session, despesaBasica({
    dataCompetencia: '2026-09-22', itens: [itemBasico({valorUnitarioCentavos: 100, quantidade: 50})],
  }));
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resultadoFinanceiro.faturamentoLiquidoCentavos, 0);
  assert.equal(body.resultadoFinanceiro.despesasCentavos, 5000);
  assert.equal(body.resultadoFinanceiro.lucroEstimadoCentavos, -5000);
  assert.equal(body.resultadoFinanceiro.margemEstimada, null);
});

// 35) refunds continuam respeitados
test('35: refund reduz o faturamento líquido usado no resultado financeiro', async t => {
  const {db, session} = await setup(t);
  await configurarFaturamento(db, {valorCentavos: 10000, data: '2026-09-22'});
  await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,
    idempotency_key,concluido_em) VALUES(1,1,'MANUAL','PIX_MP',3000,'REEMBOLSADO','refund-1','2026-09-22 11:00:00')`).run();
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resultadoFinanceiro.faturamentoLiquidoCentavos, 7000);
});

// 36) pedido anulado não entra na receita
test('36: pedido anulado não conta no faturamento líquido', async t => {
  const {db, session} = await setup(t);
  await configurarFaturamento(db, {valorCentavos: 10000, data: '2026-09-22'});
  await db.batch([
    // Anulação bloqueia PIX_MP recebido e não estornado; método manual evita
    // esse guard de domínio (irrelevante ao que este teste verifica: que um
    // pedido anulado, qualquer que seja o método, some do faturamento).
    db.prepare(`UPDATE pedidos SET origem_pedido='MANUAL' WHERE id=1`),
    db.prepare(`UPDATE pedido_pagamentos SET metodo='DINHEIRO', mp_payment_id=NULL WHERE id=1`),
    db.prepare(`INSERT INTO pedido_anulacoes(pedido_id,motivo,estoque_acao,criado_por_usuario_id,usuario_nome,
      total_original_centavos,bruto_original_centavos,reembolsado_original_centavos,liquido_original_centavos,
      estoque_snapshot,efetivada) VALUES(1,'teste','MANTER',1,'Teste',10000,10000,0,10000,'[]',1)`),
  ]);
  const {body} = await listar(db, session, {desde: '2026-09-22', ate: '2026-09-22'}).then(corpo);
  assert.equal(body.resultadoFinanceiro.faturamentoLiquidoCentavos, 0);
});

// 37/38/39/40) despesas não tocam nenhuma tabela financeira/estoque de pedidos
test('37-40: criar/editar/cancelar despesa nunca altera pedido_pagamentos/pedido_reembolsos/pedido_anulacoes/estoque', async t => {
  const {db, session} = await setup(t);
  const antes = await state(db);
  const {body: criada} = await corpo(await criar(db, session, despesaBasica()));
  await editar(db, session, criada.despesa.id, despesaBasica({fornecedor: 'Outro'}));
  await cancelar(db, session, criada.despesa.id);
  const depois = await state(db);
  assert.deepEqual(depois.pedido, antes.pedido);
  assert.deepEqual(depois.produtos, antes.produtos);
  assert.deepEqual(depois.pagamentos, antes.pagamentos);
  assert.deepEqual(depois.refunds, antes.refunds);
  assert.deepEqual(depois.operacoes, antes.operacoes);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pedido_anulacoes').first()).n, 0);
});

// 41) sameOrigin
test('41: sameOrigin bloqueia mutações de origem cruzada antes de tocar o banco', async t => {
  const poison = {prepare() { throw new Error('não pode acessar db'); }};
  const cross = await app.adminDespesas.onRequestPost({
    env: {DB: poison}, params: {}, waitUntil() {},
    request: new Request('https://local.test/api/admin/despesas', {
      method: 'POST', headers: {Origin: 'https://evil.test'}, body: '{}',
    }),
  });
  assert.equal(cross.status, 403);
});

// 42) auth
test('42: endpoints exigem sessão autenticada', async t => {
  const {db} = await setup(t);
  const semSessao = await app.adminDespesas.onRequestGet({
    env: {DB: db}, params: {}, waitUntil() {},
    request: new Request('https://local.test/api/admin/despesas?desde=2026-01-01&ate=2026-01-31'),
  });
  assert.equal(semSessao.status, 401);
  const semSessaoPost = await app.adminDespesas.onRequestPost({
    env: {DB: db}, params: {}, waitUntil() {},
    request: new Request('https://local.test/api/admin/despesas', {
      method: 'POST', headers: {Origin: 'https://local.test', 'Content-Type': 'application/json'},
      body: JSON.stringify(despesaBasica()),
    }),
  });
  assert.equal(semSessaoPost.status, 401);
});

// 48) dashboard financeiro correto
test('48: dashboard expõe resultadoFinanceiro acumulado (não só do dia selecionado)', async t => {
  const {db, session} = await setup(t);
  // Faturamento e despesa de um dia BEM diferente de "hoje" — o card do
  // dashboard é acumulado geral (bate com "Caixa total"), então precisa
  // continuar contando isso mesmo consultando outra data.
  await configurarFaturamento(db, {valorCentavos: 10000, data: '2026-09-01'});
  await criar(db, session, despesaBasica({
    dataCompetencia: '2026-09-01', itens: [itemBasico({valorUnitarioCentavos: 100, quantidade: 40})],
  }));
  const response = await app.dashboard.onRequestGet({
    env: {DB: db}, waitUntil() {},
    request: new Request('https://local.test/api/admin/dashboard?date=2026-09-22&today=2026-09-22', {
      headers: {Cookie: cookieDe(session)},
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.resultadoFinanceiro.faturamentoLiquidoCentavos, 10000);
  assert.equal(body.resultadoFinanceiro.despesasCentavos, 4000);
  assert.equal(body.resultadoFinanceiro.lucroEstimadoCentavos, 6000);
  assert.equal(body.resultadoFinanceiro.margemEstimada, 60);
});
