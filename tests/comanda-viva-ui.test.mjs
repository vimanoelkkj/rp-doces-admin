import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin/pedidos',
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of [
  'window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'getComputedStyle',
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
      import PedidoDetalheModal from './src/admin/Pedidos/PedidoDetalheModal';
      export {act} from 'react';
      export function mount(container, callbacks = {}) {
        const root = createRoot(container);
        root.render(<PedidoDetalheModal orderId={1} onClose={() => {}}
          onStatusChanged={callbacks.onStatusChanged} />);
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

const produto = (overrides = {}) => ({
  id: 2,
  nome: 'Produto C',
  categoria: 'bolo',
  descricao: '',
  preco_centavos: 1200,
  disponivel: 1,
  ativo: 1,
  destaque: 0,
  promocao_ativa: 0,
  preco_promocional_centavos: null,
  promocao_inicio: null,
  promocao_fim: null,
  estoque: 10,
  estoque_reservado: 0,
  emoji: '🍰',
  image_key: null,
  ...overrides,
});

const detalhe = (overrides = {}) => {
  const total = overrides.total ?? 3000;
  const pago = overrides.pago ?? 3000;
  const status = overrides.status ?? (pago >= total ? 'PAGO' : pago > 0 ? 'PARCIAL' : 'PENDENTE');
  return {
    pedido: {
      id: 1,
      cliente_nome: 'Balcao',
      cliente_whatsapp: '11999999999',
      observacao: '',
      valor_total_centavos: total,
      status_pagamento: status,
      status_pedido: overrides.statusPedido ?? 'NOVO',
      status_comanda: overrides.statusComanda ?? 'ABERTA',
      origem_pedido: overrides.origem ?? 'MANUAL',
      criado_em: '2026-01-01 12:00:00',
      pago_em: pago ? '2026-01-01 12:01:00' : null,
    },
    itens: overrides.itens ?? [{
      id: 1, produto_id: 1, produto_nome: 'Bolo', emoji: '🎂', quantidade: 2,
      valor_unitario_centavos: 1500, valor_total_centavos: 3000,
      status_item: 'ATIVO', estoque_estado: 'BAIXADO',
    }],
    financeiro: {
      status,
      brutoPagoCentavos: pago,
      reembolsadoCentavos: overrides.reembolsado ?? 0,
      liquidoCentavos: pago - (overrides.reembolsado ?? 0),
      saldoCentavos: Math.max(0, total - pago + (overrides.reembolsado ?? 0)),
      pagoCentavos: pago - (overrides.reembolsado ?? 0),
      totalCentavos: total,
      metodosConfirmados: pago ? ['PIX_MP'] : [],
    },
    capacidadeCobravelCentavos: overrides.capacidade ?? Math.max(0, total - pago),
    pixAdminPendentes: overrides.pix ?? [],
    operacoesInconclusivas: [],
  };
};

async function mountWith(t, handler, callbacks = {}) {
  t.mock.method(globalThis, 'fetch', handler);
  let root;
  await ui.act(async () => { root = ui.mount(container, callbacks); });
  await flush();
  return root;
}

async function unmount(root) {
  await ui.act(async () => root.unmount());
  container.innerHTML = '';
}

function changeValue(element, value) {
  const prototype = element.tagName === 'SELECT'
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
}

test('botao de adicionar aparece somente para MANUAL, ABERTA e NOVO/PREPARANDO', async t => {
  const casos = [
    [{}, true],
    [{statusPedido: 'PREPARANDO'}, true],
    [{origem: 'SITE'}, false],
    [{statusComanda: 'ENCERRADA'}, false],
    [{statusPedido: 'PRONTO'}, false],
    [{statusPedido: 'ENTREGUE'}, false],
    [{statusPedido: 'CANCELADO'}, false],
  ];
  let atual = detalhe();
  t.mock.method(globalThis, 'fetch', async () => Response.json(atual));
  for (const [config, visivel] of casos) {
    atual = detalhe(config);
    let root;
    await ui.act(async () => { root = ui.mount(container); });
    await flush();
    assert.equal(Boolean(document.querySelector('.pedmodal-btn-add-item')), visivel, JSON.stringify(config));
    await unmount(root);
  }
});

test('modal lista produtos, calcula subtotal e sucesso atualiza item, total, saldo e Pix', async t => {
  let atual = detalhe();
  let addCalls = 0;
  let listRefreshes = 0;
  let resolver;
  const pendente = new Promise(resolve => { resolver = resolve; });
  const bodies = [];
  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (href === '/api/admin/produtos') return Response.json({produtos: [produto()]});
    if (href.endsWith('/itens') && options.method === 'POST') {
      addCalls += 1;
      bodies.push(JSON.parse(options.body));
      await pendente;
      atual = detalhe({
        total: 4200, pago: 3000, status: 'PARCIAL', capacidade: 1200,
        itens: [...detalhe().itens, {
          id: 2, produto_id: 2, produto_nome: 'Produto C', emoji: '🍰', quantidade: 1,
          valor_unitario_centavos: 1200, valor_total_centavos: 1200,
          status_item: 'ATIVO', estoque_estado: 'RESERVADO',
        }],
      });
      return Response.json({ok: true}, {status: 201});
    }
    return Response.json(atual);
  }, {onStatusChanged: () => { listRefreshes += 1; }});
  try {
    await ui.act(async () => document.querySelector('.pedmodal-btn-add-item').click());
    await flush();
    const select = document.querySelector('.additem-field select');
    assert.match(select.textContent, /Produto C/);
    await ui.act(async () => changeValue(select, '2'));
    const quantity = document.querySelector('.additem-field input');
    await ui.act(async () => changeValue(quantity, '2'));
    assert.match(document.querySelector('.additem-subtotal').textContent, /24,00/);
    await ui.act(async () => changeValue(quantity, '1'));

    const confirm = document.querySelector('.additem-confirm');
    await ui.act(async () => { confirm.click(); confirm.click(); });
    assert.equal(addCalls, 1, 'guarda sincrona impede duplo envio');
    assert.equal(confirm.disabled, true);
    await ui.act(async () => { resolver(); await pendente; });
    await flush();

    assert.equal(document.querySelector('.additem-card'), null);
    assert.match(document.querySelector('.pedmodal-items').textContent, /Produto C/);
    assert.match(document.querySelector('.pedmodal-total-value').textContent, /42,00/);
    assert.match(document.querySelector('.pedmodal-financial-row--balance').textContent, /12,00/);
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Parcial/);
    assert.ok([...document.querySelectorAll('.pedmodal-btn-advance')]
      .some(button => button.textContent === 'Gerar Pix R$ 12,00'));
    assert.equal(bodies[0].produtoId, 2);
    assert.equal(bodies[0].quantidade, 1);
    assert.equal(bodies[0].precoEsperadoCentavos, 1200);
    assert.equal(typeof bodies[0].operationKey, 'string');
    assert.equal(listRefreshes, 1, 'a listagem pai recebe uma unica revalidacao');
  } finally {
    await unmount(root);
  }
});

