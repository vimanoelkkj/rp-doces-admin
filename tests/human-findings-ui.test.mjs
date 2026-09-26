import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

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
Object.defineProperty(window, 'scrollX', {configurable: true, value: 7});
Object.defineProperty(window, 'scrollY', {configurable: true, value: 321});
Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1200});
Object.defineProperty(document.documentElement, 'clientWidth', {configurable: true, value: 1180});
const restoredScroll = [];
window.scrollTo = (...args) => restoredScroll.push(args);

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
      import React, {useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useAdminModal} from './src/admin/components/useAdminModal';
      import PortalDropdown from './src/admin/components/PortalDropdown';
      import EditarPedidoModal from './src/admin/Pedidos/EditarPedidoModal';
      import NovoProdutoModal from './src/admin/Produtos/NovoProdutoModal';
      import {useCatalogProducts} from './src/hooks/useCatalogProducts';
      export {act} from 'react';

      export function mountModal(container, onClose) {
        function Harness() {
          const props = useAdminModal(true, onClose);
          return <div id="backdrop" {...props}><div id="inside">conteúdo</div></div>;
        }
        const root = createRoot(container); root.render(<Harness/>); return root;
      }
      export function mountDropdown(container) {
        function Harness() {
          const anchorRef = useRef(null); const menuRef = useRef(null);
          return <><button id="anchor" ref={anchorRef}>abrir</button>
            <PortalDropdown open anchorRef={anchorRef} menuRef={menuRef} className="test-menu">
              <li>opção</li>
            </PortalDropdown></>;
        }
        const root = createRoot(container); root.render(<Harness/>); return root;
      }
      export function mountEdit(container, onClose) {
        const root = createRoot(container);
        root.render(<EditarPedidoModal orderId={1} onClose={onClose}/>);
        return root;
      }
      export function mountProduct(container, onClose) {
        const produto = {
          id: 1, nome: 'Bolo', categoria: 'bolo', descricao: 'Doce', preco_centavos: 2000,
          disponivel: 1, ativo: 1, destaque: 0, promocao_ativa: 0,
          estoque: 20, estoque_reservado: 0, emoji: '', image_key: null,
        };
        const root = createRoot(container);
        root.render(<NovoProdutoModal open onClose={onClose} produto={produto}/>);
        return root;
      }
      export function mountCatalog(container) {
        function Harness() {
          const {products, loading} = useCatalogProducts();
          return <span id="catalog-state">{loading ? 'loading' : products.map(p => p.name).join(',')}</span>;
        }
        const root = createRoot(container); root.render(<Harness/>); return root;
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
const pointer = (element, type) => element.dispatchEvent(new MouseEvent(type, {bubbles: true}));

async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', {bubbles: true}));
}

test('HUMAN-06/08: modal trava scroll e só fecha em clique genuíno no backdrop', async () => {
  let closes = 0;
  let root;
  await ui.act(async () => { root = ui.mountModal(container, () => { closes += 1; }); });
  const backdrop = document.getElementById('backdrop');
  const inside = document.getElementById('inside');

  assert.equal(document.body.style.position, 'fixed');
  assert.equal(document.body.style.top, '-321px');
  assert.equal(document.body.style.paddingRight, '24px');

  pointer(inside, 'pointerdown');
  pointer(backdrop, 'pointerup');
  pointer(backdrop, 'click');
  assert.equal(closes, 0, 'drag iniciado dentro não fecha');

  pointer(backdrop, 'pointerdown');
  pointer(inside, 'pointerup');
  pointer(backdrop, 'click');
  assert.equal(closes, 0, 'interação iniciada fora e terminada dentro não fecha');

  pointer(backdrop, 'pointerdown');
  pointer(backdrop, 'pointerup');
  pointer(backdrop, 'click');
  assert.equal(closes, 1, 'clique completo no backdrop fecha');

  await unmount(root);
  assert.equal(document.body.style.position, '');
  assert.equal(document.body.style.paddingRight, '4px');
  assert.deepEqual(restoredScroll.at(-1), [
    {left: 7, top: 321, behavior: 'instant'},
  ]);
});

test('HUMAN-01: dropdown compartilhado é portal fixo fora do fluxo do modal', async () => {
  let root;
  await ui.act(async () => { root = ui.mountDropdown(container); });
  await flush();
  const menu = document.querySelector('.test-menu');
  assert.ok(menu);
  assert.equal(menu.parentElement, document.body);
  assert.equal(menu.style.position, 'fixed');
  assert.ok(Number.parseInt(menu.style.maxHeight, 10) > 0);
  await unmount(root);
});

