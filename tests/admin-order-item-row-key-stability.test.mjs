import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// Regressão Biome noArrayIndexKey (Sprint Biome 01): NovoPedidoModal e
// EditarPedidoModal usavam `key={i}` (índice do array) nas linhas de item,
// enquanto cada linha guarda estado local próprio (`useDropdown()`). Remover
// um item do meio deslocava os índices e o React reaproveitava a instância
// errada — o estado "aberto" do dropdown vazava para a linha vizinha em vez
// de acompanhar a linha que o abriu. A correção troca a key para um `id`
// estável por linha (nunca reaproveitado). Este teste cobre NovoPedidoModal,
// a única das duas telas onde a lista de itens é interativa hoje
// (EditarPedidoModal está com a edição desabilitada — ver seu próprio JSX).

const dom = new JSDOM('<!doctype html><body style="padding-right:4px"><div id="root"></div></body>', {
  url: 'https://local.test/admin',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, 'scrollX', {configurable: true, value: 0});
Object.defineProperty(window, 'scrollY', {configurable: true, value: 0});
Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1200});
Object.defineProperty(document.documentElement, 'clientWidth', {configurable: true, value: 1180});
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
      import NovoPedidoModal from './src/admin/Pedidos/NovoPedidoModal';
      export {act} from 'react';

      export function mount(container, onClose) {
        const root = createRoot(container);
        root.render(<NovoPedidoModal open onClose={onClose}/>);
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

async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
}

test('NovoPedidoModal: remover um item do meio preserva o dropdown aberto da linha que o abriu (key estável)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({produtos: []}));

  let root;
  await ui.act(async () => { root = ui.mount(container, () => {}); });
  await flush();

  // Parte de 1 item (estado inicial); soma 2 via "Adicionar item" -> 3 linhas.
  const addButton = document.querySelector('.nped-btn-add-item');
  await ui.act(async () => { addButton.click(); });
  await ui.act(async () => { addButton.click(); });

  let rows = document.querySelectorAll('.nped-item-row');
  assert.equal(rows.length, 3, 'três linhas de item');

  // Abre o dropdown da linha do MEIO (índice 1) e confirma que abriu.
  const linhaMeioAntes = rows[1];
  const triggerMeio = linhaMeioAntes.querySelector('.nped-dropdown-trigger');
  await ui.act(async () => { triggerMeio.click(); });
  rows = document.querySelectorAll('.nped-item-row');
  assert.ok(
    rows[1].querySelector('.nped-dropdown').classList.contains('nped-dropdown--open'),
    'dropdown da linha do meio está aberto antes da remoção',
  );
  assert.ok(
    !rows[0].querySelector('.nped-dropdown').classList.contains('nped-dropdown--open'),
    'dropdown da primeira linha está fechado antes da remoção',
  );

  // Remove a PRIMEIRA linha (índice 0, antes da que está aberta).
  const removeBotaoPrimeiraLinha = rows[0].querySelector('.nped-btn-remove');
  await ui.act(async () => { removeBotaoPrimeiraLinha.click(); });

  rows = document.querySelectorAll('.nped-item-row');
  assert.equal(rows.length, 2, 'duas linhas restantes após remover a primeira');

  // A linha que abriu o dropdown (antes no índice 1) agora está no índice 0.
  // Com key estável, o estado local "aberto" acompanha a linha — não o índice.
  assert.ok(
    rows[0].querySelector('.nped-dropdown').classList.contains('nped-dropdown--open'),
    'a linha que estava aberta continua aberta após a remoção de uma linha anterior (key estável, não o índice)',
  );
  assert.ok(
    !rows[1].querySelector('.nped-dropdown').classList.contains('nped-dropdown--open'),
    'a outra linha continua fechada — nenhum estado vazou para ela',
  );

  await unmount(root);
});