test('retry conserva key; PRECO_ALTERADO exige confirmacao e cria key nova', async t => {
  let posts = 0;
  const bodies = [];
  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (href === '/api/admin/produtos') return Response.json({produtos: [produto()]});
    if (href.endsWith('/itens') && options.method === 'POST') {
      posts += 1;
      bodies.push(JSON.parse(options.body));
      if (posts === 1) return Response.json({error: 'Falha de rede simulada'}, {status: 500});
      if (posts === 2) return Response.json({
        error: 'O preco mudou', code: 'PRECO_ALTERADO', precoAtualCentavos: 1300,
      }, {status: 409});
      return Response.json({ok: true}, {status: 201});
    }
    return Response.json(detalhe({total: posts >= 3 ? 4300 : 3000, pago: 3000,
      status: posts >= 3 ? 'PARCIAL' : 'PAGO', capacidade: posts >= 3 ? 1300 : 0}));
  });
  try {
    await ui.act(async () => document.querySelector('.pedmodal-btn-add-item').click());
    await flush();
    await ui.act(async () => changeValue(document.querySelector('.additem-field select'), '2'));
    const submit = document.querySelector('.additem-confirm');
    await ui.act(async () => submit.click());
    await flush();
    assert.match(document.querySelector('.additem-error').textContent, /Falha de rede/);

    await ui.act(async () => submit.click());
    await flush();
    assert.equal(bodies[0].operationKey, bodies[1].operationKey, 'retry da mesma intencao reutiliza key');
    assert.equal(posts, 2, 'mudanca de preco nao confirma automaticamente');
    const priceChange = document.querySelector('.additem-price-change');
    assert.match(priceChange.textContent, /12,00/);
    assert.match(priceChange.textContent, /13,00/);

    await ui.act(async () => priceChange.querySelector('button').click());
    await flush();
    assert.equal(posts, 3);
    assert.notEqual(bodies[2].operationKey, bodies[1].operationKey);
    assert.equal(bodies[2].precoEsperadoCentavos, 1300);
  } finally {
    await unmount(root);
  }
});

