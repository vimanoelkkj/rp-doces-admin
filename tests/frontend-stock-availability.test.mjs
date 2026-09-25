import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Compila as funções do frontend via esbuild para execução direta no node:test
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { fetchProducts } from './src/api/products';
      export {
        calculateAddQuantity,
        calculateUpdateQuantity,
        reconcileCartWithCatalog,
        remainingAvailability,
        getStockBadgeState,
      } from './src/context/cartReconciliation';
    `,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});

const {
  fetchProducts,
  calculateAddQuantity,
  calculateUpdateQuantity,
  reconcileCartWithCatalog,
  remainingAvailability,
  getStockBadgeState,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

test('fetchProducts propaga disponibilidade = max(0, estoque - estoque_reservado) até Product', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      produtos: [
        {
          id: 1,
          nome: 'Bolo de Pote',
          categoria: 'BOLO_NO_POTE',
          categoria_nome: 'Bolo no Pote',
          descricao: '',
          preco_centavos: 2500,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 0,
          estoque: 10,
          estoque_reservado: 3,
          image_key: null,
        },
        {
          id: 2,
          nome: 'Brigadeiro Esgotado',
          categoria: 'DOCINHOS',
          categoria_nome: 'Docinhos',
          descricao: '',
          preco_centavos: 500,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 1,
          estoque: 2,
          estoque_reservado: 5,
          image_key: null,
        },
        {
          id: 3,
          nome: 'Torta Zerada',
          categoria: 'TORTAS',
          categoria_nome: 'Tortas',
          descricao: '',
          preco_centavos: 4000,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 2,
          estoque: 0,
          estoque_reservado: 0,
          image_key: null,
        },
      ],
    })
  );

  const produtos = await fetchProducts();
  assert.equal(produtos.length, 3);

  // 10 - 3 = 7 disponível
  assert.equal(produtos[0].disponibilidade, 7);

  // 2 - 5 = -3 -> limitado a 0 (nunca negativo)
  assert.equal(produtos[1].disponibilidade, 0);

  // 0 - 0 = 0
  assert.equal(produtos[2].disponibilidade, 0);
});

const produtoUnico = {
  id: 1,
  nome: 'Bolo de Pote',
  categoria: 'BOLO_NO_POTE',
  categoria_nome: 'Bolo no Pote',
  descricao: '',
  preco_centavos: 2500,
  preco_promocional_centavos: null,
  promocao_ativa: 0,
  promocao_inicio: null,
  promocao_fim: null,
  destaque: 0,
  ordem: 0,
  estoque: 1,
  estoque_reservado: 0,
  image_key: null,
};

test('fetchProducts pede a liberação de reservas vencidas (POST) antes de ler o catálogo (GET)', async (t) => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    chamadas.push([options?.method ?? 'GET', String(url)]);
    if (String(url) === '/api/reservas/reconciliar') return Response.json({ ok: true });
    return Response.json({ produtos: [produtoUnico] });
  });

  const produtos = await fetchProducts();

  assert.deepEqual(chamadas, [
    ['POST', '/api/reservas/reconciliar'],
    ['GET', '/api/produtos'],
  ]);
  assert.equal(produtos.length, 1);
  assert.equal(produtos[0].disponibilidade, 1);
});

test('fetchProducts carrega o catálogo mesmo se a liberação de reservas falhar', async (t) => {
  for (const falha of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => Response.json({ error: 'Origem inválida' }, { status: 403 }),
  ]) {
    const chamadas = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      chamadas.push([options?.method ?? 'GET', String(url)]);
      if (String(url) === '/api/reservas/reconciliar') return falha();
      return Response.json({ produtos: [produtoUnico] });
    });

    const produtos = await fetchProducts();

    assert.deepEqual(chamadas.map(([m, u]) => `${m} ${u}`), [
      'POST /api/reservas/reconciliar',
      'GET /api/produtos',
    ]);
    assert.equal(produtos.length, 1);
    assert.equal(produtos[0].name, 'Bolo de Pote');
    t.mock.restoreAll();
  }
});

test('calculateAddQuantity nunca ultrapassa a disponibilidade do item', () => {
  // Quantidade atual 2, disponibilidade 3 -> permite 3
  assert.equal(calculateAddQuantity(2, 3), 3);

  // Quantidade atual 3, disponibilidade 3 -> não permite ultrapassar 3
  assert.equal(calculateAddQuantity(3, 3), 3);

  // Quantidade atual 4 (caso anterior salvo), disponibilidade 3 -> não incrementa
  assert.equal(calculateAddQuantity(4, 3), 3);

  // Item esgotado (disponibilidade 0) -> não adiciona
  assert.equal(calculateAddQuantity(0, 0), 0);
  assert.equal(calculateAddQuantity(1, 0), 1);

  // Disponibilidade indefinida (legado) -> incrementa normalmente
  assert.equal(calculateAddQuantity(1, undefined), 2);
});

test('calculateUpdateQuantity nunca ultrapassa a disponibilidade do item e zera quando <= 0', () => {
  // Atualizar para 5 com disponibilidade 3 -> limita a 3
  assert.equal(calculateUpdateQuantity(5, 3), 3);

  // Atualizar para 2 com disponibilidade 3 -> permite 2
  assert.equal(calculateUpdateQuantity(2, 3), 2);

  // Atualizar para quantidade negativa ou zero -> remove (retorna 0)
  assert.equal(calculateUpdateQuantity(0, 3), 0);
  assert.equal(calculateUpdateQuantity(-1, 3), 0);

  // Atualizar com disponibilidade 0 -> remove (retorna 0)
  assert.equal(calculateUpdateQuantity(2, 0), 0);
});

test('reconcileCartWithCatalog ajusta quantidades e remove itens esgotados', () => {
  const carrinhoInicial = [
    { id: 1, name: 'Bolo', price: 20, image: '', quantity: 5, disponibilidade: 10 },
    { id: 2, name: 'Docinho', price: 5, image: '', quantity: 2, disponibilidade: 5 },
    { id: 3, name: 'Biscoito', price: 8, image: '', quantity: 1, disponibilidade: 3 },
  ];

  const catalogoAtualizado = [
    { id: 1, disponibilidade: 2 }, // Estoque caiu para 2 (menor que quantidade salva 5)
    { id: 2, disponibilidade: 0 }, // Esgotou completamente
    { id: 3, disponibilidade: 4 }, // Estoque suficiente
  ];

  const { reconciled, adjusted } = reconcileCartWithCatalog(
    carrinhoInicial,
    catalogoAtualizado
  );

  assert.equal(adjusted, true, 'deve marcar que houve ajustes');
  assert.equal(reconciled.length, 2, 'item esgotado deve ter sido removido');

  // Item 1 reduzido de 5 para 2
  const item1 = reconciled.find((i) => i.id === 1);
  assert.ok(item1);
  assert.equal(item1.quantity, 2);
  assert.equal(item1.disponibilidade, 2);

  // Item 2 removido
  assert.equal(reconciled.find((i) => i.id === 2), undefined);

  // Item 3 mantido com quantidade 1 e disponibilidade atualizada para 4
  const item3 = reconciled.find((i) => i.id === 3);
  assert.ok(item3);
  assert.equal(item3.quantity, 1);
  assert.equal(item3.disponibilidade, 4);
});

test('reconcileCartWithCatalog não altera itens quando estoque é suficiente e estável', () => {
  const carrinho = [
    { id: 1, name: 'Bolo', price: 20, image: '', quantity: 2, disponibilidade: 5 },
  ];

  const catalogo = [{ id: 1, disponibilidade: 5 }];

  const { reconciled, adjusted } = reconcileCartWithCatalog(carrinho, catalogo);

  assert.equal(adjusted, false);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].quantity, 2);
});

test('remainingAvailability calcula estoque restante considerando itens no carrinho', () => {
  // disponibilidade 1, carrinho 0 -> restante 1
  assert.equal(remainingAvailability(1, 0), 1);

  // disponibilidade 1, carrinho 1 -> restante 0
  assert.equal(remainingAvailability(1, 1), 0);

  // disponibilidade 3, carrinho 0 -> restante 3
  assert.equal(remainingAvailability(3, 0), 3);

  // disponibilidade 3, carrinho 2 -> restante 1
  assert.equal(remainingAvailability(3, 2), 1);

  // disponibilidade 3, carrinho 3 -> restante 0
  assert.equal(remainingAvailability(3, 3), 0);

  // disponibilidade 5, carrinho 1 -> restante 4
  assert.equal(remainingAvailability(5, 1), 4);

  // carrinho com quantidade maior que disponibilidade limita a 0 (nunca negativo)
  assert.equal(remainingAvailability(2, 5), 0);

  // disponibilidade indefinida trata como 0
  assert.equal(remainingAvailability(undefined, 0), 0);
});

test('getStockBadgeState reflete o estoque restante com os badges corretos', () => {
  // disponibilidade 3, carrinho 0 -> restante 3 -> baixo estoque ("poucas_unidades")
  assert.equal(getStockBadgeState(remainingAvailability(3, 0)), 'poucas_unidades');

  // disponibilidade 3, carrinho 2 -> restante 1 -> última unidade ("ultima_unidade")
  assert.equal(getStockBadgeState(remainingAvailability(3, 2)), 'ultima_unidade');

  // disponibilidade 3, carrinho 3 -> restante 0 -> esgotado ("esgotado")
  assert.equal(getStockBadgeState(remainingAvailability(3, 3)), 'esgotado');

  // disponibilidade 5, carrinho 1 -> restante 4 -> sem badge de estoque baixo (null)
  assert.equal(getStockBadgeState(remainingAvailability(5, 1)), null);

  // disponibilidade 1, carrinho 0 -> restante 1 -> última unidade ("ultima_unidade")
  assert.equal(getStockBadgeState(remainingAvailability(1, 0)), 'ultima_unidade');

  // disponibilidade 1, carrinho 1 -> restante 0 -> esgotado ("esgotado")
  assert.equal(getStockBadgeState(remainingAvailability(1, 1)), 'esgotado');
});

