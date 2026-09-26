import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Detalhes do produto no Cardápio: card compacto com foto/nome abrindo o
// detalhe, botão + independente, modal com conteúdo completo e quantidade
// limitada pela disponibilidade menos o que já está na sacola (CartContext real).

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://local.test',
});

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

for (const name of [
  'window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLButtonElement',
  'HTMLDivElement', 'SVGElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent',
  'PointerEvent', 'MutationObserver', 'getComputedStyle', 'localStorage',
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const raf = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = raf;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
if (!dom.window.matchMedia) {
  dom.window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  });
}
globalThis.matchMedia = dom.window.matchMedia;

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React, { act } from 'react';
      import { createRoot } from 'react-dom/client';
      import ProductCard from './src/components/ProductCard';
      import ProductDetailsModal from './src/components/ProductDetailsModal';
      import { CartProvider, useCart } from './src/context/CartContext';
      export { act };

      export function mount(container, element) {
        const root = createRoot(container);
        root.render(element);
        return root;
      }
      export const card = (props) => <ProductCard {...props} />;
      export const modal = (props) => <ProductDetailsModal {...props} />;

      // Modal ligado ao CartContext real, como no Cardápio.
      export function cartHarness(product, onApi) {
        function Harness() {
          const cart = useCart();
          onApi(cart);
          const naSacola = cart.cartItems.find((i) => i.id === product.id)?.quantity ?? 0;
          return (
            <ProductDetailsModal
              product={product}
              quantityInCart={naSacola}
              onClose={() => {}}
              onAddToCart={(q) => cart.addToCart(product, q)}
            />
          );
        }
        return <CartProvider><Harness /></CartProvider>;
      }
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=product-details-bundle.mjs').toString('base64')}`
);