test('estoque insuficiente permanece no modal sem aparentar sucesso', async t => {
  const root = await mountWith(t, async (url, options = {}) => {
    if (String(url) === '/api/admin/produtos') return Response.json({produtos: [produto()]});
    if (options.method === 'POST') return Response.json({
      error: 'Estoque insuficiente para Produto C', code: 'ESTOQUE_INSUFICIENTE',
    }, {status: 409});
    return Response.json(detalhe());
  });
  try {
    await ui.act(async () => document.querySelector('.pedmodal-btn-add-item').click());
    await flush();
    await ui.act(async () => changeValue(document.querySelector('.additem-field select'), '2'));
    await ui.act(async () => document.querySelector('.additem-confirm').click());
    await flush();
    assert.ok(document.querySelector('.additem-card'));
    assert.match(document.querySelector('.additem-error').textContent, /Estoque insuficiente/);
    assert.equal(document.querySelectorAll('.pedmodal-item-row').length, 1);
  } finally {
    await unmount(root);
  }
});

test('Pix usa capacidade do backend, mostra QR e polling espaçado converge para PAGO', async t => {
  let atual = detalhe({total: 4200, pago: 3000, status: 'PARCIAL', capacidade: 1200});
  let pixBody;
  let pollCallback;
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    if (delay === 5000) pollCallback = callback;
    return 123;
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const root = await mountWith(t, async (url, options = {}) => {
    if (options.method === 'POST' && String(url).endsWith('/pix')) {
      pixBody = JSON.parse(options.body);
      atual = detalhe({
        total: 4200, pago: 3000, status: 'PARCIAL', capacidade: 0,
        pix: [{
          id: 2, valorCentavos: 1200, qrCode: 'pix-copia-e-cola',
          qrCodeBase64: 'cXI=', ticketUrl: null, expiresAt: '2099-01-01T00:00:00Z',
        }],
      });
      return Response.json({ok: true}, {status: 201});
    }
    return Response.json(atual);
  });
  try {
    const button = [...document.querySelectorAll('button')]
      .find(item => item.textContent === 'Gerar Pix R$ 12,00');
    await ui.act(async () => button.click());
    await flush();
    assert.equal(pixBody.valorCentavos, 1200);
    assert.equal(typeof pixBody.operationKey, 'string');
    assert.equal(
      [...document.querySelectorAll('.pedmodal-btn-advance')]
        .find(item => item.textContent.startsWith('Gerar Pix')),
      undefined,
      'capacidade zero oculta nova cobranca',
    );
    assert.equal(document.querySelector('.pedmodal-pix-code-box').textContent, 'pix-copia-e-cola');
    assert.equal(document.querySelector('.pedmodal-pix-qr img').getAttribute('src'), 'data:image/png;base64,cXI=');
    assert.equal(typeof pollCallback, 'function');

    atual = detalhe({total: 4200, pago: 4200, status: 'PAGO', capacidade: 0});
    await ui.act(async () => { await pollCallback(); });
    await flush();
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Pago/);
    assert.match(document.querySelector('.pedmodal-financial-row--balance').textContent, /0,00/);
    assert.equal(document.querySelector('.pedmodal-pix-card'), null);
  } finally {
    await unmount(root);
  }
});

test('drawer de adicao preserva controles utilizaveis no mobile', async () => {
  const css = await readFile('src/admin/Pedidos/AdicionarItemModal.css', 'utf8');
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.additem-card\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.additem-confirm[^}]*width:\s*100%/s);
  assert.match(css, /max-height:\s*92dvh/);
});

