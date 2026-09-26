import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Rotas /dev/* (preview das telas de loading) só existem em desenvolvimento:
// com import.meta.env.DEV = true renderizam a página; com DEV = false (build de
// produção) a rota simplesmente não é registrada. O App é compilado duas vezes
// com `define`, exatamente o que o Vite faz em `dev` e em `build`.

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://local.test/',
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
  'PointerEvent', 'MutationObserver', 'getComputedStyle', 'localStorage', 'history', 'location',
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
const raf = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = raf;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
dom.window.matchMedia = (query) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  dispatchEvent: () => false,
});
globalThis.matchMedia = dom.window.matchMedia;
dom.window.scrollTo = () => {};
globalThis.scrollTo = dom.window.scrollTo;

async function compilarApp(dev) {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import React, { act } from 'react';
        import { createRoot } from 'react-dom/client';
        import App from './src/App';
        export { act };
        export function mount(container) {
          const root = createRoot(container);
          root.render(<App />);
          return root;
        }
      `,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: {
      // React fica em modo dev nos dois (act() não existe no build de produção do
      // React); o que muda entre os ambientes são só as flags do Vite abaixo.
      'process.env.NODE_ENV': '"development"',
      'import.meta.env.DEV': String(dev),
      'import.meta.env.PROD': String(!dev),
    },
    loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
  });
  const source = `${bundle.outputFiles[0].text}\n//# sourceURL=app-${dev ? 'dev' : 'prod'}.mjs`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const PREVIEWS = [
  ['/dev/preparando-pedido', '.preparando-screen'],
  ['/dev/gerando-pagamento', '.gerando-page'],
  ['/dev/processando-pagamento', '.processando-screen'],
];

async function renderizarRota(ui, path) {
  dom.window.history.pushState({}, '', path);
  const container = document.getElementById('root');
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  // Rotas são lazy: dá tempo do import dinâmico e do Suspense resolverem.
  for (let i = 0; i < 6; i++) {
    await ui.act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  }
  return {
    container,
    async desmontar() {
      await ui.act(async () => root.unmount());
      container.innerHTML = '';
    },
  };
}

test('desenvolvimento: as rotas /dev/* renderizam as telas de preview', async () => {
  const ui = await compilarApp(true);
  for (const [path, seletor] of PREVIEWS) {
    const r = await renderizarRota(ui, path);
    assert.ok(r.container.querySelector(seletor) !== null, `${path} deve renderizar ${seletor} em desenvolvimento`);
    await r.desmontar();
  }
});

test('produção: as rotas /dev/* não são registradas e não renderizam as telas', async () => {
  const ui = await compilarApp(false);
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => { avisos.push(args.join(' ')); };
  try {
    for (const [path, seletor] of PREVIEWS) {
      const r = await renderizarRota(ui, path);
      assert.ok(r.container.querySelector(seletor) === null, `${path} não deve renderizar ${seletor} em produção`);
      // O App em si montou (fundo do storefront), só a rota não existe.
      assert.ok(r.container.querySelector('.store-background') !== null, 'App montou normalmente');
      await r.desmontar();
    }
  } finally {
    console.warn = original;
  }
  assert.ok(avisos.some((a) => a.includes('No routes matched location "/dev/')),
    'React Router não encontrou rota para /dev/* em produção');
});

test('produção: rotas reais do fluxo continuam registradas (não é o App inteiro que sumiu)', async (t) => {
  // A Home carrega configuração da loja; nada de rede real neste teste.
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const ui = await compilarApp(false);
  // Sem estado de navegação, a rota real /pagamento-nao-aprovado redireciona
  // para "/". Só uma rota registrada executa esse redirecionamento.
  dom.window.history.pushState({}, '', '/pagamento-nao-aprovado');
  const container = document.getElementById('root');
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  for (let i = 0; i < 6; i++) {
    await ui.act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  }
  assert.equal(dom.window.location.pathname, '/', 'rota real registrada: redirecionou para a Home');
  assert.ok(container.querySelector('.store-background') !== null);
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
});

// ── Console limpo: rotas válidas não avisam, rota inexistente avisa, ondas sem d="undefined" ──
// A loja e o admin são duas árvores <Routes> montadas em TODA URL. Antes, cada
// uma avisava "No routes matched" nas rotas da outra, em toda página válida.
// E as ondas (motion.path com d animado) gravavam d="undefined" no primeiro
// render, o que o navegador reporta como erro de SVG.
async function renderizarComConsole(t, path) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const avisos = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { avisos.push(args.join(' ')); };
  const dValoresInvalidos = [];
  const setAttributeOriginal = dom.window.Element.prototype.setAttribute;
  dom.window.Element.prototype.setAttribute = function (name, value) {
    if (name === 'd' && (value === undefined || String(value) === 'undefined')) dValoresInvalidos.push(this.getAttribute('class'));
    return setAttributeOriginal.call(this, name, value);
  };
  try {
    const ui = await compilarApp(true);
    const r = await renderizarRota(ui, path);
    const ondas = [...r.container.querySelectorAll('svg path[class^="wave"]')].map((p) => p.getAttribute('d') ?? '');
    await r.desmontar();
    return { avisos, dValoresInvalidos, ondas };
  } finally {
    console.warn = originalWarn;
    dom.window.Element.prototype.setAttribute = setAttributeOriginal;
  }
}

const semRotaCasada = (avisos) => avisos.filter((a) => a.includes('No routes matched location'));

for (const path of ['/', '/cardapio', '/admin/login']) {
  test(`console limpo em ${path}: sem "No routes matched" e sem d="undefined" nas ondas`, async (t) => {
    const { avisos, dValoresInvalidos, ondas } = await renderizarComConsole(t, path);
    assert.deepEqual(semRotaCasada(avisos), [], `${path} é uma rota válida e não deve avisar`);
    assert.deepEqual(dValoresInvalidos, [], 'nenhuma onda pode receber d="undefined"');
    assert.ok(ondas.length >= 2, 'as ondas foram renderizadas');
    assert.ok(ondas.every((d) => d.startsWith('M')), 'todas as ondas têm um caminho SVG válido');
  });
}

for (const path of ['/nao-existe', '/admin/nao-existe']) {
  test(`rota realmente inexistente continua avisando: ${path}`, async (t) => {
    const { avisos } = await renderizarComConsole(t, path);
    const avisosDaRota = semRotaCasada(avisos).filter((a) => a.includes(`"${path}"`));
    assert.equal(avisosDaRota.length, 1, 'exatamente um aviso (nada foi suprimido nem duplicado)');
  });
}

// A onda da tela de login é a MESMA do header (componente StorefrontWave
// compartilhado): mesmo wrapper, mesmo SVG e mesmos paths, sem a antiga AdminWave.
test('/admin/login usa a mesma onda do header (/cardapio), sem a antiga .admin-wave', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const ui = await compilarApp(true);
  const assinatura = async (path) => {
    const r = await renderizarRota(ui, path);
    const wrapper = r.container.querySelectorAll('.storefront-frame__wave');
    const svg = wrapper[0]?.querySelector('svg');
    const sig = {
      wrappers: wrapper.length,
      ariaHidden: wrapper[0]?.getAttribute('aria-hidden'),
      viewBox: svg?.getAttribute('viewBox'),
      preserveAspectRatio: svg?.getAttribute('preserveAspectRatio'),
      paths: [...(wrapper[0]?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('class')),
      ondaAntiga: r.container.querySelectorAll('.admin-wave').length,
    };
    await r.desmontar();
    return sig;
  };
  const header = await assinatura('/cardapio');
  const login = await assinatura('/admin/login');
  assert.equal(header.wrappers, 1);
  assert.deepEqual(login, header, 'a onda do login tem exatamente a estrutura da onda do header');
  assert.equal(login.ondaAntiga, 0);
  assert.deepEqual(login.paths, ['wave-secondary', 'wave-primary']);
});
