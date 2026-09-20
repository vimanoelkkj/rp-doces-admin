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
      cliente_nome: overrides.clienteNome ?? 'Balcao',
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

// O seletor de produto virou um dropdown customizado (não um <select>
// nativo) — abre o gatilho e clica na opção pelo texto visível.
async function escolherDropdown(gatilhoSeletor, textoOpcao) {
  await ui.act(async () => document.querySelector(gatilhoSeletor).click());
  await flush();
  const opcao = [...document.querySelectorAll('.additem-dropdown-option')]
    .find(button => button.textContent.includes(textoOpcao));
  await ui.act(async () => opcao.click());
  await flush();
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
    await ui.act(async () => document.querySelector('.additem-dropdown-trigger').click());
    await flush();
    assert.match(document.querySelector('.additem-dropdown-list').textContent, /Produto C/);
    await ui.act(async () => [...document.querySelectorAll('.additem-dropdown-option')]
      .find(button => button.textContent.includes('Produto C')).click());
    await flush();
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
    await escolherDropdown('.additem-dropdown-trigger', 'Produto C');
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
    await escolherDropdown('.additem-dropdown-trigger', 'Produto C');
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
        itens: [{...detalhe().itens[0], estoque_estado: 'RESERVADO'}],
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
    assert.match(document.querySelector('.pedmodal-item-row').textContent, /Estoque reservado/);
    assert.equal(typeof pollCallback, 'function');

    atual = detalhe({
      total: 4200, pago: 4200, status: 'PAGO', capacidade: 0,
      itens: [{...detalhe().itens[0], estoque_estado: 'BAIXADO'}],
    });
    await ui.act(async () => { await pollCallback(); });
    await flush();
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Pago/);
    assert.match(document.querySelector('.pedmodal-financial-row--balance').textContent, /0,00/);
    assert.match(document.querySelector('.pedmodal-item-row').textContent, /Estoque baixado/);
    assert.equal(document.querySelector('.pedmodal-pix-card'), null);
  } finally {
    await unmount(root);
  }
});

