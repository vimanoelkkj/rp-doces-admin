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
    assert.match(String(url), /^\/api\/admin\/dashboard\?date=\d{4}-\d{2}-\d{2}$/);
    return Response.json({
      data: '2026-09-20',
      recebidoHoje: {count: 1, total: 100000},
      aReceber: {count: 0, total: 0},
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
    });
  });

  const container = document.getElementById('root');
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await ui.act(async () => { await new Promise(setImmediate); });

  const cash = document.querySelector('.dash-cash-total');
  assert.match(cash.textContent, /Caixa total/);
  assert.match(cash.textContent, /R\$ 900,00/);
  assert.match(cash.textContent, /Recebido: R\$ 1\.000,00/);
  assert.match(cash.textContent, /Reembolsado: -R\$ 100,00/);
  assert.deepEqual(
    [...document.querySelectorAll('.dash-rank-row')].map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    ['1Ninho com Nutella84 un.', '2Sabor historico12 un.'],
  );

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});
