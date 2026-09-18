import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// UI da seção "Diagnósticos permanentes" (Admin > Loja): loading, sucesso,
// erro e a guarda contra duplo-clique dos dois botões.

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin/loja',
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
      import {NotificacoesProvider} from './src/admin/notificacoes/NotificacoesContext';
      import AdminLoja from './src/admin/Loja/AdminLoja';
      export {act} from 'react';

      export function mount(container) {
        const root = createRoot(container);
        root.render(
          <NotificacoesProvider>
            <AdminLoja />
          </NotificacoesProvider>
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

function diagCard(titulo) {
  return [...document.querySelectorAll('.loj-diag-card')]
    .find(card => card.querySelector('.loj-diag-card-title').textContent.trim() === titulo);
}

async function montar(t, {pix, teste, status, refund} = {}) {
  let pixChamadas = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/admin/notificacoes')) {
      return Response.json({notificacoes: [], naoLidas: 0});
    }
    if (href.includes('/api/admin/diagnosticos/pix-status')) {
      if (typeof status === 'function') return status(href, options);
      return Response.json({ok: true, status: 'PENDENTE'});
    }
    if (href.endsWith('/api/admin/diagnosticos/pix-reembolso')) {
      if (typeof refund === 'function') return refund(options);
      return Response.json({ok: true, refundId: '9001', status: 'approved'}, {status: 201});
    }
    if (href.endsWith('/api/admin/diagnosticos/pix')) {
      pixChamadas++;
      if (typeof pix === 'function') return pix(options);
      return Response.json({
        ok: true, valorCentavos: 1, mpPaymentId: '555',
        qrCode: '000201-copia-e-cola', qrCodeBase64: 'YmFzZTY0', ticketUrl: null,
        expiresAt: '2099-01-01T00:10:00Z',
      }, {status: 201});
    }
    if (href.endsWith('/api/admin/diagnosticos/pedido-teste')) {
      if (typeof teste === 'function') return teste(options);
      return Response.json({ok: true}, {status: 201});
    }
    throw new Error(`fetch inesperado: ${href}`);
  });

  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  return {root, contarChamadasPix: () => pixChamadas};
}

async function desmontar(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
}

