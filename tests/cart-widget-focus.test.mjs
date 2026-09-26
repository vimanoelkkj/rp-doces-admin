import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Teste de regressão para foco no CartWidget (Motion):
// Garante que o fechamento da Sacola via Escape restaura o foco
// no novo nó CartFAB conectado ao DOM após o unmount/remount de AnimatePresence.

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
  'MutationObserver',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Em JSDOM, requestAnimationFrame e matchMedia precisam de shims
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

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import CartWidget from './src/components/CartWidget';
      export { act } from 'react';

      export function mountHarness(container) {
        function Harness() {
          const [isOpen, setIsOpen] = useState(false);
          const items = [{ id: 1, name: 'Bolo Cenoura', price: 20, quantity: 1, image: '' }];
          return (
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <button
                id="external-trigger"
                type="button"
                onClick={() => setIsOpen(true)}
              >
                Abrir Externo
              </button>
              <CartWidget
                items={items}
                isOpen={isOpen}
                onOpen={() => setIsOpen(true)}
                onClose={() => setIsOpen(false)}
                onUpdateQuantity={() => {}}
                onRemoveItem={() => {}}
              />
            </MemoryRouter>
          );
        }

        const root = createRoot(container);
        root.render(<Harness />);
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
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=cart-widget-focus-bundle.mjs').toString('base64')}`
);

const container = document.getElementById('root');
const flush = async () => {
  await ui.act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

test('foco: abrir pelo CartFAB -> dialog recebe foco -> fechar via Escape -> foco restaura no NOVO CartFAB conectado', async () => {
  let root;
  await ui.act(async () => {
    root = ui.mountHarness(container);
  });
  await flush();

  // 1. CartFAB inicial montado
  const initialFab = document.querySelector('.cart-fab');
  assert.ok(initialFab, 'CartFAB inicial deve estar presente no DOM');
  assert.ok(document.contains(initialFab), 'CartFAB inicial deve estar conectado ao document');

  // 2. Focar no CartFAB inicial
  initialFab.focus();
  assert.ok(document.activeElement === initialFab, 'Foco deve estar no CartFAB inicial antes de abrir');

  // 3. Abrir a Sacola pelo CartFAB
  await ui.act(async () => {
    initialFab.click();
  });
  await flush();

  // 4. Modal/Dialog aberto e foco transferido para dentro do dialog (botão Fechar)
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'Dialog do carrinho deve estar visível');

  const closeButton = document.querySelector('.cart-close-btn');
  assert.ok(closeButton, 'Botão fechar deve estar montado');
  assert.ok(document.activeElement === closeButton, 'Foco inicial deve ir para o botão Fechar do dialog');
  assert.ok(dialog.contains(document.activeElement), 'Foco deve estar contido dentro do dialog');

  // Aguarda até a animação de saída do AnimatePresence desanexar o CartFAB inicial
  for (let i = 0; i < 60; i++) {
    await ui.act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    if (!document.contains(initialFab)) break;
  }

  assert.strictEqual(
    document.contains(initialFab),
    false,
    'CartFAB inicial antigo deve ter sido desanexado do DOM pelo AnimatePresence',
  );

  // 5. Pressionar Escape para fechar a Sacola
  await ui.act(async () => {
    const escEvent = new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(escEvent);
  });
  await flush();

  // 6. Verificar novo CartFAB montado e foco restaurado
  const newFab = document.querySelector('.cart-fab');
  assert.ok(newFab, 'Novo CartFAB deve existir após fechamento do modal');
  assert.notStrictEqual(newFab, initialFab, 'Novo CartFAB é um elemento DOM recém-montado');
  assert.ok(document.contains(newFab), 'Novo CartFAB está conectado ao document');

  // 7. O document.activeElement DEVE ser o novo CartFAB conectado ao DOM
  // Comparação booleana: assert.strictEqual entre nós DOM, ao falhar, faz o
  // node:assert gerar um diff gigante do DOM e estoura a memória.
  assert.ok(
    document.activeElement === newFab,
    'O foco deve retornar ao novo CartFAB conectado',
  );
  assert.ok(
    document.contains(document.activeElement),
    'Elemento focado deve estar conectado ao document',
  );

  await ui.act(async () => {
    root.unmount();
  });
  await flush();
});

test('foco: abrir por elemento externo conectado -> fechar via Escape -> foco restaura no elemento original conectado', async () => {
  let root;
  await ui.act(async () => {
    root = ui.mountHarness(container);
  });
  await flush();

  const externalBtn = document.getElementById('external-trigger');
  assert.ok(externalBtn, 'Botão externo deve existir');
  externalBtn.focus();
  assert.strictEqual(document.activeElement, externalBtn, 'Foco inicial no gatilho externo');

  await ui.act(async () => {
    externalBtn.click();
  });
  await flush();

  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'Dialog deve estar aberto');
  assert.ok(dialog.contains(document.activeElement), 'Foco deve ter entrado no dialog');

  // Fechar via Escape
  await ui.act(async () => {
    const escEvent = new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(escEvent);
  });
  await flush();

  assert.ok(
    document.activeElement === externalBtn,
    'Foco deve retornar ao gatilho externo que continuou conectado ao documento',
  );
  assert.ok(document.contains(externalBtn), 'Gatilho externo continua conectado');

  await ui.act(async () => {
    root.unmount();
  });
  await flush();
});