test('Pix da troca mais cara conclui troca, estoque e modal aberto no proximo polling', async t => {
  const itensTroca = (statusTroca, estoqueDestino) => [
    {
      ...detalhe().itens[0],
      id: 1,
      produto_nome: 'Origem',
      quantidade: 1,
      valor_unitario_centavos: 1000,
      valor_total_centavos: 1000,
      status_item: 'CANCELADO',
      estoque_estado: 'REPOSTO',
      cancelamento_id: null,
      cancelamento_status: null,
      troca_id: 22,
      troca_status: statusTroca,
      troca_item_origem_id: 1,
    },
    {
      ...detalhe().itens[0],
      id: 2,
      produto_nome: 'Destino',
      quantidade: 1,
      valor_unitario_centavos: 1500,
      valor_total_centavos: 1500,
      status_item: 'ATIVO',
      estoque_estado: estoqueDestino,
      cancelamento_id: null,
      cancelamento_status: null,
      troca_id: 22,
      troca_status: statusTroca,
      troca_item_origem_id: 1,
    },
  ];
  const troca = (status, estoqueDestino, pago) => ({
    id: 22,
    status,
    reembolsoPendenteCentavos: 0,
    refundsPendentes: [],
    estoqueOrigemEstado: 'REPOSTO',
    estoqueDestinoEstado: estoqueDestino,
    reembolsosConfirmados: [],
    financeiro: {
      status: pago === 1500 ? 'PARCIAL' : 'PAGO',
      totalCentavos: 2000,
      liquidoCentavos: pago,
      saldoCentavos: 2000 - pago,
    },
  });

  let atual = detalhe({
    total: 2000,
    pago: 1500,
    status: 'PARCIAL',
    capacidade: 500,
    itens: itensTroca('AGUARDANDO_COBRANCA', 'RESERVADO'),
  });
  let trocaAtual = troca('AGUARDANDO_COBRANCA', 'RESERVADO', 1500);
  let pollCallback;
  const clearedIntervals = [];
  let listRefreshes = 0;
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    if (delay === 5000) pollCallback = callback;
    return delay;
  });
  t.mock.method(globalThis, 'clearInterval', id => clearedIntervals.push(id));

  const root = await mountWith(t, async (url, options = {}) => {
    const href = String(url);
    if (options.method === 'POST' && href.endsWith('/pix')) {
      atual = detalhe({
        total: 2000,
        pago: 1500,
        status: 'PARCIAL',
        capacidade: 0,
        itens: itensTroca('AGUARDANDO_COBRANCA', 'RESERVADO'),
        pix: [{
          id: 8,
          valorCentavos: 500,
          qrCode: 'pix-diferenca',
          qrCodeBase64: null,
          ticketUrl: null,
          expiresAt: '2099-01-01T00:00:00Z',
        }],
      });
      return Response.json({ok: true}, {status: 201});
    }
    if (href.endsWith('/historico')) {
      return Response.json({eventos: [{
        id: 'troca-22',
        tipo: 'TROCA_SOLICITADA',
        data: '2026-01-01 12:00:00',
        titulo: 'Troca solicitada',
        status: trocaAtual.status,
        itemOrigem: {id: 1, nome: 'Origem', valorCentavos: 1000},
        itemDestino: {id: 2, nome: 'Destino', valorCentavos: 1500, estoqueEstado: trocaAtual.estoqueDestinoEstado},
        diferencaCentavos: 500,
        tipoDiferenca: 'COBRAR',
        estoqueAcao: 'REPOR',
        referenciaId: 1,
      }]});
    }
    if (href.endsWith('/itens/1/trocas')) {
      return Response.json({troca: trocaAtual});
    }
    return Response.json(atual);
  }, {onStatusChanged: () => { listRefreshes += 1; }});

  try {
    const gerarPix = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'Gerar Pix R$ 5,00');
    await ui.act(async () => gerarPix.click());
    await flush();
    assert.ok(document.querySelector('.pedmodal-pix-card'));
    assert.match(document.body.textContent, /Troca aguardando pagamento/);
    assert.match(document.body.textContent, /Ativo · Estoque reservado/);
    assert.equal(typeof pollCallback, 'function');

    await ui.act(async () => document.querySelector('.pedmodal-btn-historico').click());
    await flush();
    await ui.act(async () => document.querySelector('.histmodal-btn-detalhes').click());
    await flush();
    assert.match(document.querySelector('.additem-card').textContent, /AGUARDANDO COBRANCA/);

    atual = detalhe({
      total: 2000,
      pago: 2000,
      status: 'PAGO',
      capacidade: 0,
      itens: itensTroca('CONCLUIDA', 'BAIXADO'),
      pix: [],
    });
    trocaAtual = troca('CONCLUIDA', 'BAIXADO', 2000);
    await ui.act(async () => { await pollCallback(); });
    await flush();
    await flush();

    assert.equal(document.querySelector('.pedmodal-pix-card'), null);
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Pago/);
    assert.match(document.querySelector('.pedmodal-financial-grid').textContent, /PagoR\$ 20,00/);
    assert.match(document.querySelector('.pedmodal-financial-grid').textContent, /LíquidoR\$ 20,00/);
    assert.match(document.querySelector('.pedmodal-financial-row--balance').textContent, /0,00/);
    assert.match(document.querySelector('.pedmodal-item-row').textContent, /Ativo · Estoque baixado/);
    assert.doesNotMatch(document.querySelector('.pedmodal-payment').textContent, /Troca aguardando pagamento/);
    assert.match(document.querySelector('.additem-card').textContent, /CONCLUIDA/);
    assert.match(document.querySelector('.additem-card').textContent, /Troca concluída/);
    assert.match(document.querySelector('.additem-card').textContent, /Estoque origemREPOSTO/);
    assert.equal(listRefreshes, 1, 'a listagem pai recebe a convergencia financeira');
    assert.ok(clearedIntervals.includes(5000), 'polling para quando o Pix desaparece');
  } finally {
    await unmount(root);
  }
});

