import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// Correção de categorias hardcoded no Cardápio público: as categorias e o
// filtro precisam vir dos dados reais (`GET /api/produtos`), nunca de uma
// lista fixa no componente. Monta o componente REAL (não uma cópia da
// lógica) com fetch simulado, exatamente como os demais testes de UI do
// projeto (ver tests/b2-ui.test.mjs).

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url: 'https://local.test/cardapio'});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
test.after(() => {
  dom.window.close();
  for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
  globalThis.MessageChannel = NativeMessageChannel;
});
for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'MutationObserver', 'localStorage']) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM não implementa IntersectionObserver; `useScrollReveal` (pré-existente,
// fora do escopo desta correção) só precisa de um observer inerte para não
// lançar durante a montagem — não estamos testando a animação de revelação.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// JSDOM também não implementa requestAnimationFrame; a transição de filtro
// do Cardápio (pré-existente, fora do escopo desta correção) o usa para
// encadear a troca de conteúdo. `setTimeout` é suficiente para o teste.
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router-dom';
      import {CartProvider} from './src/context/CartContext';
      import Cardapio from './src/pages/Cardapio';
      export {act} from 'react';
      export function mount(container) {
        const root = createRoot(container);
        root.render(
          <MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}} initialEntries={['/cardapio']}>
            <CartProvider><Cardapio/></CartProvider>
          </MemoryRouter>,
        );
        return root;
      }
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"'}, loader: {'.css': 'empty', '.png': 'dataurl'},
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=cardapio-bundle.mjs').toString('base64')}`
);
const container = document.getElementById('root');
const flush = () => ui.act(async () => { await new Promise(setImmediate); });

function produto(id, categorySlug, nomeCategoria, nome) {
  return {
    id, nome, categoria: categorySlug, categoria_nome: nomeCategoria,
    descricao: '', preco_centavos: 3500, preco_promocional_centavos: null,
    promocao_ativa: 0, promocao_inicio: null, promocao_fim: null,
    destaque: 0, ordem: 0, estoque: 10, estoque_reservado: 0, image_key: null,
  };
}

async function montar(t, produtos) {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/config') {
      return Response.json({config: {
        days: [], openTime: '09:00', closeTime: '20:00',
        localName: 'R&P Doces', address: '', mapsLink: '',
        deliveryStatus: 'unavailable', whatsapp: '11999999999', defaultMessage: '',
      }});
    }
    return Response.json({produtos});
  });
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  t.after(async () => { await ui.act(async () => root.unmount()); container.innerHTML = ''; });
  return root;
}

test('categorias reais são renderizadas, sem depender de lista fixa no componente', async t => {
  await montar(t, [
    produto(1, 'BOLO_NO_POTE', 'Bolo no Pote', 'Bolo de Morango'),
    produto(2, 'PUDINS_ESPECIAIS', 'Pudins Especiais', 'Pudim de Leite'),
  ]);

  const abas = [...container.querySelectorAll('[role="tab"]')].map(el => el.textContent);
  assert.deepEqual(abas, ['Todos', 'Bolo no Pote', 'Pudins Especiais'],
    'nomes vêm dos dados, nenhum deles é um texto fixo do componente');

  // O código-fonte não pode conter os nomes das categorias como literal.
  const fs = await import('node:fs/promises');
  const fonte = await fs.readFile(new URL('../src/pages/Cardapio.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /Bolo no Pote|Pudins Especiais|Mini [Pp]udins?/,
    'categorias não podem estar hardcoded no componente');
});

test('"Todos" mostra tudo por padrão; selecionar uma categoria filtra pelo slug', async t => {
  await montar(t, [
    produto(1, 'BOLO_NO_POTE', 'Bolo no Pote', 'Bolo de Morango'),
    produto(2, 'PUDINS_ESPECIAIS', 'Pudins Especiais', 'Pudim de Leite'),
  ]);

  const nomesProdutos = () => [...container.querySelectorAll('.product-name')].map(el => el.textContent);
  assert.deepEqual(nomesProdutos().sort(), ['Bolo de Morango', 'Pudim de Leite'],
    '"Todos" é o estado inicial e mostra os dois produtos');

  const abaPudins = [...container.querySelectorAll('[role="tab"]')]
    .find(el => el.textContent === 'Pudins Especiais');
  // O clique dispara um `setTimeout` interno (fade out -> troca -> fade in,
  // 250ms) que também atualiza estado do React — precisa ficar dentro do
  // mesmo `act` para as atualizações serem processadas deterministicamente.
  await ui.act(async () => {
    abaPudins.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    await new Promise(r => setTimeout(r, 300));
  });
  await flush();

  assert.deepEqual(nomesProdutos(), ['Pudim de Leite'], 'filtra pelo slug, não pelo texto do rótulo');
  assert.equal(abaPudins.getAttribute('aria-selected'), 'true');

  const abaTodos = [...container.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Todos');
  await ui.act(async () => {
    abaTodos.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    await new Promise(r => setTimeout(r, 300));
  });
  await flush();
  assert.deepEqual(nomesProdutos().sort(), ['Bolo de Morango', 'Pudim de Leite'], 'Todos volta a mostrar tudo');
});

test('renomear a categoria nos dados muda o rótulo sem qualquer alteração de código', async t => {
  await montar(t, [produto(1, 'BOLO_NO_POTE', 'Nome Renomeado no Admin', 'Bolo de Morango')]);
  const abas = [...container.querySelectorAll('[role="tab"]')].map(el => el.textContent);
  assert.deepEqual(abas, ['Todos', 'Nome Renomeado no Admin']);
});

test('categoria sem nenhum produto não aparece — mesmo comportamento de antes da correção', async t => {
  // Preserva o comportamento atual (derivado dos produtos retornados): uma
  // categoria só existe no filtro público se tiver ao menos um produto
  // disponível. Não há regra explícita em contrário no Admin/backend.
  await montar(t, [produto(1, 'BOLO_NO_POTE', 'Bolo no Pote', 'Bolo de Morango')]);
  const abas = [...container.querySelectorAll('[role="tab"]')].map(el => el.textContent);
  assert.deepEqual(abas, ['Todos', 'Bolo no Pote']);
});

test('falha ao carregar produtos não derruba a página e não inventa categoria', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('offline', {status: 500}));
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  t.after(async () => { await ui.act(async () => root.unmount()); container.innerHTML = ''; });

  assert.doesNotThrow(() => container.querySelector('.cardapio-page'));
  assert.ok(container.querySelector('.cardapio-page'), 'página continua montada, sem crash');
  const abas = [...container.querySelectorAll('[role="tab"]')].map(el => el.textContent);
  assert.deepEqual(abas, ['Todos'], 'sem produtos, nenhuma categoria inventada além da opção sintética');
  assert.match(container.textContent, /Falha ao carregar produtos/, 'erro existente do hook é exibido, não escondido');
});