test('HUMAN-03: editor de itens comunica B1 e não oferece controles mutantes', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push([url, options.method ?? 'GET']);
    if (String(url).includes('/api/admin/pedidos/')) {
      return Response.json({
        pedido: {id: 1, status_pedido: 'NOVO'},
        itens: [{produto_id: 1, produto_nome: 'Bolo', quantidade: 2}],
      });
    }
    return Response.json({produtos: [{
      id: 1, nome: 'Bolo', categoria: 'bolo', descricao: '', preco_centavos: 2000,
      disponivel: 1, ativo: 1, destaque: 0, promocao_ativa: 0,
      estoque: 10, estoque_reservado: 0, emoji: '', image_key: null,
    }]});
  });

  let root;
  await ui.act(async () => { root = ui.mountEdit(container, () => {}); });
  await flush();
  assert.match(document.body.textContent, /edição de itens está temporariamente indisponível/i);
  assert.equal([...document.querySelectorAll('button')]
    .find(button => /Adicionar item/.test(button.textContent)).disabled, true);
  assert.equal([...document.querySelectorAll('button')]
    .find(button => /Salvar alterações/.test(button.textContent)).disabled, true);
  assert.equal(document.querySelector('.nped-dropdown-trigger').disabled, true);
  assert.equal(document.querySelector('.nped-qty-input').disabled, true);
  assert.deepEqual(calls.map(call => call[1]), ['GET', 'GET']);
  await unmount(root);
});

test('HUMAN-07/09: produto mascara preço e aceita estoque inteiro pelo teclado', async t => {
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === '/api/admin/categorias') {
      return Response.json({categorias: [{id: 'bolo', nome: 'Bolos', emoji: '🍰', ativo: 1}]});
    }
    if (options.method === 'PUT') {
      writes.push(JSON.parse(options.body));
      return Response.json({ok: true});
    }
    throw new Error(`request inesperado: ${url}`);
  });

  let root;
  await ui.act(async () => { root = ui.mountProduct(container, () => {}); });
  await flush();
  const stock = document.querySelector('input[aria-label="Estoque"], input[aria-label="Estoque total"]');
  const price = document.querySelector('input[inputmode="decimal"]');
  assert.equal(stock.type, 'text');

  await ui.act(async () => setInputValue(stock, '42'));
  assert.equal(stock.value, '42');
  await ui.act(async () => setInputValue(stock, '42.5'));
  assert.equal(stock.value, '42', 'decimal é recusado sem alterar o valor inteiro');

  await ui.act(async () => setInputValue(price, '1.250,50'));
  assert.equal(price.value, '1.250,50');
  await ui.act(async () => {
    document.querySelector('.np-body').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  });
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].estoque, 42);
  assert.equal(writes[0].precoCentavos, 125050);
  await unmount(root);
});

test('HUMAN-11: catálogo revalida no foco sem polling e evita requests duplicados', async t => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  // fetchProducts() faz POST /api/reservas/reconciliar e só então
  // GET /api/produtos. Só o GET é uma consulta ao catálogo; o POST é contado
  // à parte (senão o "1º request" seria a reconciliação, não o catálogo).
  let requests = 0;
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const metodo = (init.method ?? 'GET').toUpperCase();
    chamadas.push(`${metodo} ${url}`);
    if (metodo === 'POST' && url === '/api/reservas/reconciliar') return Response.json({ok: true});
    assert.ok(metodo === 'GET' && url === '/api/produtos', `request inesperado: ${metodo} ${url}`);
    requests += 1;
    return Response.json({produtos: [{
      id: 1, nome: requests === 1 ? 'Antigo' : 'Atualizado', categoria: 'bolo',
      categoria_nome: 'Bolo no Pote', descricao: '', preco_centavos: 2000,
      preco_promocional_centavos: null, promocao_inicio: null, promocao_fim: null,
      destaque: 0, ordem: 1, estoque: 10, estoque_reservado: 0, image_key: null,
    }]});
  });

  let root;
  await ui.act(async () => { root = ui.mountCatalog(container); });
  await flush();
  assert.equal(document.getElementById('catalog-state').textContent, 'Antigo');
  assert.equal(requests, 1);
  assert.deepEqual(chamadas, ['POST /api/reservas/reconciliar', 'GET /api/produtos'],
    'carga inicial: reconcilia reservas e só então lê o catálogo');

  now += 2_001;
  await ui.act(async () => window.dispatchEvent(new Event('focus')));
  await flush();
  assert.equal(document.getElementById('catalog-state').textContent, 'Atualizado');
  assert.equal(requests, 2);
  assert.deepEqual(chamadas.slice(2), ['POST /api/reservas/reconciliar', 'GET /api/produtos'],
    'revalidação no foco repete a reconciliação antes do GET');

  await ui.act(async () => window.dispatchEvent(new Event('focus')));
  await flush();
  assert.equal(requests, 2, 'segundo evento imediato é deduplicado');
  assert.equal(chamadas.length, 4, 'deduplicação também não dispara outro POST de reconciliação');

  // Sem polling: passar o tempo sem eventos de foco/visibilidade não gera requests.
  now += 60_000;
  await flush();
  assert.equal(chamadas.length, 4, 'sem polling em segundo plano');
  await unmount(root);
});