test('pedido PRONTO registra o saldo integral uma vez e atualiza detalhe e listagem', async t => {
  let atual = detalhe({total: 4000, pago: 0, statusPedido: 'PRONTO', capacidade: 4000});
  let posts = 0;
  let postBody;
  let liberarPost;
  const postPendente = new Promise(resolve => { liberarPost = resolve; });
  let listRefreshes = 0;
  const root = await mountWith(t, async (url, options = {}) => {
    if (options.method === 'POST' && String(url).endsWith('/pagamentos')) {
      posts += 1;
      postBody = JSON.parse(options.body);
      await postPendente;
      atual = detalhe({total: 4000, pago: 4000, statusPedido: 'PRONTO', capacidade: 0});
      return Response.json({ok: true, statusFinanceiro: 'PAGO', saldoCentavos: 0}, {status: 201});
    }
    return Response.json(atual);
  }, {onStatusChanged: () => { listRefreshes += 1; }});
  try {
    const open = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'Registrar pagamento');
    assert.ok(open, 'PRONTO com comanda aberta permite registrar pagamento');
    await ui.act(async () => open.click());
    await flush();

    const amount = document.querySelector('input[aria-label="Valor recebido"]');
    assert.equal(amount.value, '40,00');
    const method = document.querySelector('.pedmodal-manual-payment select');
    await ui.act(async () => changeValue(method, 'CARTAO'));

    const confirm = [...document.querySelectorAll('.pedmodal-manual-payment button')]
      .find(button => button.textContent === 'Confirmar pagamento');
    await ui.act(async () => { confirm.click(); confirm.click(); });
    assert.equal(posts, 1, 'duplo clique envia uma unica intencao');
    assert.equal(confirm.disabled, true);
    await ui.act(async () => { liberarPost(); await postPendente; });
    await flush();

    assert.equal(postBody.metodo, 'CARTAO');
    assert.equal(postBody.valorCentavos, 4000);
    assert.match(postBody.operationKey, /^[A-Za-z0-9._:-]{8,128}$/);
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Pago/);
    assert.match(document.querySelector('.pedmodal-financial-row--balance').textContent, /0,00/);
    assert.equal(
      [...document.querySelectorAll('button')]
        .some(button => /Registrar pagamento|não pago/i.test(button.textContent)),
      false,
      'pedido pago nao oferece reversao destrutiva',
    );
    assert.equal(listRefreshes, 1);
  } finally {
    await unmount(root);
  }
});

test('saldo em aberto permite registrar pagamento em NOVO, PREPARANDO, PRONTO e ENTREGUE', async t => {
  const casos = [
    ['NOVO', 'ABERTA', true],
    ['PREPARANDO', 'ABERTA', true],
    ['PRONTO', 'ABERTA', true],
    ['ENTREGUE', 'ENCERRADA', true],
    ['CANCELADO', 'ENCERRADA', false],
  ];
  let atual = detalhe({total: 4000, pago: 0, capacidade: 4000});
  t.mock.method(globalThis, 'fetch', async () => Response.json(atual));

  for (const [statusPedido, statusComanda, visivel] of casos) {
    atual = detalhe({
      total: 4000,
      pago: 0,
      capacidade: 4000,
      statusPedido,
      statusComanda,
    });
    let root;
    await ui.act(async () => { root = ui.mount(container); });
    await flush();
    const registrar = [...document.querySelectorAll('button')]
      .some(button => button.textContent === 'Registrar pagamento');
    assert.equal(registrar, visivel, statusPedido);
    if (statusPedido === 'ENTREGUE') {
      assert.equal(
        [...document.querySelectorAll('button')]
          .some(button => button.textContent.startsWith('Gerar Pix')),
        false,
        'pedido entregue aceita recebimento externo sem abrir nova cobranca MP',
      );
    }
    await unmount(root);
  }

  atual = detalhe({total: 4000, pago: 4000, status: 'PAGO', capacidade: 0});
  let root;
  await ui.act(async () => { root = ui.mount(container); });
  await flush();
  assert.equal(
    [...document.querySelectorAll('button')]
      .some(button => /Registrar pagamento|não pago/i.test(button.textContent)),
    false,
    'pedido pago nao oferece nova cobranca nem reversao destrutiva',
  );
  await unmount(root);
});

test('pagamento parcial preenche e registra somente o saldo restante', async t => {
  let postBody;
  let atual = detalhe({total: 4000, pago: 1500, status: 'PARCIAL', capacidade: 2500});
  const root = await mountWith(t, async (url, options = {}) => {
    if (options.method === 'POST' && String(url).endsWith('/pagamentos')) {
      postBody = JSON.parse(options.body);
      atual = detalhe({total: 4000, pago: 4000, status: 'PAGO', capacidade: 0});
      return Response.json({ok: true, statusFinanceiro: 'PAGO', saldoCentavos: 0}, {status: 201});
    }
    return Response.json(atual);
  });
  try {
    const open = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'Registrar pagamento');
    await ui.act(async () => open.click());
    await flush();
    assert.equal(document.querySelector('input[aria-label="Valor recebido"]').value, '25,00');
    const confirm = [...document.querySelectorAll('.pedmodal-manual-payment button')]
      .find(button => button.textContent === 'Confirmar pagamento');
    await ui.act(async () => confirm.click());
    await flush();
    assert.equal(postBody.valorCentavos, 2500);
    assert.match(document.querySelector('.pedmodal-payment-row').textContent, /Pago/);
  } finally {
    await unmount(root);
  }
});

