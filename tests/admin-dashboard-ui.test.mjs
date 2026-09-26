import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of [
  'window','document','navigator','HTMLElement','Node','Event','MouseEvent',
  'KeyboardEvent','localStorage','getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
      import AdminDashboard from './src/admin/Dashboard/AdminDashboard';
      export {act} from 'react';
      export function mount(container) {
        const root=createRoot(container);
        root.render(<AdminDashboard/>);
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

test('dashboard renderiza caixa total e ranking geral entregues pelo backend', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    // "Hoje" é decidido pelo backend: a primeira carga não envia date/today.
    assert.equal(String(url), '/api/admin/dashboard');
    return Response.json({
      data: '2026-09-20',
      hoje: '2026-09-20',
      recebidoHoje: {count: 1, total: 100000},
      aReceber: {count: 1, total: 500, anteriores: 1},
      pagamentosPendentes: [
        {
          id: 49,
          cliente_nome: 'Vitória',
          status_pedido: 'ENTREGUE',
          criado_em: '2026-09-19 15:54:00',
          saldo_centavos: 500,
          dias_em_aberto: 1,
        },
      ],
      comandasAbertas: 0,
      aguardandoPreparo: 0,
      catalogo: {total: 2, estoqueBaixo: 0},
      financeiro: {
        brutoCentavos: 100000,
        reembolsadoCentavos: 10000,
        liquidoCentavos: 90000,
      },
      maisVendidos: [
        {produtoId: 1, nome: 'Ninho com Nutella', quantidade: 84},
        {produtoId: null, nome: 'Sabor historico', quantidade: 12},
      ],
      pedidosRecentes: [],
      resultadoFinanceiro: {
        faturamentoLiquidoCentavos: 90000,
        despesasCentavos: 0,
        lucroEstimadoCentavos: 90000,
        margemEstimada: 100,
      },
    });
  });

  const container = document.getElementById('root');
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await ui.act(async () => { await new Promise(setImmediate); });

  // Calendário e banner usam o hoje da loja vindo do backend, não o relógio local.
  assert.equal(document.querySelector('.dash-date-picker').textContent.trim(), '20/09/2026');
  assert.match(document.querySelector('.dash-results-banner').textContent, /Atualizado em tempo real/);

  const cash = document.querySelector('.dash-cash-total');
  assert.match(cash.textContent, /Caixa total/);
  assert.match(cash.textContent, /R\$ 900,00/);
  assert.match(cash.textContent, /Recebido: R\$ 1\.000,00/);
  assert.match(cash.textContent, /Reembolsado: -R\$ 100,00/);
  assert.deepEqual(
    [...document.querySelectorAll('.dash-rank-row')].map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    ['1Ninho com Nutella84 un.', '2Sabor historico12 un.'],
  );

  const aReceber = document.querySelector('.dash-kpi-card--interactive');
  assert.match(aReceber.textContent, /A receber/);
  assert.match(aReceber.textContent, /Atual/);
  assert.match(aReceber.textContent, /1 pendência\(s\) em aberto/);
  assert.match(aReceber.textContent, /1 anterior\(es\)/);

  const pendingRow = document.querySelector('.dash-pending-row');
  assert.match(pendingRow.textContent, /RP-49/);
  assert.match(pendingRow.textContent, /Vitória/);
  assert.match(pendingRow.textContent, /R\$ 5,00/);
  assert.match(pendingRow.textContent, /Desde ontem/);
  assert.equal(pendingRow.getAttribute('href'), '/admin/pedidos?pedido=49');

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});

test('data histórica é enviada explicitamente; "Hoje" volta ao dia da loja definido pelo backend', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(String(url));
    const data = new URL(String(url), 'https://local.test').searchParams.get('date') ?? '2026-09-25';
    return Response.json({
      data,
      hoje: '2026-09-25',
      recebidoHoje: {count: 0, total: 0},
      aReceber: {count: 0, total: 0, anteriores: 0},
      pagamentosPendentes: [],
      comandasAbertas: 0,
      aguardandoPreparo: 0,
      catalogo: {total: 0, estoqueBaixo: 0},
      financeiro: {brutoCentavos: 0, reembolsadoCentavos: 0, liquidoCentavos: 0},
      maisVendidos: [],
      pedidosRecentes: [],
      resultadoFinanceiro: {
        faturamentoLiquidoCentavos: 0,
        despesasCentavos: 0,
        lucroEstimadoCentavos: 0,
        margemEstimada: null,
      },
    });
  });

  const container = document.getElementById('root');
  let root;
  const flush = () => ui.act(async () => { await new Promise(setImmediate); });
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  assert.deepEqual(urls, ['/api/admin/dashboard']);

  await ui.act(async () => { document.querySelector('.dash-date-picker').click(); });
  const dia10 = [...document.querySelectorAll('.dash-date-day:not(.dash-date-day--muted)')]
    .find(b => b.textContent.trim() === '10');
  // Futuro é relativo ao hoje da loja (25/09), não ao relógio local.
  const dia26 = [...document.querySelectorAll('.dash-date-day:not(.dash-date-day--muted)')]
    .find(b => b.textContent.trim() === '26');
  assert.equal(dia26.disabled, true);
  await ui.act(async () => { dia10.click(); });
  await flush();
  assert.equal(urls.at(-1), '/api/admin/dashboard?date=2026-09-10');
  assert.match(document.querySelector('.dash-results-banner').textContent, /Dados de 10\/09\/2026/);

  await ui.act(async () => { document.querySelector('.dash-btn-today').click(); });
  await flush();
  assert.equal(urls.at(-1), '/api/admin/dashboard');
  assert.equal(document.querySelector('.dash-date-picker').textContent.trim(), '25/09/2026');
  assert.match(document.querySelector('.dash-results-banner').textContent, /Atualizado em tempo real/);

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});
