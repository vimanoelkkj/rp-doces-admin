import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// A sidebar do desktop administrativo (>= 901px) NÃO pode desaparecer de novo.
// Ela saiu do AdminLayout no commit 5e4c46a8 (unificação do header) e o admin
// passou a mostrar só a navegação horizontal do header. Aqui:
//  1. o AdminLayout real renderiza a AdminSidebar com toda a navegação;
//  2. ela fica FORA do scroll do frame (a máscara de fade a atingiria);
//  3. o CSS troca header <-> sidebar sem sobreposição na fronteira 900/901px.

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin/produtos',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of [
  'window', 'document', 'navigator', 'Element', 'HTMLElement', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'localStorage', 'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
dom.window.scrollTo = () => {};
dom.window.matchMedia = (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent() { return true; },
});
globalThis.matchMedia = dom.window.matchMedia;

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
      import {MemoryRouter, Routes, Route} from 'react-router-dom';
      import AdminLayout from './src/admin/components/AdminLayout';
      export {act} from 'react';

      export function mount(container) {
        const root = createRoot(container);
        root.render(
          <MemoryRouter initialEntries={['/admin/produtos']}>
            <Routes>
              <Route element={<AdminLayout />}>
                <Route path="/admin/produtos" element={<main className="admin-main">Produtos</main>} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
        return root;
      }
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"', 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'true'},
  loader: {'.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl'},
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=admin-layout-bundle.mjs').toString('base64')}`
);

const flush = (ms = 30) => ui.act(async () => { await new Promise((r) => setTimeout(r, ms)); });

test('AdminLayout renderiza a sidebar do desktop com toda a navegação e os controles', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === '/api/auth/me') {
      return Response.json({usuario: {id: 1, nome: 'Ana Teste', username: 'ana', email: 'ana@example.invalid', papel: 'OWNER'}});
    }
    if (String(url).startsWith('/api/admin/notificacoes')) return Response.json({notificacoes: [], naoLidas: 0});
    return Response.json({});
  });
  const container = document.getElementById('root');
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  for (let i = 0; i < 10 && !container.querySelector('.admin-sidebar'); i++) await flush();

  const sidebar = container.querySelector('.admin-sidebar');
  assert.ok(sidebar !== null, 'a sidebar administrativa precisa ser renderizada pelo AdminLayout');

  const itens = [...sidebar.querySelectorAll('.sidebar-main-nav a, .sidebar-system-nav a')].map((a) => a.textContent.trim());
  assert.deepEqual(itens, ['Dashboard', 'Produtos', 'Pedidos', 'Administradores', 'Despesas', 'Loja', 'Notificações']);
  assert.match(sidebar.querySelector('.sidebar-nav-item--active').textContent, /Produtos/, 'item da rota atual fica ativo');
  assert.ok(sidebar.textContent.includes('Ana Teste'), 'identificação do administrador');
  assert.ok([...sidebar.querySelectorAll('button')].some((b) => /Tema/.test(b.textContent)), 'botão de tema');
  assert.ok([...sidebar.querySelectorAll('button')].length >= 2, 'tema e logout');

  // Frame do admin: a sidebar é irmã do frame, nunca filha do scroll (que tem máscara de fade).
  const frame = container.querySelector('.storefront-frame');
  assert.ok(frame.classList.contains('storefront-frame--admin'), 'o CSS do desktop se apoia nesta classe');
  assert.equal(frame.contains(sidebar), false, 'sidebar fora do frame');
  assert.equal(container.querySelector('.storefront-frame__scroll').contains(sidebar), false, 'sidebar fora do scroll');
  // Modo compacto continua existindo (header do admin e barra inferior).
  assert.ok(container.querySelector('.header--admin') !== null, 'header do admin (modo compacto)');
  assert.ok(container.querySelector('.admin-mobile-bottom-nav') !== null, 'barra inferior (modo compacto)');

  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});

test('CSS: desktop (>= 901px) mostra a sidebar no lugar do header; <= 900px mantém o modo compacto', async () => {
  const css = await readFile(new URL('../src/admin/components/AdminSidebar.css', import.meta.url), 'utf8');

  // <= 900px: sidebar escondida (header e barra inferior assumem).
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.admin-sidebar\s*\{\s*display:\s*none;/);

  // >= 901px: header horizontal escondido e scroll recuado pela largura da sidebar.
  const desktop = css.match(/@media \(min-width: 901px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(desktop, 'bloco de desktop (min-width: 901px) presente');
  assert.match(desktop[1], /\.storefront-frame--admin \.header\s*\{\s*display:\s*none;/);
  assert.match(desktop[1], /\.storefront-frame--admin \.storefront-frame__scroll\s*\{\s*left:\s*260px;/);
  // A sidebar em si nunca é escondida no desktop, e a onda continua na largura toda.
  assert.doesNotMatch(desktop[1], /\.admin-sidebar\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(desktop[1], /storefront-frame__wave/);

  // A largura do recuo é a da própria sidebar.
  assert.match(css, /\.admin-sidebar\s*\{[^}]*width:\s*260px;/);
});