test('edicao do nome atualiza o titulo e a listagem pai sem recarregar', async t => {
  let patchBody;
  let listRefreshes = 0;
  const root = await mountWith(t, async (url, options = {}) => {
    if (options.method === 'PATCH') {
      patchBody = JSON.parse(options.body);
      return Response.json({ok: true, clienteNome: patchBody.clienteNome});
    }
    return Response.json(detalhe({clienteNome: 'Vitoria'}));
  }, {onStatusChanged: () => { listRefreshes += 1; }});
  try {
    await ui.act(async () =>
      document.querySelector('button[aria-label="Editar nome da cliente"]').click());
    await flush();
    const input = document.querySelector('.pedmodal-name-controls input');
    await ui.act(async () => changeValue(input, '   '));
    await ui.act(async () => document.querySelector('.pedmodal-name-form').requestSubmit());
    await flush();
    assert.match(document.querySelector('.pedmodal-name-error').textContent, /Informe o nome/);
    assert.equal(patchBody, undefined, 'nome vazio nao chega ao backend');

    await ui.act(async () => changeValue(input, '  Vitória  '));
    await ui.act(async () => document.querySelector('.pedmodal-name-form').requestSubmit());
    await flush();
    assert.deepEqual(patchBody, {clienteNome: 'Vitória'});
    assert.match(document.querySelector('.pedmodal-title').textContent, /Pedido #1 - Vitória/);
    assert.equal(listRefreshes, 1);
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

test('preview de cancelamento mostra cobertura, estoque e confirmação executável', async t => {
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
    assert.match(modal.textContent, /reposição depende da confirmação física/i);
    assert.equal([...modal.querySelectorAll('button')].some(b => /confirmar cancelamento/i.test(b.textContent)), true);
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
    assert.equal(document.querySelector('.cancelpreview-confirm').disabled, true);
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

test('troca mostra diferença, confirma uma intenção e orienta cobrança do saldo', async t => {
  let postBody;
  const current = detalhe({total: 1500, pago: 1500, itens: [{
    id: 1, produto_id: 1, produto_nome: 'Bolo', emoji: '🎂', quantidade: 1,
    valor_unitario_centavos: 1500, valor_total_centavos: 1500,
    status_item: 'ATIVO', estoque_estado: 'BAIXADO',
  }]});
  const root = await mountWith(t, async (url, init = {}) => {
    const text = String(url);
    if (text === 'https://local.test/api/admin/produtos' || text.endsWith('/api/admin/produtos')) {
      return Response.json({produtos: [produto({preco_centavos: 2000})]});
    }
    if (text.includes('/troca-preview?')) {
      return Response.json({
        previewFingerprint: '1:preview-troca',
        itemDestino: {produtoId: 2, nome: 'Produto C', quantidade: 1, precoUnitarioCentavos: 2000, valorCentavos: 2000, estoqueDisponivel: 10},
        financeiro: {totalAtualCentavos: 1500, liquidoAtualCentavos: 1500, totalProjetadoCentavos: 2000,
          diferencaCentavos: 500, tipoDiferenca: 'COBRAR', saldoProjetadoCentavos: 500, excessoProjetadoCentavos: 0},
        refundsPropostos: [], estoque: {acaoOrigem: 'NAO_REPOR', acoesOrigemPermitidas: ['NAO_REPOR', 'REPOR'], estadoDestino: 'RESERVADO'},
        bloqueios: [], trocaExecutavel: true,
      });
    }
    if (text.endsWith('/itens/1/trocas') && init.method === 'POST') {
      postBody = JSON.parse(init.body);
      return Response.json({ok: true, troca: {id: 9, status: 'AGUARDANDO_COBRANCA', reembolsoPendenteCentavos: 0, refundsPendentes: []}}, {status: 201});
    }
    return Response.json(current);
  });
  try {
    const button = [...document.querySelectorAll('.pedmodal-btn-cancel-item')].find(b => /trocar produto/i.test(b.textContent));
    assert.ok(button);
    await ui.act(async () => button.click());
    await flush();
    await escolherDropdown('.additem-dropdown-trigger', 'Produto C');
    assert.match(document.querySelector('.additem-card').textContent, /Novo valorR\$ 20,00/);
    const confirm = document.querySelector('.additem-confirm');
    assert.equal(confirm.disabled, false);
    await ui.act(async () => confirm.click());
    await flush();
    assert.match(postBody.operationKey, /^[A-Za-z0-9._:-]{8,128}$/);
    assert.equal(postBody.previewFingerprint, '1:preview-troca');
    assert.match(document.querySelector('.additem-card').textContent, /diferença pode ser cobrada pelo Pix/i);
  } finally {
    await unmount(root);
  }
});

test('drawer de preview permanece utilizável no mobile', async () => {
  const css = await readFile('src/admin/Pedidos/CancelamentoItemPreviewModal.css', 'utf8');
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.cancelpreview-card\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /max-height:\s*92dvh/);
  assert.match(css, /\.cancelpreview-footer button\s*\{[^}]*width:\s*100%/s);
});


test("reload do cancelamento inconclusivo verifica a mesma operationKey e bloqueia duplo clique", async t => {
  const persistedKey = "refund-persisted-after-reload-01";
  let posts = 0;
  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });
  const cancellation = {
    id: 14,
    status: "INCONCLUSIVO",
    estoqueAcao: "NAO_REPOR",
    estoqueEstado: "BAIXADO",
    reembolsoPendenteCentavos: 500,
    financeiro: {
      status: "PARCIAL",
      totalCentavos: 3000,
      liquidoCentavos: 2500,
      saldoCentavos: 500
    },
    reembolsosConfirmados: [],
    pernasPendentes: [
      {
        pagamentoId: 7,
        pagamentoAlocacaoId: 11,
        metodo: "PIX_MP",
        valorCentavos: 500,
        confirmacaoManualPermitida: false,
        refundRemoto: {
          status: "INCONCLUSIVO",
          tentativas: 1,
          mpRefundId: null,
          ultimoErro: "transport",
          operationKey: persistedKey,
          atualizadoEm: "2026-01-01 12:00:00",
          podeVerificar: true
        }
      }
    ]
  };
  const current = detalhe({
    itens: [
      {
        ...detalhe().itens[0],
        cancelamento_id: 14,
        cancelamento_status: "INCONCLUSIVO",
        troca_id: null,
        troca_status: null,
        troca_item_origem_id: null
      }
    ]
  });
  let body;
  const root = await mountWith(t, async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("/cancelamentos/14/reembolsos") && init.method === "POST") {
      posts++;
      body = JSON.parse(init.body);
      await pending;
      return Response.json({ ok: true, refundStatus: "INCONCLUSIVO", cancelamento: cancellation });
    }
    if (href.endsWith("/cancelamentos")) return Response.json({ cancelamento: cancellation });
    return Response.json(current);
  });
  try {
    const open = [...document.querySelectorAll(".pedmodal-btn-cancel-item")].find(button =>
      /ver cancelamento/i.test(button.textContent)
    );
    await ui.act(async () => open.click());
    await flush();
    assert.match(
      document.querySelector(".cancelpreview-card").textContent,
      /Não foi possível confirmar o resultado do estorno/
    );
    const verify = [...document.querySelectorAll(".cancelpreview-card button")].find(button =>
      /verificar novamente/i.test(button.textContent)
    );
    await ui.act(async () => verify.click());
    await flush();
    assert.equal(posts, 1);
    assert.equal(body.operationKey, persistedKey);
    assert.equal(verify.disabled, true);
    await ui.act(async () => release());
    await flush();
    assert.equal(posts, 1);
  } finally {
    await unmount(root);
  }
});

test('detalhe aposenta a entrada visual do editor integral legado', async () => {
  const [detailSource, adminSource] = await Promise.all([
    readFile('src/admin/Pedidos/PedidoDetalheModal.tsx', 'utf8'),
    readFile('src/admin/Pedidos/AdminPedidos.tsx', 'utf8'),
  ]);
  assert.doesNotMatch(detailSource, /Editar pedido/);
  assert.doesNotMatch(adminSource, /EditarPedidoModal/);
});

test("refund recusado é terminal na UI e não oferece retry automático", async t => {
  const current = detalhe({
    itens: [
      {
        ...detalhe().itens[0],
        cancelamento_id: 15,
        cancelamento_status: "AGUARDANDO_REEMBOLSO",
        troca_id: null,
        troca_status: null,
        troca_item_origem_id: null
      }
    ]
  });
  const root = await mountWith(t, async url => {
    if (String(url).endsWith("/cancelamentos"))
      return Response.json({
        cancelamento: {
          id: 15,
          status: "AGUARDANDO_REEMBOLSO",
          estoqueAcao: "NAO_REPOR",
          reembolsoPendenteCentavos: 500,
          pernasPendentes: [
            {
              pagamentoId: 7,
              pagamentoAlocacaoId: 11,
              metodo: "PIX_MP",
              valorCentavos: 500,
              confirmacaoManualPermitida: false,
              refundRemoto: {
                status: "RECUSADO",
                tentativas: 1,
                mpRefundId: null,
                ultimoErro: "provider detail",
                operationKey: "refused-key-01",
                atualizadoEm: "2026-01-01 12:00:00",
                podeVerificar: false
              }
            }
          ]
        }
      });
    return Response.json(current);
  });
  try {
    const open = [...document.querySelectorAll(".pedmodal-btn-cancel-item")].find(button =>
      /ver cancelamento/i.test(button.textContent)
    );
    await ui.act(async () => open.click());
    await flush();
    const modal = document.querySelector(".cancelpreview-card");
    assert.match(modal.textContent, /recusou esta tentativa/i);
    assert.match(modal.textContent, /Recusado pelo provedor/);
    assert.equal(
      [...modal.querySelectorAll("button")].some(button =>
        /verificar|tentar novamente/i.test(button.textContent)
      ),
      false
    );
    assert.doesNotMatch(modal.textContent, /provider detail/);
  } finally {
    await unmount(root);
  }
});

test("reload da troca inconclusiva verifica a mesma intenção PIX_MP", async t => {
  const persistedKey = "exchange-refund-persisted-01";
  let posted;
  const exchange = {
    id: 21,
    status: "INCONCLUSIVA",
    reembolsoPendenteCentavos: 300,
    refundsPendentes: [
      {
        pagamentoId: 7,
        pagamentoAlocacaoId: 11,
        metodo: "PIX_MP",
        valorCentavos: 300,
        confirmacaoManualPermitida: false,
        refundRemoto: {
          status: "INCONCLUSIVO",
          tentativas: 2,
          mpRefundId: "mp-refund-9",
          ultimoErro: "timeout",
          operationKey: persistedKey,
          atualizadoEm: "2026-01-01 12:00:00",
          podeVerificar: true
        }
      }
    ]
  };
  const current = detalhe({
    itens: [
      {
        ...detalhe().itens[0],
        troca_id: 21,
        troca_status: "INCONCLUSIVA",
        troca_item_origem_id: 1,
        cancelamento_id: null,
        cancelamento_status: null
      }
    ]
  });
  const root = await mountWith(t, async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("/trocas/21/reembolsos")) {
      posted = JSON.parse(init.body);
      return Response.json({ ok: true, refundStatus: "INCONCLUSIVO", troca: exchange });
    }
    if (href.endsWith("/itens/1/trocas")) return Response.json({ troca: exchange });
    return Response.json(current);
  });
  try {
    const open = [...document.querySelectorAll(".pedmodal-btn-cancel-item")].find(button =>
      /ver troca/i.test(button.textContent)
    );
    await ui.act(async () => open.click());
    await flush();
    const verify = [...document.querySelectorAll(".additem-card button")].find(button =>
      /verificar novamente/i.test(button.textContent)
    );
    await ui.act(async () => verify.click());
    await flush();
    assert.equal(posted.operationKey, persistedKey);
  } finally {
    await unmount(root);
  }
});