test('Pix de diagnóstico: loading, sucesso e código copia-e-cola', async t => {
  let resolver;
  const pendente = new Promise(resolve => { resolver = resolve; });
  const {root} = await montar(t, {
    pix: async () => {
      await pendente;
      return Response.json({
        ok: true, valorCentavos: 1, mpPaymentId: '555', qrCode: '000201-copia-e-cola',
        qrCodeBase64: 'YmFzZTY0', ticketUrl: null, expiresAt: '2099-01-01T00:10:00Z',
      }, {status: 201});
    },
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    const botao = card.querySelector('.loj-diag-action');

    const clique = ui.act(async () => { botao.click(); await Promise.resolve(); });
    await clique;
    assert.equal(botao.textContent, 'Gerando...', 'botão mostra estado de carregamento antes da resposta do MP');
    assert.equal(botao.disabled, true);

    await ui.act(async () => { resolver(); await pendente.then(() => new Promise(setImmediate)); });
    await flush();

    assert.equal(botao.textContent, 'Gerar QR Code Pix');
    assert.equal(botao.disabled, false);
    assert.match(card.querySelector('.loj-diag-pix-valor').textContent, /0,01/);
    assert.equal(card.querySelector('.loj-diag-pix-qr').getAttribute('src'), 'data:image/png;base64,YmFzZTY0');
    assert.equal(card.querySelector('.loj-diag-pix-code-box code').textContent, '000201-copia-e-cola');
    assert.equal(card.querySelector('.loj-diag-error'), null);
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: clique duplo dispara apenas uma requisição', async t => {
  let resolver;
  const pendente = new Promise(resolve => { resolver = resolve; });
  const {root, contarChamadasPix} = await montar(t, {
    pix: async () => { await pendente; return Response.json({ok: true, valorCentavos: 1, mpPaymentId: '1', qrCode: null, qrCodeBase64: null, ticketUrl: null, expiresAt: null}, {status: 201}); },
  });
  try {
    const botao = diagCard('Pix real de diagnóstico').querySelector('.loj-diag-action');

    await ui.act(async () => { botao.click(); botao.click(); botao.click(); });
    assert.equal(contarChamadasPix(), 1, 'a guarda síncrona de loading impede envios duplicados');

    await ui.act(async () => { resolver(); await pendente.then(() => new Promise(setImmediate)); });
    await flush();
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: erro do Mercado Pago aparece dentro do card, nunca finge sucesso', async t => {
  const {root} = await montar(t, {
    pix: async () => Response.json({error: 'O Mercado Pago recusou o Pix de diagnóstico', code: 'MERCADO_PAGO_RECUSOU'}, {status: 502}),
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    const botao = card.querySelector('.loj-diag-action');

    await ui.act(async () => botao.click());
    await flush();

    assert.match(card.querySelector('.loj-diag-error').textContent, /recusou/);
    assert.equal(card.querySelector('.loj-diag-pix-result'), null, 'nenhum resultado fictício é mostrado');
    assert.equal(botao.disabled, false);
  } finally {
    await desmontar(root);
  }
});

test('Pedido de teste: loading, sucesso e não navega para pedido nenhum', async t => {
  let resolver;
  const pendente = new Promise(resolve => { resolver = resolve; });
  const {root} = await montar(t, {
    teste: async () => { await pendente; return Response.json({ok: true}, {status: 201}); },
  });
  try {
    const card = diagCard('Pedido de produto de teste');
    const botao = card.querySelector('.loj-diag-action');

    const clique = ui.act(async () => { botao.click(); await Promise.resolve(); });
    await clique;
    assert.equal(botao.textContent, 'Enviando...');

    await ui.act(async () => { resolver(); await pendente.then(() => new Promise(setImmediate)); });
    await flush();

    assert.equal(botao.textContent, 'Disparar pedido teste');
    assert.match(card.querySelector('.loj-diag-success').textContent, /registrado/);
  } finally {
    await desmontar(root);
  }
});

test('Pedido de teste: erro aparece no card sem quebrar o botão', async t => {
  const {root} = await montar(t, {
    teste: async () => Response.json({error: 'Erro interno ao disparar o diagnóstico'}, {status: 500}),
  });
  try {
    const card = diagCard('Pedido de produto de teste');
    const botao = card.querySelector('.loj-diag-action');

    await ui.act(async () => botao.click());
    await flush();

    assert.match(card.querySelector('.loj-diag-error').textContent, /Erro interno/);
    assert.equal(botao.disabled, false);
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: verificar pagamento mostra confirmação visual de "Pago" e libera o reembolso de teste', async t => {
  const {root} = await montar(t, {
    status: async () => Response.json({ok: true, status: 'PAGO'}),
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    await ui.act(async () => card.querySelector('.loj-diag-action').click());
    await flush();

    const verificar = card.querySelector('.loj-diag-pix-status-row .loj-diag-pix-copy-btn');
    assert.equal(verificar.textContent, 'Verificar pagamento');
    assert.equal(card.querySelector('.loj-diag-pix-status'), null, 'sem status antes de verificar');

    await ui.act(async () => verificar.click());
    await flush();

    const status = card.querySelector('.loj-diag-pix-status');
    assert.ok(status, 'confirmação visual do pagamento aparece após verificar');
    assert.match(status.textContent, /Pago/);
    assert.ok(status.className.includes('loj-diag-pix-status--pago'));

    const reembolso = card.querySelector('.loj-diag-pix-refund .loj-diag-pix-copy-btn');
    assert.ok(reembolso, 'botão de testar reembolso só aparece depois de confirmado o pagamento');
    assert.equal(reembolso.textContent, 'Testar reembolso');
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: enquanto pendente, não mostra opção de reembolso', async t => {
  const {root} = await montar(t, {
    status: async () => Response.json({ok: true, status: 'PENDENTE'}),
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    await ui.act(async () => card.querySelector('.loj-diag-action').click());
    await flush();
    await ui.act(async () => card.querySelector('.loj-diag-pix-status-row .loj-diag-pix-copy-btn').click());
    await flush();

    assert.match(card.querySelector('.loj-diag-pix-status').textContent, /Aguardando pagamento/);
    assert.equal(card.querySelector('.loj-diag-pix-refund'), null);
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: testar reembolso confirma o estorno e trava o botão', async t => {
  const {root} = await montar(t, {
    status: async () => Response.json({ok: true, status: 'PAGO'}),
    refund: async () => Response.json({ok: true, refundId: '9001', status: 'approved'}, {status: 201}),
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    await ui.act(async () => card.querySelector('.loj-diag-action').click());
    await flush();
    await ui.act(async () => card.querySelector('.loj-diag-pix-status-row .loj-diag-pix-copy-btn').click());
    await flush();

    const reembolsoBtn = card.querySelector('.loj-diag-pix-refund .loj-diag-pix-copy-btn');
    await ui.act(async () => reembolsoBtn.click());
    await flush();

    assert.equal(reembolsoBtn.textContent, 'Estornado');
    assert.equal(reembolsoBtn.disabled, true);
    assert.match(card.querySelector('.loj-diag-pix-refund .loj-diag-success').textContent, /9001/);
  } finally {
    await desmontar(root);
  }
});

test('Pix de diagnóstico: erro no estorno aparece no card, nunca finge sucesso', async t => {
  const {root} = await montar(t, {
    status: async () => Response.json({ok: true, status: 'PAGO'}),
    refund: async () => Response.json({error: 'O Mercado Pago recusou o estorno de diagnóstico', code: 'MERCADO_PAGO_RECUSOU'}, {status: 502}),
  });
  try {
    const card = diagCard('Pix real de diagnóstico');
    await ui.act(async () => card.querySelector('.loj-diag-action').click());
    await flush();
    await ui.act(async () => card.querySelector('.loj-diag-pix-status-row .loj-diag-pix-copy-btn').click());
    await flush();

    const reembolsoBtn = card.querySelector('.loj-diag-pix-refund .loj-diag-pix-copy-btn');
    await ui.act(async () => reembolsoBtn.click());
    await flush();

    assert.equal(reembolsoBtn.textContent, 'Testar reembolso', 'não finge sucesso, permanece disponível para nova tentativa');
    assert.equal(reembolsoBtn.disabled, false);
    assert.match(card.querySelector('.loj-diag-pix-refund .loj-diag-error').textContent, /recusou/);
  } finally {
    await desmontar(root);
  }
});
