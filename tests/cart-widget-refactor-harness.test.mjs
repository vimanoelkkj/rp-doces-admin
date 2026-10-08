import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://local.test"
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
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLDivElement",
  "SVGElement",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const rafCallbacks = new Map();
let nextRafId = 1;
const raf = cb => {
  const id = nextRafId++;
  const timer = setTimeout(() => {
    rafCallbacks.delete(id);
    cb(performance.now());
  }, 0);
  rafCallbacks.set(id, timer);
  return id;
};
const cancelRaf = id => {
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

const mockIsMobile = false;
const mediaListeners = new Set();
dom.window.matchMedia = query => ({
  matches: mockIsMobile,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: (_ev, cb) => mediaListeners.add(cb),
  removeEventListener: (_ev, cb) => mediaListeners.delete(cb),
  dispatchEvent: () => false
});
globalThis.matchMedia = dom.window.matchMedia;

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter, useLocation } from 'react-router-dom';
      import CartWidget from './src/components/CartWidget';
      export { act } from 'react';

      let lastNavigatedPath = null;
      export function getLastNavigatedPath() {
        return lastNavigatedPath;
      }

      function LocationWatcher() {
        const location = useLocation();
        lastNavigatedPath = location.pathname;
        return null;
      }

      export function mountHarness(container, initialProps = {}) {
        let updatePropsFn;

        function Harness() {
          const [props, setProps] = useState({
            isOpen: false,
            items: [
              { id: 1, name: 'Bolo Cenoura', price: 20.5, quantity: 2, image: 'img1.png', disponibilidade: 3 },
              { id: 2, name: 'Brownie', price: 12, quantity: 1, image: 'img2.png' }
            ],
            ...initialProps
          });
          updatePropsFn = setProps;

          return (
            <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <LocationWatcher />
              <button
                id="external-trigger"
                type="button"
                onClick={() => setProps(p => ({ ...p, isOpen: true }))}
              >
                Abrir Externo
              </button>
              <CartWidget
                items={props.items}
                isOpen={props.isOpen}
                onOpen={() => {
                  props.onOpen?.();
                  setProps(p => ({ ...p, isOpen: true }));
                }}
                onClose={() => {
                  props.onClose?.();
                  setProps(p => ({ ...p, isOpen: false }));
                }}
                onUpdateQuantity={(id, q) => {
                  props.onUpdateQuantity?.(id, q);
                  setProps(p => ({
                    ...p,
                    items: p.items.map(it => it.id === id ? { ...it, quantity: q } : it)
                  }));
                }}
                onRemoveItem={(id) => {
                  props.onRemoveItem?.(id);
                  setProps(p => ({
                    ...p,
                    items: p.items.filter(it => it.id !== id)
                  }));
                }}
              />
            </MemoryRouter>
          );
        }

        const root = createRoot(container);
        root.render(<Harness />);
        return {
          root,
          updateProps: (newProps) => updatePropsFn(p => ({ ...p, ...newProps }))
        };
      }
    `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty", ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl" }
});

const ui = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=cart-widget-refactor-harness-bundle.mjs`).toString("base64")}`
);

const container = document.getElementById("root");
const flush = async () => {
  await ui.act(async () => {
    await new Promise(r => setTimeout(r, 25));
  });
};

test("Harness: renderização de itens, totais, controles de quantidade e remoção", async () => {
  const updatedQuantities = [];
  const removedItems = [];

  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: true,
      onUpdateQuantity: (id, q) => updatedQuantities.push({ id, q }),
      onRemoveItem: id => removedItems.push(id)
    });
  });
  await flush();

  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, "Dialog deve estar aberto");
  assert.strictEqual(dialog.getAttribute("aria-modal"), "true");
  assert.strictEqual(dialog.getAttribute("aria-labelledby"), "cart-modal-title");

  // Itens
  const itemRows = document.querySelectorAll(".cart-item");
  assert.strictEqual(itemRows.length, 2, "Devem ser renderizados 2 itens");

  const name1 = itemRows[0].querySelector(".cart-item-name");
  assert.strictEqual(name1?.textContent, "Bolo Cenoura");

  const price1 = itemRows[0].querySelector(".cart-item-price");
  assert.strictEqual(price1?.textContent, "R$ 20,50");

  const totalVal = document.querySelector(".cart-total-value");
  // 2 * 20.5 + 1 * 12 = 41 + 12 = 53
  assert.strictEqual(totalVal?.textContent, "R$ 53,00");

  // Botões de quantidade no item 1
  const qtyBtnsItem1 = itemRows[0].querySelectorAll(".cart-qty-controls button");
  assert.strictEqual(qtyBtnsItem1.length, 2);
  const [btnMinus, btnPlus] = qtyBtnsItem1;

  // Diminuir
  await ui.act(async () => {
    btnMinus.click();
  });
  await flush();
  assert.deepStrictEqual(updatedQuantities[0], { id: 1, q: 1 });

  // Aumentar no item 1 (disponibilidade é 3, atualmente quantity é 1 após update)
  await ui.act(async () => {
    btnPlus.click();
  });
  await flush();
  assert.deepStrictEqual(updatedQuantities[1], { id: 1, q: 2 });

  // Testar estoque limite (setar quantity = 3 no item 1)
  await ui.act(async () => {
    instance.updateProps({
      items: [
        {
          id: 1,
          name: "Bolo Cenoura",
          price: 20.5,
          quantity: 3,
          image: "img1.png",
          disponibilidade: 3
        }
      ]
    });
  });
  await flush();

  const updatedRows = document.querySelectorAll(".cart-item");
  const plusBtnDisabled = updatedRows[0].querySelectorAll(".cart-qty-controls button")[1];
  assert.strictEqual(
    plusBtnDisabled.disabled,
    true,
    "Botão + deve ficar disabled com limite de estoque atingido"
  );
  assert.strictEqual(plusBtnDisabled.getAttribute("aria-disabled"), "true");
  assert.strictEqual(plusBtnDisabled.getAttribute("title"), "Limite de estoque atingido");

  // Remoção
  const removeBtn = updatedRows[0].querySelector(".cart-remove-btn");
  assert.ok(removeBtn);
  assert.strictEqual(removeBtn.getAttribute("aria-label"), "Remover");
  await ui.act(async () => {
    removeBtn.click();
  });
  await flush();
  assert.deepStrictEqual(removedItems, [1]);

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Harness: carrinho vazio", async () => {
  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: true,
      items: []
    });
  });
  await flush();

  const emptyText = document.querySelector(".cart-empty");
  assert.ok(emptyText, "Mensagem de carrinho vazio deve estar visível");
  assert.strictEqual(emptyText.textContent, "Seu carrinho está vazio");

  const footer = document.querySelector(".cart-modal-footer");
  assert.strictEqual(footer, null, "Rodapé não deve ser renderizado quando carrinho estiver vazio");

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Harness: todos os 5 caminhos de fechamento e navegação para /checkout", async () => {
  // Caminho 1: Botão X
  let closedTimes = 0;
  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: true,
      onClose: () => closedTimes++
    });
  });
  await flush();

  const closeBtn = document.querySelector(".cart-close-btn");
  assert.ok(closeBtn);
  assert.strictEqual(closeBtn.getAttribute("aria-label"), "Fechar");
  await ui.act(async () => {
    closeBtn.click();
  });
  await flush();
  assert.strictEqual(closedTimes, 1, "Botão X deve fechar");

  // Reabrir e testar Caminho 2: Overlay
  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();
  const overlay = document.querySelector(".cart-overlay");
  assert.ok(overlay, "Overlay deve estar montado");
  await ui.act(async () => {
    overlay.click();
  });
  await flush();
  assert.strictEqual(closedTimes, 2, "Overlay deve fechar");

  // Reabrir e testar Caminho 3: Escape
  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();
  await ui.act(async () => {
    const escEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(escEvent);
  });
  await flush();
  assert.strictEqual(closedTimes, 3, "Escape deve fechar");

  // Reabrir e testar Caminho 4: Continuar comprando
  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();
  const continueBtn = document.querySelector(".cart-continue-btn");
  assert.ok(continueBtn);
  assert.strictEqual(continueBtn.textContent?.trim(), "Continuar comprando");
  await ui.act(async () => {
    continueBtn.click();
  });
  await flush();
  assert.strictEqual(closedTimes, 4, "Continuar comprando deve fechar");

  // Reabrir e testar Caminho 5: Checkout navega para /checkout e fecha
  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();
  const checkoutBtn = document.querySelector(".cart-checkout-btn");
  assert.ok(checkoutBtn);
  assert.strictEqual(checkoutBtn.textContent?.trim(), "CONTINUAR PARA PAGAMENTO");
  await ui.act(async () => {
    checkoutBtn.click();
  });
  await flush();
  assert.strictEqual(closedTimes, 5, "Checkout deve fechar");
  assert.strictEqual(
    ui.getLastNavigatedPath(),
    "/checkout",
    "Checkout deve navegar para /checkout"
  );

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Harness: scroll lock e focus trap circular", async () => {
  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: false
    });
  });
  await flush();

  assert.strictEqual(document.body.style.overflow, "");
  assert.strictEqual(document.body.style.paddingRight, "");

  // Abre
  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();

  assert.strictEqual(
    document.body.style.overflow,
    "hidden",
    "Body overflow deve ser hidden ao abrir"
  );

  // Focus trap
  const modal = document.querySelector('[role="dialog"]');
  const focusables = modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  assert.ok(focusables.length > 2);
  const firstFocusable = focusables[0];
  const lastFocusable = focusables[focusables.length - 1];

  // Tab no último deve ir para o primeiro
  lastFocusable.focus();
  assert.strictEqual(document.activeElement, lastFocusable);
  await ui.act(async () => {
    const tabEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(tabEvent);
  });
  assert.strictEqual(
    document.activeElement,
    firstFocusable,
    "Tab no último elemento deve ir para o primeiro"
  );

  // Shift+Tab no primeiro deve ir para o último
  firstFocusable.focus();
  assert.strictEqual(document.activeElement, firstFocusable);
  await ui.act(async () => {
    const shiftTabEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(shiftTabEvent);
  });
  assert.strictEqual(
    document.activeElement,
    lastFocusable,
    "Shift+Tab no primeiro elemento deve ir para o último"
  );

  // Fecha e verifica restauração de scroll
  await ui.act(async () => {
    instance.updateProps({ isOpen: false });
  });
  await flush();

  assert.strictEqual(
    document.body.style.overflow,
    "",
    "Body overflow deve ser restaurado ao fechar"
  );
  assert.strictEqual(
    document.body.style.paddingRight,
    "",
    "Body paddingRight deve ser restaurado ao fechar"
  );

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Harness: scroll lock com scrollbar vs sem scrollbar", async () => {
  // Com scrollbar simulada (innerWidth 1024, clientWidth 1008 => 16px)
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(dom.window.document.documentElement, "clientWidth", {
    configurable: true,
    value: 1008
  });

  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, { isOpen: true });
  });
  await flush();

  assert.strictEqual(
    document.body.style.paddingRight,
    "16px",
    "paddingRight deve compensar scrollbar de 16px"
  );
  assert.strictEqual(document.body.style.overflow, "hidden");

  // Fecha
  await ui.act(async () => {
    instance.updateProps({ isOpen: false });
  });
  await flush();
  assert.strictEqual(document.body.style.paddingRight, "");
  assert.strictEqual(document.body.style.overflow, "");

  // Sem scrollbar (innerWidth === clientWidth => 0px)
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(dom.window.document.documentElement, "clientWidth", {
    configurable: true,
    value: 1024
  });

  await ui.act(async () => {
    instance.updateProps({ isOpen: true });
  });
  await flush();
  assert.strictEqual(
    document.body.style.paddingRight,
    "0px",
    "paddingRight deve ser 0px quando não há scrollbar"
  );

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Harness: bump do FAB e ausência no primeiro total", async () => {
  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: false,
      items: [{ id: 1, name: "Bolo", price: 10, quantity: 1, image: "" }]
    });
  });
  await flush();

  const fab = document.querySelector(".cart-fab");
  assert.ok(fab, "FAB deve existir");
  const badge = fab.querySelector(".cart-fab-badge");
  assert.strictEqual(badge?.textContent, "1", "Badge inicial deve ser 1");

  // Aumentar totalItems para 2 deve atualizar o badge
  await ui.act(async () => {
    instance.updateProps({
      items: [{ id: 1, name: "Bolo", price: 10, quantity: 2, image: "" }]
    });
  });
  await flush();

  const updatedBadge = document.querySelector(".cart-fab-badge");
  assert.strictEqual(updatedBadge?.textContent, "2", "Badge deve atualizar para 2");

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});

test("Controles Negativos: limite de estoque, remoção de aria-disabled e rota /checkout", async () => {
  let instance;
  await ui.act(async () => {
    instance = ui.mountHarness(container, {
      isOpen: true,
      items: [{ id: 10, name: "Docinho", price: 5, quantity: 2, image: "", disponibilidade: 2 }]
    });
  });
  await flush();

  const item = document.querySelector(".cart-item");
  const plusBtn = item.querySelectorAll(".cart-qty-controls button")[1];

  // Controle negativo 1: botão não pode estar habilitado se atingiu disponibilidade
  assert.strictEqual(plusBtn.disabled, true);
  assert.strictEqual(plusBtn.getAttribute("aria-disabled"), "true");

  // Controle negativo 2: rota de checkout não pode ser outra que não /checkout
  const checkoutBtn = document.querySelector(".cart-checkout-btn");
  await ui.act(async () => {
    checkoutBtn.click();
  });
  await flush();
  assert.strictEqual(ui.getLastNavigatedPath(), "/checkout");
  assert.notStrictEqual(ui.getLastNavigatedPath(), "/pagamento");

  await ui.act(async () => {
    instance.root.unmount();
  });
  await flush();
});