test("detalhe reconstrói estados físicos e orienta o Pix da diferença da troca", async t => {
  const current = detalhe({
    total: 2000,
    pago: 1500,
    status: "PARCIAL",
    capacidade: 500,
    itens: [
      {
        ...detalhe().itens[0],
        status_item: "CANCELADO",
        estoque_estado: "REPOSTO",
        troca_id: 22,
        troca_status: "AGUARDANDO_COBRANCA",
        troca_item_origem_id: 1
      },
      {
        ...detalhe().itens[0],
        id: 2,
        produto_nome: "Destino",
        valor_total_centavos: 2000,
        status_item: "ATIVO",
        estoque_estado: "RESERVADO",
        troca_id: 22,
        troca_status: "AGUARDANDO_COBRANCA",
        troca_item_origem_id: 1
      }
    ]
  });
  const root = await mountWith(t, async () => Response.json(current));
  try {
    await flush();
    // Item CANCELADO (origem da troca) saiu da lista principal — só o
    // destino ATIVO aparece; o histórico da origem vive no modal próprio.
    assert.doesNotMatch(document.body.textContent, /Cancelado · Estoque reposto/);
    assert.match(document.body.textContent, /Ativo · Estoque reservado/);
    assert.match(document.body.textContent, /Troca aguardando pagamento/);
    assert.match(document.body.textContent, /Saldo: R\$ 5,00\./);
    assert.ok(
      [...document.querySelectorAll("button")].some(
        button => button.textContent === "Gerar Pix R$ 5,00"
      )
    );
  } finally {
    await unmount(root);
  }
});

