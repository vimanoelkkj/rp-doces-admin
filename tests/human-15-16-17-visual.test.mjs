import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// HUMAN-15/16/17 — regressões dos achados visuais.
//
// A regressão do HUMAN-17 nasceu de um descasamento entre COMPONENTE e CSS:
// o HUMAN-04 trocou o input do WhatsApp para `type="tel"` e o seletor
// `input[type="text"]` ficou para trás, deixando o campo branco nativo ao
// lado do campo Cliente.
//
// Por isso o teste central não confere um seletor fixo: ele MONTA os modais
// reais, lê no DOM quais `type` de input existem dentro de cada bloco de
// campo, e exige que cada um esteja coberto nos dois temas. Trocar o type de
// novo sem atualizar o CSS volta a falhar — inclusive em campos que ainda
// nem existem.

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://local.test/admin',
});
// O scheduler do React DOM abre MessageChannel; portas abertas seguram o
// event loop e o processo de teste nunca encerra. Mesmo tratamento do
// harness de `human-findings-ui.test.mjs`.
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() { super(); channels.push(this); }
};
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, {configurable: true, value: dom.window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
      import {createRoot} from 'react-dom/client';
      import NovoPedidoModal from './src/admin/Pedidos/NovoPedidoModal';
      import NovoProdutoModal from './src/admin/Produtos/NovoProdutoModal';
      import EditarPedidoModal from './src/admin/Pedidos/EditarPedidoModal';
      export {act} from 'react';

      export function mountVendaManual(container) {
        const root = createRoot(container);
        root.render(<NovoPedidoModal open onClose={() => {}}/>);
        return root;
      }
      export function mountProduto(container, promocaoAtiva) {
        const produto = {
          id: 1, nome: 'Bolo', categoria: 'BOLO', descricao: 'Doce', preco_centavos: 5000,
          disponivel: 1, ativo: 1, destaque: 0,
          promocao_ativa: promocaoAtiva ? 1 : 0,
          preco_promocional_centavos: promocaoAtiva ? 4000 : null,
          promocao_inicio: null, promocao_fim: null,
          estoque: 20, estoque_reservado: 0, emoji: '', image_key: null,
        };
        const root = createRoot(container);
        root.render(<NovoProdutoModal open onClose={() => {}} produto={produto}/>);
        return root;
      }
      export function mountEditarPedido(container) {
        const root = createRoot(container);
        root.render(<EditarPedidoModal orderId={1} onClose={() => {}}/>);
        return root;
      }
    `,
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"'},
  loader: {'.css': 'empty', '.png': 'dataurl'},
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const container = document.getElementById('root');
const flush = () => ui.act(async () => { await new Promise(setImmediate); });
const ler = caminho => readFile(new URL(`../${caminho}`, import.meta.url), 'utf8');

// Rede inerte: os modais carregam catálogo/categorias ao abrir.
globalThis.fetch = async url => {
  const alvo = String(url);
  if (alvo.includes('/categorias')) return Response.json({categorias: [{id: 'BOLO', nome: 'Bolo', emoji: '🎂', ativo: 1}]});
  if (alvo.includes('/produtos')) return Response.json({produtos: []});
  return Response.json({});
};

async function montar(mount, ...args) {
  let root;
  await ui.act(async () => { root = mount(container, ...args); });
  await flush();
  return async () => { await ui.act(async () => root.unmount()); container.innerHTML = ''; };
}

/** Tipos de input realmente renderizados dentro de um bloco de campo. */
function tiposDeInputEm(classeDoCampo) {
  const tipos = new Set();
  for (const campo of document.querySelectorAll(`.${classeDoCampo}`)) {
    for (const input of campo.querySelectorAll('input')) {
      if (input.hidden || input.type === 'file') continue;
      tipos.add(input.type);
    }
  }
  return tipos;
}

function exigirCobertura(tipos, classe, claro, escuro) {
  assert.ok(tipos.size > 0, `nenhum input encontrado em .${classe}`);
  for (const tipo of tipos) {
    assert.match(claro, new RegExp(`\\.${classe} input\\[type="${tipo}"\\]`),
      `tema claro precisa estilizar .${classe} input[type="${tipo}"]`);
    assert.match(escuro, new RegExp(`\\.${classe} input\\[type="${tipo}"\\]`),
      `tema escuro precisa estilizar .${classe} input[type="${tipo}"]`);
  }
}

/* ─────────────────────────────── HUMAN-17 ─────────────────────────────── */

test('HUMAN-17: todo input renderizado em .nped-field tem estilo nos dois temas', async () => {
  const desmontar = await montar(ui.mountVendaManual);
  try {
    const tipos = tiposDeInputEm('nped-field');
    assert.ok(tipos.has('text'), 'Cliente continua text');
    assert.ok(tipos.has('tel'), 'WhatsApp continua tel (HUMAN-04 preservado)');
    exigirCobertura(
      tipos, 'nped-field',
      await ler('src/admin/Pedidos/NovoPedidoModal.css'),
      await ler('src/admin/theme/admin-dark-theme.css'),
    );
  } finally {
    await desmontar();
  }
});

test('HUMAN-17: o campo WhatsApp preserva integralmente o HUMAN-04', async () => {
  const desmontar = await montar(ui.mountVendaManual);
  try {
    const campos = [...document.querySelectorAll('.nped-field')];
    const campo = campos.find(c => /WhatsApp/i.test(c.querySelector('label')?.textContent ?? ''));
    assert.ok(campo, 'campo WhatsApp presente');
    const input = campo.querySelector('input');
    assert.equal(input.type, 'tel');
    assert.equal(input.getAttribute('inputmode'), 'tel');
    assert.equal(input.maxLength, 15);

    // A máscara compartilhada continua sendo aplicada no onChange.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await ui.act(async () => {
      setter.call(input, '31abc999998888');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    assert.equal(input.value, '(31) 99999-8888', 'letras descartadas e máscara aplicada');
  } finally {
    await desmontar();
  }
});

test('HUMAN-12/17: o agendamento da promoção não repete o descasamento', async () => {
  const desmontar = await montar(ui.mountProduto, true);
  try {
    const tipos = tiposDeInputEm('np-field');
    assert.ok(tipos.has('datetime-local'), 'campos de agendamento aparecem com a promoção ligada');
    exigirCobertura(
      tipos, 'np-field',
      await ler('src/admin/Produtos/NovoProdutoModal.css'),
      await ler('src/admin/theme/admin-dark-theme.css'),
    );
  } finally {
    await desmontar();
  }
});

test('HUMAN-12: sem promoção ligada, o bloco de configuração não é renderizado', async () => {
  const desmontar = await montar(ui.mountProduto, false);
  try {
    assert.equal(document.querySelector('.np-promo-box'), null);
    const desmontar2 = await montar(ui.mountProduto, true);
    try {
      assert.ok(document.querySelector('.np-promo-box'), 'ligado, os campos aparecem');
      assert.ok(document.querySelector('.np-promo-hint').textContent.length > 0,
        'estado de vigência é comunicado');
    } finally {
      await desmontar2();
    }
  } finally {
    await desmontar();
  }
});

/* ─────────────────────────────── HUMAN-16 ─────────────────────────────── */

test('HUMAN-16: remover item tem tratamento dark próprio e foco visível', async () => {
  const escuro = await ler('src/admin/theme/admin-dark-theme.css');
  const claro = await ler('src/admin/Pedidos/NovoPedidoModal.css');

  assert.match(escuro, /html\[data-admin-theme="dark"\] \.nped-btn-remove \{/,
    'sem override dark o botão herda o background branco do tema claro');
  assert.match(escuro, /html\[data-admin-theme="dark"\] \.nped-btn-remove:hover:not\(:disabled\)/,
    'hover destrutivo próprio, para não confundir remover com fechar');
  assert.match(escuro, /html\[data-admin-theme="dark"\] \.nped-btn-remove:focus-visible/);
  assert.match(claro, /\.nped-btn-remove:focus-visible/);
  assert.match(claro, /\.nped-btn-remove:disabled \{[\s\S]*?cursor: default;/);
});

test('HUMAN-16: o alvo clicável e o disabled continuam íntegros na venda manual', async () => {
  const desmontar = await montar(ui.mountVendaManual);
  try {
    const botoes = [...document.querySelectorAll('.nped-btn-remove')];
    assert.ok(botoes.length > 0, 'botão de remover presente');
    for (const botao of botoes) {
      assert.equal(botao.tagName, 'BUTTON', 'continua sendo botão de verdade');
      assert.equal(botao.type, 'button', 'nunca submete o formulário');
    }
    // Com um único item, remover fica desabilitado — regra preservada.
    assert.equal(botoes[0].disabled, true, 'não dá para remover o último item');
  } finally {
    await desmontar();
  }
});

test('HUMAN-16 preserva B1: a edição de itens continua bloqueada', async () => {
  const desmontar = await montar(ui.mountEditarPedido);
  try {
    for (const botao of document.querySelectorAll('.nped-btn-remove')) {
      assert.equal(botao.disabled, true, 'B1: remover item permanece desabilitado no editor');
    }
    const salvar = document.querySelector('.nped-btn-save');
    if (salvar) assert.equal(salvar.disabled, true, 'B1: salvar permanece desabilitado');
  } finally {
    await desmontar();
  }

  // E nenhum caminho de escrita foi reaberto no componente.
  const tsx = await ler('src/admin/Pedidos/EditarPedidoModal.tsx');
  assert.match(tsx, /disabled=\{disabled \|\| !canRemove\}/);
  assert.doesNotMatch(tsx, /method:\s*["']PUT["']/, 'editor não voltou a enviar PUT de itens');
});

/* ─────────────────────────────── HUMAN-15 ─────────────────────────────── */

test('HUMAN-15: ícone do WhatsApp deixou de ser o retângulo de cartão', async () => {
  const tsx = await ler('src/admin/Loja/AdminLoja.tsx');
  const fim = tsx.indexOf('WhatsApp: {whatsapp}');
  assert.ok(fim > 0, 'linha do WhatsApp presente na prévia');
  // Do último início de linha da prévia até o texto: é o bloco do ícone.
  const inicio = tsx.lastIndexOf('<div className="loj-preview-row">', fim);
  const bloco = tsx.slice(inicio, fim);

  assert.doesNotMatch(bloco, /<rect/,
    'o desenho anterior era um rect com faixa — lia-se como cartão de crédito');
  assert.match(bloco, /<path/, 'agora é o balão com o fone');

  // Só o desenho mudou: a linguagem visual ao redor foi preservada.
  assert.match(bloco, /width="14"/);
  assert.match(bloco, /height="14"/);
  assert.match(bloco, /stroke="#8c7a76"/);
  assert.match(bloco, /strokeWidth="1\.2"/);
  assert.match(bloco, /viewBox="0 0 14 14"/);
});
