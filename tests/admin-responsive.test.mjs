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
      import AdminMobileBottomNav from './src/admin/components/AdminMobileBottomNav';
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
                <NotificacoesProvider>
                  <AdminSidebar />
                  <AdminMobileBottomNav />
                </NotificacoesProvider>
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

test('navegação mobile troca o drawer pela barra inferior acessível', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    notificacoes: [
      {chave: 'pedido:10:novo', tipo: 'PEDIDO', titulo: 'Pedido', descricao: '', em: '', lida: false, destino: '/admin/pedidos?pedido=10'},
      {chave: 'pedido:11:novo', tipo: 'PEDIDO', titulo: 'Pedido', descricao: '', em: '', lida: false, destino: '/admin/pedidos?pedido=11'},
      {chave: 'pedido:12:novo', tipo: 'PEDIDO', titulo: 'Pedido', descricao: '', em: '', lida: true, destino: '/admin/pedidos?pedido=12'},
      {chave: 'estoque:2:baixo', tipo: 'ESTOQUE', titulo: 'Estoque', descricao: '', em: '', lida: false, destino: '/admin/produtos'},
    ],
    naoLidas: 3,
  }));

  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();

  const labels = [...document.querySelectorAll('.sidebar-main-nav a, .sidebar-system-nav a')]
    .map(link => link.textContent.trim().replace(/(?:\d+|9\+)$/, ''));
  assert.deepEqual(labels, [
    'Dashboard', 'Produtos', 'Pedidos', 'Administradores', 'Despesas', 'Loja', 'Notificações',
  ]);
  assert.equal(document.querySelectorAll('.sidebar-nav-badge').length, 1);
  assert.equal(document.querySelector('.sidebar-nav-badge').textContent, '3');
  assert.match(document.querySelector('.sidebar-nav-item--active').textContent, /Dashboard/);

  assert.equal(document.querySelector('.admin-mobile-menu-btn'), null, 'hamburger removido');
  assert.equal(document.querySelector('.admin-sidebar-backdrop'), null, 'drawer mobile removido');

  const mobileLabels = [...document.querySelectorAll('.admin-mobile-bottom-nav > .admin-mobile-nav-item')]
    .map(item => item.querySelector('.admin-mobile-nav-label').textContent);
  assert.deepEqual(mobileLabels, ['Painel', 'Produtos', 'Pedidos', 'Loja', 'Mais']);
  assert.equal(document.querySelector('.admin-mobile-bottom-nav a[aria-current="page"]').textContent.includes('Painel'), true);
  assert.equal(document.querySelector('.admin-mobile-nav-item--pedidos .admin-mobile-nav-badge').textContent, '3');

  const trigger = document.querySelector('.admin-mobile-nav-item--mais');
  await ui.act(async () => trigger.click());
  await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('.admin-mobile-sheet-backdrop').getAttribute('aria-hidden'), 'false');
  assert.equal(document.body.style.position, 'fixed');
  assert.equal(document.activeElement.textContent.trim(), 'Administradores');
  assert.deepEqual(
    [...document.querySelectorAll('.admin-mobile-sheet-links a')].map(link => link.textContent.trim().replace(/3$/, '')),
    ['Administradores', 'Despesas', 'Notificações'],
    'Despesas está no menu de "Mais" do mobile — sem isso não há como abrir a tela no celular',
  );
  assert.equal(document.querySelector('.admin-mobile-sheet-badge').textContent, '3');

  await ui.act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.body.style.position, '');
  assert.equal(document.activeElement, trigger);

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});