test("troca concluída preserva histórico na origem e libera ações normais no destino ativo", async t => {
  const current = detalhe({
    itens: [
      {
        ...detalhe().itens[0],
        id: 1,
        produto_nome: "Origem",
        status_item: "CANCELADO",
        estoque_estado: "REPOSTO",
        cancelamento_id: null,
        cancelamento_status: null,
        troca_id: 40,
        troca_status: "CONCLUIDA",
        troca_item_origem_id: 1,
      },
      {
        ...detalhe().itens[0],
        id: 2,
        produto_nome: "Destino",
        status_item: "ATIVO",
        estoque_estado: "BAIXADO",
        cancelamento_id: null,
        cancelamento_status: null,
        troca_id: 40,
        troca_status: "CONCLUIDA",
        troca_item_origem_id: 1,
      },
    ],
  });
  const calls = [];
  const root = await mountWith(t, async url => {
    const href = String(url);
    calls.push(href);
    if (href === "/api/admin/produtos") return Response.json({produtos: []});
    return Response.json(current);
  });
  try {
    // A origem CANCELADA não ocupa mais a lista principal — só o destino
    // ativo aparece, com as ações normais de item.
    const rows = [...document.querySelectorAll(".pedmodal-item-row")];
    assert.equal(rows.length, 1);
    const destination = rows[0];
    const labels = [...destination.querySelectorAll("button")].map(button => button.textContent.trim());
    assert.deepEqual(labels, ["Cancelar item", "Trocar produto"]);
    assert.match(destination.textContent, /Troca concluída/);
    await ui.act(async () => destination.querySelectorAll("button")[1].click());
    await flush();
    assert.ok(calls.includes("/api/admin/produtos"));
    assert.equal(calls.some(url => url.endsWith("/itens/2/trocas")), false);
  } finally {
    await unmount(root);
  }
});

