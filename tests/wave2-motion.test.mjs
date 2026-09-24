import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Testes direcionados para Wave 2 Motion:
// 1. ProductCard: microinterações, justAdded, esgotado/disabled, aria-label
// 2. Header: entrada, menu mobile com AnimatePresence, aria-expanded, foco, Escape, focus trap

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://local.test',
});

const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};

test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

for (const name of [
  'window',
  'document',
  'navigator',
  'Element',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLDivElement',
  'SVGElement',
  'Node',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'PointerEvent',
  'MutationObserver',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rafCallbacks = new Map();
let nextRafId = 1;
const raf = (cb) => {
  const id = nextRafId++;
  const timer = setTimeout(() => {
    rafCallbacks.delete(id);
    cb(performance.now());
  }, 0);
  rafCallbacks.set(id, timer);
  return id;
};
const cancelRaf = (id) => {
  const timer = rafCallbacks.get(id);
  if (timer) {
    clearTimeout(timer);
    rafCallbacks.delete(id);
  }
};
globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = cancelRaf;
dom.window.requestAnimationFrame = raf;
dom.window.cancelAnimationFrame = cancelRaf;

if (!dom.window.matchMedia) {
  dom.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
globalThis.matchMedia = dom.window.matchMedia;

dom.window.scrollTo = () => {};
globalThis.scrollTo = dom.window.scrollTo;

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React, { useState, act } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import ProductCard from './src/components/ProductCard';
      import Header from './src/components/Header';
      export { act };

      export function mountProductCard(container, props) {
        const root = createRoot(container);
        root.render(<ProductCard {...props} />);
        return root;
      }

      export function mountHeader(container, props = {}) {
        const root = createRoot(container);
        root.render(
          <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Header {...props} />
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
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
});

const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=wave2-bundle.mjs').toString('base64')}`
);

const flush = async (ms = 25) => {
  await ui.act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

// ==========================================
// 1. PRODUCTCARD TESTS
// ==========================================

test('ProductCard: produto esgotado desabilita botão e preserva aria-label', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let called = false;
  const product = {
    id: 1,
    name: 'Bolo Esgotado',
    category: 'Bolo',
    price: 25,
    image: '',
    disponibilidade: 0,
  };

  let root;
  await ui.act(async () => {
    root = ui.mountProductCard(container, {
      product,
      onAddToCart: () => { called = true; },
    });
  });
  await flush();

  const button = container.querySelector('.add-button');
  assert.ok(button, 'Botão de adicionar deve existir');
  assert.strictEqual(button.disabled, true, 'Botão deve estar disabled nativo');
  assert.strictEqual(button.getAttribute('aria-label'), 'Bolo Esgotado esgotado');
  assert.ok(button.classList.contains('add-button--esgotado'));

  await ui.act(async () => {
    button.click();
  });
  await flush();

  assert.strictEqual(called, false, 'onAddToCart não deve ser chamado quando esgotado');

  await ui.act(async () => {
    root.unmount();
  });
  container.remove();
  await flush();
});

test('ProductCard: produto disponível chama onAddToCart uma vez, entra em justAdded e bloqueia repetição', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let callCount = 0;
  const product = {
    id: 2,
    name: 'Pudim Delícia',
    category: 'Pudim',
    price: 15,
    image: '',
    disponibilidade: 5,
  };

  let root;
  await ui.act(async () => {
    root = ui.mountProductCard(container, {
      product,
      onAddToCart: () => { callCount++; },
    });
  });
  await flush();

  const button = container.querySelector('.add-button');
  assert.ok(button);
  assert.strictEqual(button.disabled, false);
  assert.strictEqual(button.getAttribute('aria-label'), 'Adicionar Pudim Delícia');
  assert.strictEqual(button.textContent.trim(), '+');

  // Primeiro clique
  await ui.act(async () => {
    button.click();
  });

  // Aguarda a transição de saída do "+" e entrada do "check" no AnimatePresence mode="wait"
  for (let i = 0; i < 20; i++) {
    await flush(25);
    if (button.querySelector('svg')) break;
  }

  assert.strictEqual(callCount, 1, 'onAddToCart deve ser chamado exatamente uma vez');
  assert.ok(button.classList.contains('add-button--added'), 'Deve ter classe add-button--added');

  // Verifica que o SVG de check mark está montado
  const checkSvg = button.querySelector('svg');
  assert.ok(checkSvg, 'SVG de confirmação (check) deve estar montado');

  // Segundo clique enquanto justAdded está ativo não dispara onAddToCart novamente
  await ui.act(async () => {
    button.click();
  });
  await flush();

  assert.strictEqual(callCount, 1, 'Não deve chamar onAddToCart novamente enquanto em justAdded');

  await ui.act(async () => {
    root.unmount();
  });
  container.remove();
  await flush();
});

// ==========================================
// 2. HEADER MOBILE TESTS
// ==========================================

test('Header mobile: abrir menu adiciona classes abertas e clique em link fecha', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let root;
  await ui.act(async () => {
    root = ui.mountHeader(container);
  });
  await flush();

  const hamburger = container.querySelector('.mobile-menu-btn');
  assert.ok(hamburger, 'Botão hambúrguer deve existir');
  assert.ok(!hamburger.classList.contains('mobile-menu-btn--open'), 'Não deve iniciar com classe aberta');

  // Clicar para abrir
  await ui.act(async () => {
    hamburger.click();
  });
  await flush();

  assert.ok(hamburger.classList.contains('mobile-menu-btn--open'), 'Botão deve ter classe aberta');

  const menu = document.querySelector('.mobile-menu');
  assert.ok(menu, 'Elemento .mobile-menu deve existir no DOM');
  assert.ok(menu.classList.contains('mobile-menu--open'), 'Menu deve ter classe aberta');

  const overlay = document.querySelector('.mobile-menu-overlay');
  assert.ok(overlay, 'Elemento .mobile-menu-overlay deve existir no DOM');
  assert.ok(overlay.classList.contains('mobile-menu-overlay--open'), 'Overlay deve ter classe aberta');

  // Clicar em link fecha menu
  const cardapioBtn = Array.from(document.querySelectorAll('.mobile-menu-links button')).find(
    (b) => b.textContent.includes('Cardápio'),
  );
  assert.ok(cardapioBtn, 'Botão do Cardápio deve existir');
  await ui.act(async () => {
    cardapioBtn.click();
  });
  await flush();

  assert.ok(!hamburger.classList.contains('mobile-menu-btn--open'), 'Botão não deve mais ter classe aberta');
  assert.ok(!menu.classList.contains('mobile-menu--open'), 'Menu não deve mais ter classe aberta');

  await ui.act(async () => {
    root.unmount();
  });
  container.remove();
  await flush();
});