test('estilos estruturais cobrem páginas, barra inferior, overlays e dark mode', async () => {
  const files = await Promise.all([
    'src/admin/components/AdminSidebar.css',
    'src/admin/components/AdminMobileNavigation.css',
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
  const [sidebar, mobileNavigation, dashboard, products, orders, admins, store, notifications,
    productModal, orderModal, detailModal, adminModal, dark] = files;

  assert.match(sidebar, /@media \(max-width: 900px\)/);
  assert.doesNotMatch(sidebar, /\.admin-sidebar--open/);
  assert.match(sidebar, /--admin-mobile-nav-space/);
  assert.match(sidebar, /calc\(40px \+ var\(--admin-mobile-nav-space\)\)/);
  assert.match(mobileNavigation, /\.admin-mobile-bottom-nav/);
  assert.match(mobileNavigation, /env\(safe-area-inset-bottom\)/);
  assert.match(mobileNavigation, /\.admin-mobile-sheet-backdrop--open/);
  assert.match(mobileNavigation, /z-index: 400/);
  assert.match(mobileNavigation, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(mobileNavigation, /admin-mobile-nav-item--pedidos:active[\s\S]*iconSwingBag/);
  assert.match(sidebar, /\.admin-main,[\s\S]*min-width: 0/);
  assert.match(dashboard, /\.dash-orders-table[\s\S]*overflow-x: auto/);
  assert.match(dashboard, /\.dash-cash-total/);
  assert.match(dashboard, /@media \(max-width: 768px\)[\s\S]*\.dash-cash-breakdown[\s\S]*flex-wrap: wrap/);
  assert.match(orders, /\.ped-table-panel[\s\S]*overflow-x: auto/);
  assert.match(detailModal, /\.pedmodal-btn-archive/);
  assert.match(dark, /\.pedmodal-btn-archive/);
  for (const css of [dashboard, products, orders, admins, store, notifications]) {
    assert.match(css, /@media \(max-width:/);
  }
  for (const css of [productModal, orderModal, detailModal, adminModal]) {
    assert.match(css, /100dvh/);
    assert.match(css, /position: sticky/);
  }
  assert.match(dark, /\.admin-mobile-header/);
});

test('listagem de pedidos vira cartão empilhado no mobile, sem forçar rolagem horizontal', async () => {
  const css = await readFile(
    new URL('../src/admin/Pedidos/AdminPedidos.css', import.meta.url), 'utf8',
  );
  const mobile = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.match(mobile, /\.ped-table-header\s*\{[^}]*display:\s*none/,
    'cabeçalho de colunas não faz sentido empilhado');
  assert.match(mobile, /\.ped-table-row\s*\{[^}]*display:\s*grid/,
    'cada linha vira um cartão em grid, não uma linha larga com scroll');
  assert.doesNotMatch(mobile, /min-width:\s*660px/,
    'o min-width que forçava a rolagem lateral no mobile foi removido');
});

test('pedidos recentes do Dashboard viram cartão empilhado no mobile', async () => {
  const css = await readFile(
    new URL('../src/admin/Dashboard/AdminDashboard.css', import.meta.url), 'utf8',
  );
  const mobile = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.match(mobile, /\.dash-table-header\s*\{[^}]*display:\s*none/,
    'cabeçalho de colunas não faz sentido empilhado');
  assert.match(mobile, /\.dash-table-row\s*\{[^}]*display:\s*grid/,
    'cada linha vira um cartão em grid, não uma linha larga com scroll');
  assert.doesNotMatch(mobile, /min-width:\s*760px/,
    'o min-width que forçava a rolagem lateral no mobile foi removido');
});

test('modal de categorias não estoura/sobrepõe o selo Sistema/Personalizada no mobile', async () => {
  const css = await readFile(
    new URL('../src/admin/Produtos/CategoriasModal.css', import.meta.url), 'utf8',
  );
  const mobile = css.slice(css.indexOf('@media (max-width: 580px)'));
  assert.match(mobile, /\.catm-cat-card\s*\{[^}]*flex-wrap:\s*wrap/,
    'o card quebra linha em vez de empurrar o selo para fora da tela');
  assert.match(mobile, /\.catm-cat-left\s*\{[^}]*flex:\s*1 1 100%/,
    'o conteúdo ocupa a largura toda, jogando o selo para a linha seguinte');
});

test('emoji do modal de categorias usa o mesmo catálogo do modal de novo produto', async () => {
  const [categorias, novoProduto] = await Promise.all([
    readFile(new URL('../src/admin/Produtos/CategoriasModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/admin/Produtos/NovoProdutoModal.tsx', import.meta.url), 'utf8'),
  ]);
  for (const src of [categorias, novoProduto]) {
    assert.match(src, /import\s*\{\s*EMOJI_OPTIONS\s*\}\s*from\s*"\.\/EmojiIcons"/,
      'ambos os modais importam o mesmo catálogo de emojis, em vez de listas locais divergentes');
  }
  assert.doesNotMatch(categorias, /const EMOJI_OPTIONS\s*=/,
    'o modal de categorias não tem mais sua própria lista de emojis');
});

test('Header no Admin mobile não renderiza hamburger nem drawer, preservando a bottom nav', async () => {
  const headerCode = await readFile(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.match(headerCode, /\{!isAdmin\s*&&\s*\(/, 'hamburger condicionado a !isAdmin');
  assert.match(headerCode, /\{!isAdmin\s*&&\s*createPortal\(/, 'drawer mobile condicionado a !isAdmin');
});

test('AdminLayout renderiza AdminMobileBottomNav para navegação mobile', async () => {
  const layoutCode = await readFile(new URL('../src/admin/components/AdminLayout.tsx', import.meta.url), 'utf8');
  assert.match(layoutCode, /import\s+AdminMobileBottomNav\s+from\s+"\.\/AdminMobileBottomNav"/);
  assert.match(layoutCode, /<AdminMobileBottomNav\s*\/>/);
});

test('Header exibe badge Admin adaptativo ao lado da logo no admin', async () => {
  const headerCode = await readFile(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.match(headerCode, /isAdmin\s*&&\s*<span className="header-admin-badge">Admin<\/span>/);

  const headerCss = await readFile(new URL('../src/components/Header.css', import.meta.url), 'utf8');
  assert.match(headerCss, /\.header-admin-badge\s*\{/);
  assert.match(headerCss, /html\[data-theme="dark"\]\s+\.header-admin-badge/);
});

test('layout mobile administrativo reserva espaço inferior para a bottom nav de forma compartilhada', async () => {
  const css = await readFile(
    new URL('../src/admin/components/AdminMobileNavigation.css', import.meta.url),
    'utf8',
  );

  assert.match(
    css,
    /\.admin-layout\s+:is\(\.admin-main,\s*\.adm-main,\s*\.loj-main\)/,
    'regra cobre containers de páginas administrativas sob .admin-layout com maior especificidade',
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)[\s\S]*?\.admin-layout\s+:is\(\.admin-main,\s*\.adm-main,\s*\.loj-main\)[\s\S]*?padding-bottom:\s*calc\(56px\s*\+\s*var\(--admin-mobile-nav-space\)\)\s*!important/,
    'clearance inferior garantido em <= 900px resistente a sobrescritas de páginas específicas',
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)[\s\S]*?\.admin-layout\s+:is\(\.admin-main,\s*\.adm-main,\s*\.loj-main\)[\s\S]*?padding-bottom:\s*calc\(40px\s*\+\s*var\(--admin-mobile-nav-space\)\)\s*!important/,
    'clearance inferior preservado com espaçamento menor em telas <= 600px',
  );
});