test("histórico mostra a troca concluída da origem e 'Ver detalhes' abre a troca por ela", async t => {
  const current = detalhe({
    itens: [
      {
        ...detalhe().itens[0], id: 1, produto_nome: "Origem",
        status_item: "CANCELADO", estoque_estado: "REPOSTO",
        troca_id: 40, troca_status: "CONCLUIDA", troca_item_origem_id: 1,
      },
      {
        ...detalhe().itens[0], id: 2, produto_nome: "Destino",
        status_item: "ATIVO", estoque_estado: "BAIXADO",
        troca_id: 40, troca_status: "CONCLUIDA", troca_item_origem_id: 1,
      },
    ],
  });
  const calls = [];
  const root = await mountWith(t, async url => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("/historico")) return Response.json({
      eventos: [{
        id: "troca-concluida-40", tipo: "TROCA_CONCLUIDA", data: "2026-01-02 10:00:00",
        titulo: "Troca concluída", status: "CONCLUIDA",
        itemOrigem: {id: 1, nome: "Origem", valorCentavos: 3000, estoqueEstado: "REPOSTO"},
        itemDestino: {id: 2, nome: "Destino", quantidade: 2, valorCentavos: 3000, estoqueEstado: "BAIXADO"},
        diferencaCentavos: 0, tipoDiferenca: "ZERO", estoqueAcao: "REPOR", referenciaId: 1,
      }],
    });
    if (href.endsWith("/itens/1/trocas")) return Response.json({troca: {
      id: 40, status: "CONCLUIDA", reembolsoPendenteCentavos: 0, refundsPendentes: [],
      reembolsosConfirmados: [], financeiro: {status: "PAGO", totalCentavos: 3000, liquidoCentavos: 3000, saldoCentavos: 0},
    }});
    return Response.json(current);
  });
  try {
    assert.equal(document.querySelectorAll(".pedmodal-item-row").length, 1, "origem não aparece na lista atual");

    await ui.act(async () => document.querySelector(".pedmodal-btn-historico").click());
    await flush();
    const historico = document.querySelector(".histmodal-card");
    assert.match(historico.textContent, /Origem/);
    assert.match(historico.textContent, /Destino/);
    assert.match(historico.textContent, /Concluído/);

    await ui.act(async () => [...historico.querySelectorAll("button")]
      .find(button => /ver detalhes/i.test(button.textContent)).click());
    await flush();
    assert.equal(document.querySelector(".histmodal-card"), null, "histórico fecha ao abrir o detalhe");
    assert.ok(calls.some(url => url.endsWith("/itens/1/trocas")), "abre a troca pela origem, não pelo destino");
  } finally {
    await unmount(root);
  }
});