const flush = async (ms = 25) => { await ui.act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

const completo = {
  id: 7,
  name: 'Encanto de frutas vermelhas',
  category: 'Bolo no Pote',
  categorySlug: 'BOLO_NO_POTE',
  description: 'Creme suave com frutas vermelhas e massa artesanal.',
  weightText: '220 g',
  ingredients: 'Leite condensado, creme de leite, frutas vermelhas',
  allergens: 'Contém leite e derivados.',
  price: 15,
  originalPrice: 18,
  image: '/api/images/encanto.webp',
  disponibilidade: 5,
};
const minimo = {
  id: 8, name: 'Pudim', category: 'Mini Pudim', categorySlug: 'MINI_PUDIM',
  price: 12, image: '', disponibilidade: 5,
};

async function montar(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root;
  await ui.act(async () => { root = ui.mount(container, element); });
  await flush();
  return {
    container,
    async desmontar() {
      await ui.act(async () => root.unmount());
      container.remove();
      localStorage.clear();
      await flush();
    },
  };
}

const dialogo = () => document.querySelector('[role="dialog"]');
const texto = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const clicar = (el) => ui.act(async () => { el.click(); });

test('card mostra só a descrição (detalhes ficam no modal); foto/nome abrem o detalhe; + continua independente (F)', async () => {
  let abriu = 0;
  let adicionou = 0;
  const m = await montar(ui.card({
    product: completo, onAddToCart: () => { adicionou++; }, onOpenDetails: () => { abriu++; },
  }));
  const card = m.container.querySelector('.product-card');
  assert.equal(texto(card.querySelector('.product-description')), completo.description);
  // Peso, ingredientes e alérgenos pertencem ao modal, não ao card.
  assert.doesNotMatch(texto(card), /220 g|Ingredientes|Leite condensado|Contém leite/);

  // Card inteiro não é clicável: só foto e nome são botões de detalhe.
  assert.notEqual(card.tagName, 'BUTTON');
  const foto = card.querySelector('.product-image-button');
  const nome = card.querySelector('.product-name-button');
  assert.equal(foto.getAttribute('aria-label'), `Ver detalhes de ${completo.name}`);
  assert.equal(nome.tagName, 'BUTTON');
  assert.equal(nome.getAttribute('type'), 'button');
  assert.equal(card.querySelectorAll('button button').length, 0, 'sem botões aninhados');

  await clicar(foto);
  await clicar(nome);
  assert.equal(abriu, 2);
  assert.equal(adicionou, 0);

  const mais = card.querySelector('.add-button');
  await clicar(mais);
  assert.equal(adicionou, 1, '+ adiciona direto');
  assert.equal(abriu, 2, '+ não abre o detalhe');
  await m.desmontar();
});

test('card sem descrição não gera bloco vazio; sem onOpenDetails mantém a imagem original', async () => {
  const m = await montar(ui.card({ product: minimo, onAddToCart: () => {} }));
  const card = m.container.querySelector('.product-card');
  assert.equal(card.querySelector('.product-description'), null);
  assert.equal(card.querySelector('.product-image-button'), null);
  assert.equal(card.querySelector('.product-image').getAttribute('alt'), 'Pudim');
  await m.desmontar();
});

test('G: modal mostra descrição, peso, ingredientes, alérgenos, preços e acessibilidade', async () => {
  let fechou = 0;
  const m = await montar(ui.modal({
    product: completo, quantityInCart: 0, onClose: () => { fechou++; }, onAddToCart: () => {},
  }));
  const d = dialogo();
  assert.ok(d);
  assert.equal(d.getAttribute('aria-modal'), 'true');
  // Backdrop em camada separada do diálogo (irmãos), não o envolvendo.
  const backdrop = document.querySelector('.pdm-backdrop');
  assert.equal(backdrop.contains(d), false);
  assert.equal(backdrop.parentElement, d.parentElement);
  const titulo = document.getElementById(d.getAttribute('aria-labelledby'));
  assert.equal(texto(titulo), completo.name);
  assert.equal(document.activeElement, d.querySelector('.pdm-close'), 'foco inicial no fechar');

  assert.equal(texto(d.querySelector('.product-category')), 'Bolo no Pote');
  assert.equal(texto(d.querySelector('.pdm-description')), completo.description);
  const secoes = [...d.querySelectorAll('.pdm-section')].map((s) => [
    texto(s.querySelector('.pdm-section-title')), texto(s.querySelector('.pdm-section-text')),
  ]);
  assert.deepEqual(secoes, [
    ['Peso / porção', '220 g'],
    ['Ingredientes', completo.ingredients],
    ['Alérgenos', completo.allergens],
  ]);
  // Mesma regra de promoção do card (componente compartilhado).
  assert.equal(texto(d.querySelector('.product-price-original')), 'R$ 18,00');
  assert.equal(texto(d.querySelector('.product-price')), 'R$ 15,00');
  assert.equal(texto(d.querySelector('.product-promo-badge')), 'Promoção');
  assert.equal(texto(d.querySelector('.pdm-add')), 'Adicionar à sacola');

  // Clique dentro do conteúdo não fecha.
  await ui.act(async () => {
    d.querySelector('.pdm-description').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await flush(250);
  assert.equal(fechou, 0);
  await m.desmontar();
});

const CAMINHOS_FECHAR = {
  backdrop: () => document.querySelector('.pdm-backdrop')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  Escape: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  'botão ×': () => document.querySelector('.pdm-close').click(),
};

for (const [caminho, disparar] of Object.entries(CAMINHOS_FECHAR)) {
  test(`fechar pelo ${caminho}: anima a saída e só depois chama onClose, uma única vez`, async () => {
    let fechou = 0;
    const m = await montar(ui.modal({
      product: completo, onClose: () => { fechou++; }, onAddToCart: () => {},
    }));
    await ui.act(async () => { disparar(); });
    assert.equal(fechou, 0, 'aguarda a animação de saída');
    assert.ok(document.querySelector('.pdm-root').classList.contains('pdm-root--fechando'));
    // Pedidos repetidos durante a saída não geram outro onClose.
    await ui.act(async () => { CAMINHOS_FECHAR.Escape(); });
    await flush(250);
    assert.equal(fechou, 1);
    await m.desmontar();
  });
}

test('com prefers-reduced-motion, fecha na hora sem animação', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({ ...original(query), matches: query.includes('reduce') });
  try {
    let fechou = 0;
    const m = await montar(ui.modal({
      product: completo, onClose: () => { fechou++; }, onAddToCart: () => {},
    }));
    await clicar(document.querySelector('.pdm-close'));
    assert.equal(fechou, 1);
    assert.equal(document.querySelector('.pdm-root--fechando'), null);
    await m.desmontar();
  } finally {
    window.matchMedia = original;
  }
});

test('foto do modal só aparece quando carregada (sem flash do fundo) e sem imagem mostra o bloco neutro', async () => {
  const m = await montar(ui.modal({ product: completo, onClose: () => {}, onAddToCart: () => {} }));
  const img = dialogo().querySelector('.pdm-image');
  assert.equal(img.getAttribute('decoding'), 'async', 'não trava a pintura do modal esperando a foto');
  assert.equal(img.classList.contains('pdm-image--pronta'), false, 'ainda não carregada');
  await ui.act(async () => { img.dispatchEvent(new Event('load')); });
  assert.equal(img.classList.contains('pdm-image--pronta'), true);
  await m.desmontar();

  const semFoto = await montar(ui.modal({ product: minimo, onClose: () => {}, onAddToCart: () => {} }));
  assert.equal(dialogo().querySelector('img'), null);
  assert.ok(dialogo().querySelector('.pdm-image--vazia'));
  await semFoto.desmontar();
});

test('preço do modal acompanha a quantidade selecionada (total, promoção e unitário)', async () => {
  const produto = { ...completo, price: 15.9, originalPrice: 18.9, disponibilidade: 5 };
  const m = await montar(ui.modal({ product: produto, onClose: () => {}, onAddToCart: () => {} }));
  const d = dialogo();
  const preco = () => texto(d.querySelector('.pdm-price-row .product-price'));
  const original = () => texto(d.querySelector('.pdm-price-row .product-price-original'));
  const unitario = () => d.querySelector('.pdm-price-row .product-price-unit');
  assert.equal(preco(), 'R$ 15,90');
  assert.equal(original(), 'R$ 18,90');
  assert.equal(unitario(), null, 'com 1 unidade não mostra "cada"');

  const [menos, mais] = d.querySelectorAll('.pdm-stepper-btn');
  await clicar(mais);
  await clicar(mais);
  assert.equal(preco(), 'R$ 47,70', '3 × 15,90 sem erro de ponto flutuante');
  assert.equal(original(), 'R$ 56,70');
  assert.equal(texto(unitario()), 'R$ 15,90 cada');
  // Na mesma linha do total (não cria linha nova que desloca o bottom sheet).
  assert.equal(unitario().parentElement, d.querySelector('.pdm-price-row .product-price').parentElement);

  await clicar(menos);
  assert.equal(preco(), 'R$ 31,80');
  await m.desmontar();
});

test('H: modal de produto sem descrição/peso/ingredientes/alérgenos não gera blocos vazios', async () => {
  const m = await montar(ui.modal({ product: minimo, onClose: () => {}, onAddToCart: () => {} }));
  const d = dialogo();
  assert.equal(d.querySelector('.pdm-description'), null);
  assert.equal(d.querySelectorAll('.pdm-section').length, 0);
  assert.equal(d.querySelector('.product-price-original'), null);
  assert.equal(d.querySelector('.product-promo-badge'), null);
  await m.desmontar();
});

test('I: produto esgotado não pode ser adicionado pelo modal', async () => {
  let chamadas = 0;
  const m = await montar(ui.modal({
    product: { ...completo, disponibilidade: 2 }, quantityInCart: 2,
    onClose: () => {}, onAddToCart: () => { chamadas++; },
  }));
  const d = dialogo();
  const [menos, mais] = d.querySelectorAll('.pdm-stepper-btn');
  const adicionar = d.querySelector('.pdm-add');
  assert.equal(menos.disabled, true);
  assert.equal(mais.disabled, true);
  assert.equal(adicionar.disabled, true);
  assert.equal(texto(adicionar), 'Esgotado');
  assert.equal(texto(d.querySelector('.product-esgotado-badge')), 'Esgotado');
  await clicar(adicionar);
  assert.equal(chamadas, 0);
  await m.desmontar();
});

test('C/D/E: com 3 na sacola e disponibilidade 5, o modal só permite +2 e o CartContext nunca excede', async () => {
  localStorage.clear();
  let cart;
  const m = await montar(ui.cartHarness(completo, (api) => { cart = api; }));

  // 3 já na sacola (uma única chamada com quantidade, não 3 chamadas).
  await ui.act(async () => { cart.addToCart(completo, 3); });
  await flush();
  assert.equal(cart.cartItems[0].quantity, 3);

  const d = dialogo();
  const valor = () => texto(d.querySelector('.pdm-stepper-value'));
  const [menos, mais] = d.querySelectorAll('.pdm-stepper-btn');
  assert.equal(valor(), '1');
  assert.equal(texto(d.querySelector('.product-low-stock-badge')), 'Poucas unidades', 'restante 2');
  for (let i = 0; i < 5; i++) await clicar(mais);
  assert.equal(valor(), '2', 'stepper para no restante (5 - 3)');
  assert.equal(mais.disabled, true);
  assert.equal(menos.disabled, false);

  await clicar(d.querySelector('.pdm-add'));
  await flush();
  assert.equal(cart.cartItems.length, 1);
  assert.equal(cart.cartItems[0].quantity, 5, 'quantidade entra de uma vez no carrinho');
  assert.equal(texto(d.querySelector('.pdm-add')), 'Esgotado', 'sem restante após adicionar');
  assert.equal(d.querySelector('.pdm-add').disabled, true);

  // E) pedido direto acima do disponível é limitado pelo CartContext.
  await ui.act(async () => { cart.addToCart(completo, 10); });
  assert.equal(cart.cartItems[0].quantity, 5);
  assert.equal(JSON.parse(localStorage.getItem('rp-doces:cart'))[0].quantity, 5, 'persistido no localStorage');
  await m.desmontar();
});

test('C/E: item novo com quantidade > disponibilidade entra limitado; + do card segue adicionando 1', async () => {
  localStorage.clear();
  let cart;
  const m = await montar(ui.cartHarness({ ...minimo, disponibilidade: 3 }, (api) => { cart = api; }));
  await ui.act(async () => { cart.addToCart({ ...minimo, disponibilidade: 3 }, 8); });
  assert.equal(cart.cartItems[0].quantity, 3);
  await ui.act(async () => { cart.addToCart({ ...minimo, id: 9, disponibilidade: 3 }); });
  assert.equal(cart.cartItems.find((i) => i.id === 9).quantity, 1, 'padrão continua +1');
  await ui.act(async () => { cart.addToCart({ ...minimo, id: 9, disponibilidade: 3 }, 0); });
  assert.equal(cart.cartItems.find((i) => i.id === 9).quantity, 1, 'quantidade inválida é ignorada');
  await m.desmontar();
});
