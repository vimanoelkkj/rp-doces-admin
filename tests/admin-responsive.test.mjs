import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  'window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'localStorage', 'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.matchMedia = query => ({
  matches: query.includes('max-width'),
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return true; },
});

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
      import {MemoryRouter} from 'react-router-dom';
      import AdminSidebar from './src/admin/components/AdminSidebar';
      import {AdminThemeProvider} from './src/admin/theme/AdminThemeContext';
      import {AdminAuthProvider} from './src/admin/auth/AdminAuthContext';
      import {NotificacoesProvider} from './src/admin/notificacoes/NotificacoesContext';
      export {act} from 'react';

      export function mount(container) {
        const root = createRoot(container);
        const user = {id: 1, nome: 'Teste Local', username: 'teste', email: 'teste@example.invalid', papel: 'OWNER'};
        root.render(
          <MemoryRouter initialEntries={['/admin']}>
            <AdminThemeProvider>
              <AdminAuthProvider user={user} logout={() => {}}>
                <NotificacoesProvider><AdminSidebar /></NotificacoesProvider>
              </AdminAuthProvider>
            </AdminThemeProvider>
          </MemoryRouter>
        );
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

test('HUMAN-18: navegação mobile mantém rotas, badge real, foco e scroll lock', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    notificacoes: [],
    naoLidas: 12,
  }));

  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();

  const labels = [...document.querySelectorAll('.sidebar-main-nav a, .sidebar-system-nav a')]
    .map(link => link.textContent.trim().replace(/9\+$/, ''));
  assert.deepEqual(labels, [
    'Dashboard', 'Produtos', 'Pedidos', 'Administradores', 'Loja', 'Notificações',
  ]);
  assert.equal(document.querySelectorAll('.sidebar-nav-badge').length, 1);
  assert.equal(document.querySelector('.sidebar-nav-badge').textContent, '9+');
  assert.match(document.querySelector('.sidebar-nav-item--active').textContent, /Dashboard/);

  const trigger = document.querySelector('.admin-mobile-menu-btn');
  await ui.act(async () => trigger.click());
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(document.querySelector('.admin-sidebar').classList.contains('admin-sidebar--open'));
  assert.equal(document.body.style.position, 'fixed');
  assert.equal(document.activeElement, document.querySelector('.admin-sidebar-close'));

  await ui.act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.body.style.position, '');

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});

test('HUMAN-18: estilos estruturais cobrem páginas, tabelas, modais e dark mode', async () => {
  const files = await Promise.all([
    'src/admin/components/AdminSidebar.css',
    'src/admin/Dashboard/AdminDashboard.css',
    'src/admin/Produtos/AdminProdutos.css',
    'src/admin/Pedidos/AdminPedidos.css',
    'src/admin/Administradores/AdminAdministradores.css',
    'src/admin/Loja/AdminLoja.css',
    'src/admin/notificacoes/AdminNotificacoes.css',
    'src/admin/Produtos/NovoProdutoModal.css',
    'src/admin/Pedidos/NovoPedidoModal.css',
    'src/admin/Pedidos/PedidoDetalheModal.css',
    'src/admin/Administradores/NovoAdminModal.css',
    'src/admin/theme/admin-dark-theme.css',
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  const [sidebar, dashboard, products, orders, admins, store, notifications,
    productModal, orderModal, detailModal, adminModal, dark] = files;

  assert.match(sidebar, /@media \(max-width: 900px\)/);
  assert.match(sidebar, /\.admin-sidebar--open/);
  assert.match(sidebar, /\.admin-main,[\s\S]*min-width: 0/);
  assert.match(dashboard, /\.dash-orders-table[\s\S]*overflow-x: auto/);
  assert.match(orders, /\.ped-table-panel[\s\S]*overflow-x: auto/);
  for (const css of [dashboard, products, orders, admins, store, notifications]) {
    assert.match(css, /@media \(max-width:/);
  }
  for (const css of [productModal, orderModal, detailModal, adminModal]) {
    assert.match(css, /100dvh/);
    assert.match(css, /position: sticky/);
  }
  assert.match(dark, /\.admin-mobile-header/);
  assert.match(dark, /@media \(max-width: 900px\)/);
});
