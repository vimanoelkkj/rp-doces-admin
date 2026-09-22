import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// Cenários 43-47 do pedido original: criação/edição/cancelamento atualizam a
// tela sem F5 (nenhum window.location.reload em nenhum momento), dark mode
// cobre as classes usadas por esta tela, e o mobile troca a tabela por
// cards em vez de encolhê-la (sem overflow horizontal grosseiro).
//
// IMPORTANTE: nunca passar um nó DOM vivo como lado "actual" de
// assert.equal/deepEqual quando a asserção pode falhar — se falhar,
// node:assert tenta formatar o valor com util.inspect, e um elemento DOM
// com a árvore de fiber do React pendurada nele (referências circulares)
// pode travar o processo por completo. Usar sempre assert.ok(x === null)
// ou comparar .length/valores primitivos.

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin/despesas',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of [
  'window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

test.after(() => {
  dom.window.close();
  for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
  globalThis.MessageChannel = NativeMessageChannel;
});

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import AdminDespesas from './src/admin/Despesas/AdminDespesas';
      export {act} from 'react';
      export function mount(container) {
        const root = createRoot(container);
        root.render(<AdminDespesas />);
        return root;
      }
    `,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"'},
  loader: {'.css': 'empty'},
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const container = document.getElementById('root');
const flush = () => ui.act(async () => { await new Promise(setImmediate); });

// Mesmo truque usado em comanda-viva-ui.test.mjs: setar `.value` direto não
// dispara o onChange do React (ele intercepta o setter nativo). É preciso
// chamar o setter do PROTÓTIPO nativo antes de disparar o evento.
function changeValue(element, value) {
  const prototype = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', {bubbles: true}));
}

const respostaVazia = () => Response.json({
  despesas: [],
  resumo: {totalCentavos: 0, porCategoria: [], rankingItens: []},
  resultadoFinanceiro: {faturamentoLiquidoCentavos: 0, despesasCentavos: 0, lucroEstimadoCentavos: 0, margemEstimada: null},
});

const despesaExemplo = (overrides = {}) => ({
  id: 1, fornecedor: 'Atacadão', dataCompetencia: '2026-09-22', status: 'ATIVA',
  totalCentavos: 2400, itemCount: 1, ...overrides,
});

async function mountWith(t, handler) {
  t.mock.method(globalThis, 'fetch', handler);
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  return root;
}

async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
}

// 43) criação sem F5
test('43: registrar gasto atualiza a lista e o resumo sem reload', async t => {
  let despesasSalvas = false;
  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (href === '/api/admin/despesas' && options.method === 'POST') {
      despesasSalvas = true;
      return Response.json({ok: true, despesa: despesaExemplo()}, {status: 201});
    }
    if (href.split('?')[0] === '/api/admin/despesas' && (!options.method || options.method === 'GET')) {
      return despesasSalvas
        ? Response.json({
            despesas: [despesaExemplo()],
            resumo: {totalCentavos: 2400, porCategoria: [{categoria: 'INGREDIENTES', valorCentavos: 2400, percentual: 100}], rankingItens: [{descricao: 'Ovos', valorCentavos: 2400}]},
            resultadoFinanceiro: {faturamentoLiquidoCentavos: 0, despesasCentavos: 2400, lucroEstimadoCentavos: -2400, margemEstimada: null},
          })
        : respostaVazia();
    }
    throw new Error(`chamada inesperada ${href} ${options.method}`);
  });
  try {
    assert.match(document.body.textContent, /Nenhuma despesa encontrada/);
    await ui.act(async () => document.querySelector('.desp-btn-primary').click());
    await flush();
    const modal = document.querySelector('.gasto-overlay');
    assert.ok(modal, 'modal de registrar gasto deveria abrir');

    const descricao = modal.querySelector('.gasto-item-descricao input');
    const quantidade = modal.querySelectorAll('.gasto-item-grid input')[1];
    const valorUnitario = modal.querySelector('.gasto-money-input input');
    await ui.act(async () => {
      changeValue(descricao, 'Ovos');
      changeValue(quantidade, '30');
      changeValue(valorUnitario, '0,80');
    });
    await flush();
    assert.match(modal.querySelector('.gasto-item-subtotal strong').textContent, /24,00/, 'subtotal do item calculado ao vivo');

    await ui.act(async () => modal.querySelector('button[type="submit"].gasto-btn-save').click());
    await flush();

    assert.ok(document.querySelector('.gasto-overlay') === null, 'modal fecha após salvar');
    assert.match(document.body.textContent, /Atacad/, 'lista mostra a despesa recém-criada');
    assert.match(document.body.textContent, /Ovos/, 'ranking do resumo também atualizou');
  } finally { await unmount(root); }
});

// 44) edição sem F5
test('44: editar despesa atualiza fornecedor na lista sem reload', async t => {
  let fornecedorAtual = 'Atacadão';
  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (href.split('?')[0] === '/api/admin/despesas' && (!options.method || options.method === 'GET')) {
      return Response.json({
        despesas: [despesaExemplo({fornecedor: fornecedorAtual})],
        resumo: {totalCentavos: 2400, porCategoria: [], rankingItens: []},
        resultadoFinanceiro: {faturamentoLiquidoCentavos: 0, despesasCentavos: 2400, lucroEstimadoCentavos: -2400, margemEstimada: null},
      });
    }
    if (href === '/api/admin/despesas/1' && (!options.method || options.method === 'GET')) {
      return Response.json({despesa: {
        ...despesaExemplo({fornecedor: fornecedorAtual}),
        observacao: '',
        itens: [{id: 1, descricao: 'Ovos', categoria: 'INGREDIENTES', quantidade: 30, unidade: 'UN', valorUnitarioCentavos: 80, valorTotalCentavos: 2400}],
      }});
    }
    if (href === '/api/admin/despesas/1' && options.method === 'PUT') {
      fornecedorAtual = 'Fornecedor Editado';
      return Response.json({ok: true, despesa: despesaExemplo({fornecedor: fornecedorAtual})});
    }
    throw new Error(`chamada inesperada ${href} ${options.method}`);
  });
  try {
    await ui.act(async () => document.querySelector('.desp-table-row').click());
    await flush();
    const modal = document.querySelector('.gasto-overlay');
    assert.ok(modal, 'modal de detalhe deveria abrir');

    const botaoEditar = [...modal.querySelectorAll('.gasto-footer--detalhe button')]
      .find((b) => b.textContent === 'Editar');
    assert.ok(botaoEditar, 'botão Editar deveria existir no modo detalhe');
    await ui.act(async () => botaoEditar.click());
    await flush();

    const salvar = modal.querySelector('button[type="submit"].gasto-btn-save');
    assert.ok(salvar, 'formulário de edição deveria estar visível após clicar em Editar');
    await ui.act(async () => salvar.click());
    await flush();

    assert.ok(document.querySelector('.gasto-overlay') === null, 'modal fecha após salvar');
    assert.match(document.body.textContent, /Fornecedor Editado/);
  } finally { await unmount(root); }
});

// 45) cancelamento sem F5
test('45: excluir (cancelar) despesa reflete status Cancelada sem reload', async t => {
  let status = 'ATIVA';
  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (href.split('?')[0] === '/api/admin/despesas' && (!options.method || options.method === 'GET')) {
      return Response.json({
        despesas: [despesaExemplo({status})],
        resumo: {totalCentavos: status === 'ATIVA' ? 2400 : 0, porCategoria: [], rankingItens: []},
        resultadoFinanceiro: {faturamentoLiquidoCentavos: 0, despesasCentavos: 0, lucroEstimadoCentavos: 0, margemEstimada: null},
      });
    }
    if (href === '/api/admin/despesas/1' && (!options.method || options.method === 'GET')) {
      return Response.json({despesa: {...despesaExemplo({status}), observacao: '', itens: [
        {id: 1, descricao: 'Ovos', categoria: 'INGREDIENTES', quantidade: 30, unidade: 'UN', valorUnitarioCentavos: 80, valorTotalCentavos: 2400},
      ]}});
    }
    if (href === '/api/admin/despesas/1/cancelar' && options.method === 'POST') {
      status = 'CANCELADA';
      return Response.json({ok: true, despesa: despesaExemplo({status}), replay: false});
    }
    throw new Error(`chamada inesperada ${href} ${options.method}`);
  });
  try {
    await ui.act(async () => document.querySelector('.desp-table-row').click());
    await flush();
    const modal = document.querySelector('.gasto-overlay');
    const excluir = [...modal.querySelectorAll('.gasto-footer--detalhe button')]
      .find((b) => b.textContent.includes('Excluir'));
    assert.ok(excluir, 'botão Excluir despesa deveria existir');
    await ui.act(async () => excluir.click());
    await flush();

    assert.ok(document.querySelector('.gasto-overlay') === null, 'modal fecha após cancelar');
    assert.match(document.body.textContent, /Cancelada/);
  } finally { await unmount(root); }
});

// 46) dark mode: toda classe usada por este componente tem contraparte no
// arquivo central de tema escuro (nenhum texto escuro sobre fundo escuro).
test('46: classes desp-*/gasto-* usadas no JSX têm cobertura no admin-dark-theme.css', async t => {
  const [despTsx, gastoTsx, darkCss] = await Promise.all([
    readFile('src/admin/Despesas/AdminDespesas.tsx', 'utf8'),
    readFile('src/admin/Despesas/GastoModal.tsx', 'utf8'),
    readFile('src/admin/theme/admin-dark-theme.css', 'utf8'),
  ]);
  const classesCriticas = [
    'desp-title', 'desp-subtitle', 'desp-kpi-value', 'desp-kpi-label', 'desp-card',
    'desp-table', 'desp-error', 'desp-empty', 'desp-search', 'desp-periods', 'desp-card-mobile',
    'gasto-modal', 'gasto-title', 'gasto-error', 'gasto-btn-save', 'gasto-btn-cancel', 'gasto-item-card',
  ];
  for (const classe of classesCriticas) {
    assert.ok(despTsx.includes(classe) || gastoTsx.includes(classe), `${classe} deveria estar em uso no JSX`);
    assert.match(darkCss, new RegExp(`\\.${classe}\\b`), `${classe} deveria ter override em admin-dark-theme.css`);
  }
  // Classes montadas dinamicamente (`desp-status--${status.toLowerCase()}`):
  // o prefixo aparece literalmente no JSX; os valores concretos só existem
  // como classe final, então são checados direto contra o CSS.
  const prefixosDinamicos = ['desp-status--', 'gasto-status-pill--'];
  const sufixos = ['ativa', 'cancelada'];
  for (const prefixo of prefixosDinamicos) {
    assert.ok(despTsx.includes(prefixo) || gastoTsx.includes(prefixo), `${prefixo} deveria estar em uso no JSX`);
    for (const sufixo of sufixos) {
      assert.match(darkCss, new RegExp(`\\.${prefixo}${sufixo}\\b`), `${prefixo}${sufixo} deveria ter override em admin-dark-theme.css`);
    }
  }
});

// 47) mobile sem overflow grosseiro: a tabela desktop não encolhe — ela some
// e cards verticais assumem, dentro do mesmo breakpoint.
test('47: no breakpoint mobile a tabela desaparece e os cards assumem (sem encolher colunas)', async t => {
  const css = await readFile('src/admin/Despesas/AdminDespesas.css', 'utf8');
  // \r?\n em vez de \n: o arquivo pode ter terminadores CRLF (ex.: depois de
  // um git stash/pop no Windows normalizar as quebras de linha).
  const bloco720 = css.match(/@media \(max-width: 720px\) \{([\s\S]*?)\r?\n\}\r?\n/);
  assert.ok(bloco720, 'deveria existir um breakpoint mobile (720px)');
  const conteudo = bloco720[1];
  assert.match(conteudo, /\.desp-table\s*\{[^}]*display:\s*none/, 'tabela desktop deve sumir no mobile, não encolher');
  assert.match(conteudo, /\.desp-cards-mobile\s*\{[^}]*display:\s*flex/, 'cards mobile devem assumir no lugar da tabela');
});