test('preview de cancelamento mostra cobertura por pagamento, estoque e nenhuma confirmação', async t => {
  const root = await mountWith(t, async url => {
    if (String(url).endsWith('/cancelamento-preview')) {
      return Response.json({
        pedidoId: 1,
        item: {
          id: 1, nome: 'Bolo', quantidade: 2, valorCentavos: 3000,
          statusItem: 'ATIVO', estoqueEstado: 'BAIXADO',
        },
        financeiro: {
          valorItemCentavos: 3000,
          coberturaConfirmadaCentavos: 1500,
          valorNaoPagoCentavos: 1500,
          reembolsoNecessarioCentavos: 1500,
        },
        pagamentos: [
          {
            pagamentoId: 7, pagamentoAlocacaoId: 11, metodo: 'PIX_MP',
            valorAlocadoCentavos: 500,
            valorJaReembolsadoDaAlocacaoCentavos: 0,
            coberturaEfetivaCentavos: 500,
            reembolsoPropostoCentavos: 500,
          },
          {
            pagamentoId: 8, pagamentoAlocacaoId: 12, metodo: 'DINHEIRO',
            valorAlocadoCentavos: 1000,
            valorJaReembolsadoDaAlocacaoCentavos: 0,
            coberturaEfetivaCentavos: 1000,
            reembolsoPropostoCentavos: 1000,
          },
        ],
        estoque: {estadoAtual: 'BAIXADO', acaoPadrao: 'NAO_REPOR'},
        bloqueios: [],
        cancelamentoExecutavel: true,
      });
    }
    return Response.json(detalhe());
  });
  try {
    await ui.act(async () => document.querySelector('.pedmodal-btn-cancel-item').click());
    await flush();
    const modal = document.querySelector('.cancelpreview-card');
    assert.ok(modal);
    assert.match(modal.textContent, /Valor já pago associado/);
    assert.match(modal.textContent, /Valor ainda não pago/);
    assert.match(modal.textContent, /Pix Mercado Pago/);
    assert.match(modal.textContent, /R\$\s*5,00 a estornar/);
    assert.match(modal.textContent, /Dinheiro/);
    assert.match(modal.textContent, /R\$\s*10,00 a devolver/);
    assert.match(modal.textContent, /não irá repor estoque automaticamente/i);
    assert.match(modal.textContent, /Cancelamento ainda não disponível nesta etapa/i);
    assert.equal([...modal.querySelectorAll('button')].some(b => /confirmar cancelamento/i.test(b.textContent)), false);
  } finally {
    await unmount(root);
  }
});

test('preview exibe bloqueio de Pix e ação só aparece em item ativo de pedido aberto não terminal', async t => {
  let atual = detalhe();
  const root = await mountWith(t, async url => {
    if (String(url).endsWith('/cancelamento-preview')) {
      return Response.json({
        pedidoId: 1,
        item: {id: 1, nome: 'Bolo', quantidade: 2, valorCentavos: 3000, statusItem: 'ATIVO', estoqueEstado: 'RESERVADO'},
        financeiro: {valorItemCentavos: 3000, coberturaConfirmadaCentavos: 0, valorNaoPagoCentavos: 3000, reembolsoNecessarioCentavos: 0},
        pagamentos: [],
        estoque: {estadoAtual: 'RESERVADO', acaoPadrao: 'LIBERAR_RESERVA'},
        bloqueios: [{codigo: 'PIX_PENDENTE', mensagem: 'Há uma cobrança Pix pendente para esta comanda. O cancelamento só poderá ser executado após ela ser resolvida.'}],
        cancelamentoExecutavel: false,
      });
    }
    return Response.json(atual);
  });
  try {
    await ui.act(async () => document.querySelector('.pedmodal-btn-cancel-item').click());
    await flush();
    assert.match(document.querySelector('.cancelpreview-block').textContent, /cobrança Pix pendente/i);
    assert.match(document.querySelector('.cancelpreview-stock').textContent, /reserva de 2 unidades será liberada/i);
    await ui.act(async () => document.querySelector('.cancelpreview-close').click());

    atual = detalhe({statusComanda: 'ENCERRADA'});
    await ui.act(async () => root.unmount());
    container.innerHTML = '';
    let second;
    await ui.act(async () => { second = ui.mount(container); });
    await flush();
    assert.equal(document.querySelector('.pedmodal-btn-cancel-item'), null);
    await unmount(second);
    return;
  } finally {
    if (container.innerHTML) {
      container.innerHTML = '';
    }
  }
});

test('drawer de preview permanece utilizável no mobile', async () => {
  const css = await readFile('src/admin/Pedidos/CancelamentoItemPreviewModal.css', 'utf8');
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.cancelpreview-card\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /max-height:\s*92dvh/);
  assert.match(css, /\.cancelpreview-footer button\s*\{[^}]*width:\s*100%/s);
});