test("cancelamento concluído reabre em modo leitura sem ação financeira duplicada", async t => {
  const current = detalhe({
    total: 0,
    pago: 500,
    reembolsado: 500,
    status: "PENDENTE",
    capacidade: 0,
    itens: [
      {
        ...detalhe().itens[0],
        status_item: "CANCELADO",
        estoque_estado: "REPOSTO",
        cancelamento_id: 30,
        cancelamento_status: "CONCLUIDO",
        troca_id: null,
        troca_status: null,
        troca_item_origem_id: null
      }
    ]
  });
  const root = await mountWith(t, async url => {
    const href = String(url);
    if (href.endsWith("/cancelamentos"))
      return Response.json({
        cancelamento: {
          id: 30,
          status: "CONCLUIDO",
          estoqueAcao: "REPOR",
          estoqueEstado: "REPOSTO",
          reembolsoPendenteCentavos: 0,
          pernasPendentes: [],
          reembolsosConfirmados: [
            {
              id: 40,
              metodo: "PIX_MP",
              valorCentavos: 500,
              origem: "MERCADO_PAGO",
              mpRefundId: "900"
            }
          ],
          financeiro: { status: "PENDENTE", totalCentavos: 0, liquidoCentavos: 0, saldoCentavos: 0 }
        }
      });
    if (href.endsWith("/historico")) return Response.json({
      eventos: [{
        id: "cancelamento-concluido-30", tipo: "CANCELAMENTO_CONCLUIDO", data: "2026-01-01 12:05:00",
        titulo: "Cancelamento concluído", status: "CONCLUIDO",
        item: {id: 1, nome: "Bolo", valorCentavos: 3000, estoqueEstado: "REPOSTO"},
        estoqueAcao: "REPOR", valorReembolsoCentavos: 500, metodosReembolso: ["PIX_MP"], referenciaId: 1,
      }],
    });
    return Response.json(current);
  });
  try {
    // Item CANCELADO some da lista principal — sem ele não sobra nenhuma
    // linha, e o cancelamento só é revisitável pelo histórico.
    assert.equal(document.querySelectorAll(".pedmodal-item-row").length, 0);

    await ui.act(async () => document.querySelector(".pedmodal-btn-historico").click());
    await flush();
    const historico = document.querySelector(".histmodal-card");
    assert.match(historico.textContent, /Cancelamento concluído/);
    await ui.act(async () => [...historico.querySelectorAll("button")]
      .find(button => /ver detalhes/i.test(button.textContent)).click());
    await flush();
    assert.equal(document.querySelector(".histmodal-card"), null, "histórico fecha ao abrir o detalhe");
    const modal = document.querySelector(".cancelpreview-card");
    assert.match(modal.textContent, /Devoluções confirmadas/);
    assert.match(modal.textContent, /R\$\s*5,00/);
    assert.equal(
      [...modal.querySelectorAll("button")].some(button =>
        /confirmar devolução|verificar novamente|solicitar estorno/i.test(button.textContent)
      ),
      false
    );
  } finally {
    await unmount(root);
  }
});
