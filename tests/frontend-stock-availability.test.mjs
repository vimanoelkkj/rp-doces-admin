import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Compila as funções do frontend via esbuild para execução direta no node:test
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
      export { fetchProducts } from './src/api/products';
      export {
        calculateAddQuantity,
        calculateUpdateQuantity,
        reconcileCartWithCatalog,
        remainingAvailability,
        getStockBadgeState,
      } from './src/context/cartReconciliation';
    `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const {
  fetchProducts,
  calculateAddQuantity,
  calculateUpdateQuantity,
  reconcileCartWithCatalog,
  remainingAvailability,
  getStockBadgeState
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("fetchProducts propaga disponibilidade = max(0, estoque - estoque_reservado) até Product", async t => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      produtos: [
        {
          id: 1,
          nome: "Bolo de Pote",
          categoria: "BOLO_NO_POTE",
          categoria_nome: "Bolo no Pote",
          descricao: "",
          preco_centavos: 2500,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 0,
          estoque: 10,
          estoque_reservado: 3,
          image_key: null
        },
        {
          id: 2,
          nome: "Brigadeiro Esgotado",
          categoria: "DOCINHOS",
          categoria_nome: "Docinhos",
          descricao: "",
          preco_centavos: 500,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 1,
          estoque: 2,
          estoque_reservado: 5,
          image_key: null
        },
        {
          id: 3,
          nome: "Torta Zerada",
          categoria: "TORTAS",
          categoria_nome: "Tortas",
          descricao: "",
          preco_centavos: 4000,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null,
          destaque: 0,
          ordem: 2,
          estoque: 0,
          estoque_reservado: 0,
          image_key: null
        }
      ]
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
  nome: "Bolo de Pote",
  categoria: "BOLO_NO_POTE",
  categoria_nome: "Bolo no Pote",
  descricao: "",
  preco_centavos: 2500,
  preco_promocional_centavos: null,
  promocao_ativa: 0,
  promocao_inicio: null,
  promocao_fim: null,
  destaque: 0,
  ordem: 0,
  estoque: 1,
  estoque_reservado: 0,
  image_key: null
};

test("fetchProducts pede a liberação de reservas vencidas (POST) antes de ler o catálogo (GET)", async t => {
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    chamadas.push([options?.method ?? "GET", String(url)]);
    if (String(url) === "/api/reservas/reconciliar") return Response.json({ ok: true });
    return Response.json({ produtos: [produtoUnico] });
  });

  const produtos = await fetchProducts();

  assert.deepEqual(chamadas, [
    ["POST", "/api/reservas/reconciliar"],
    ["GET", "/api/produtos"]
  ]);
  assert.equal(produtos.length, 1);
  assert.equal(produtos[0].disponibilidade, 1);
});

test("fetchProducts carrega o catálogo mesmo se a liberação de reservas falhar", async t => {
  for (const falha of [
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => Response.json({ error: "Origem inválida" }, { status: 403 })
  ]) {
    const chamadas = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      chamadas.push([options?.method ?? "GET", String(url)]);
      if (String(url) === "/api/reservas/reconciliar") return falha();
      return Response.json({ produtos: [produtoUnico] });
    });

    const produtos = await fetchProducts();

    assert.deepEqual(
      chamadas.map(([m, u]) => `${m} ${u}`),
      ["POST /api/reservas/reconciliar", "GET /api/produtos"]
    );
    assert.equal(produtos.length, 1);
    assert.equal(produtos[0].name, "Bolo de Pote");
    t.mock.restoreAll();
  }
});

test("calculateAddQuantity nunca ultrapassa a disponibilidade do item", () => {
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

test("calculateUpdateQuantity nunca ultrapassa a disponibilidade do item e zera quando <= 0", () => {
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

test("reconcileCartWithCatalog ajusta quantidades e remove itens esgotados", () => {
  const carrinhoInicial = [
    { id: 1, name: "Bolo", price: 20, image: "", quantity: 5, disponibilidade: 10 },
    { id: 2, name: "Docinho", price: 5, image: "", quantity: 2, disponibilidade: 5 },
    { id: 3, name: "Biscoito", price: 8, image: "", quantity: 1, disponibilidade: 3 }
  ];

  const catalogoAtualizado = [
    { id: 1, disponibilidade: 2 }, // Estoque caiu para 2 (menor que quantidade salva 5)
    { id: 2, disponibilidade: 0 }, // Esgotou completamente
    { id: 3, disponibilidade: 4 } // Estoque suficiente
  ];

  const { reconciled, adjusted } = reconcileCartWithCatalog(carrinhoInicial, catalogoAtualizado);

  assert.equal(adjusted, true, "deve marcar que houve ajustes");
  assert.equal(reconciled.length, 2, "item esgotado deve ter sido removido");

  // Item 1 reduzido de 5 para 2
  const item1 = reconciled.find(i => i.id === 1);
  assert.ok(item1);
  assert.equal(item1.quantity, 2);
  assert.equal(item1.disponibilidade, 2);

  // Item 2 removido
  assert.equal(
    reconciled.find(i => i.id === 2),
    undefined
  );

  // Item 3 mantido com quantidade 1 e disponibilidade atualizada para 4
  const item3 = reconciled.find(i => i.id === 3);
  assert.ok(item3);
  assert.equal(item3.quantity, 1);
  assert.equal(item3.disponibilidade, 4);
});

test("reconcileCartWithCatalog não altera itens quando estoque é suficiente e estável", () => {
  const carrinho = [{ id: 1, name: "Bolo", price: 20, image: "", quantity: 2, disponibilidade: 5 }];

  const catalogo = [{ id: 1, disponibilidade: 5 }];

  const { reconciled, adjusted } = reconcileCartWithCatalog(carrinho, catalogo);

  assert.equal(adjusted, false);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].quantity, 2);
});

test("reconcileCartWithCatalog mantém sem ajuste os itens ausentes do catálogo ou sem disponibilidade numérica", () => {
  const ausente = {
    id: 10,
    name: "Fora do catálogo",
    price: 9,
    image: "",
    quantity: 3,
    disponibilidade: 7
  };
  const semCampo = {
    id: 11,
    name: "Sem campo",
    price: 9,
    image: "",
    quantity: 2,
    disponibilidade: 4
  };
  const nula = { id: 12, name: "Nula", price: 9, image: "", quantity: 1 };
  const texto = { id: 13, name: "Texto", price: 9, image: "", quantity: 1, disponibilidade: 2 };
  const carrinho = [ausente, semCampo, nula, texto];
  // Só valores numéricos entram no mapa do catálogo: os demais equivalem a "não consta".
  const catalogo = [
    { id: 11 },
    { id: 12, disponibilidade: null },
    { id: 13, disponibilidade: "5" }
  ];

  const { reconciled, adjusted } = reconcileCartWithCatalog(carrinho, catalogo);

  assert.equal(adjusted, false, "manter um item não é um ajuste");
  assert.equal(reconciled.length, 4);
  for (const [i, item] of carrinho.entries()) {
    assert.ok(reconciled[i] === item, `item ${item.id} mantido, na ordem, sem cópia nem alteração`);
  }
});

test("reconcileCartWithCatalog combina itens presentes, esgotados e ausentes sem tocar nos ausentes", () => {
  const item = (id, quantity, disponibilidade) => ({
    id,
    name: `Item ${id}`,
    price: 10,
    image: "",
    quantity,
    disponibilidade
  });
  const estavel = item(20, 2, 5); // catálogo: 5 => só reescreve a mesma disponibilidade
  const esgotado = item(21, 1, 3); // catálogo: 0 => removido
  const ausente = item(22, 4, 9); // fora do catálogo => mantido como está
  const excedido = item(23, 6, 8); // catálogo: 3 => quantidade limitada a 3
  const negativo = item(24, 1, 2); // catálogo: -2 => tratado como 0 => removido
  const invalido = item(25, 2, 6); // catálogo com texto => não consta => mantido como está
  const catalogo = [
    { id: 20, disponibilidade: 5 },
    { id: 21, disponibilidade: 0 },
    { id: 23, disponibilidade: 3 },
    { id: 24, disponibilidade: -2 },
    { id: 25, disponibilidade: "muitos" }
  ];

  const { reconciled, adjusted } = reconcileCartWithCatalog(
    [estavel, esgotado, ausente, excedido, negativo, invalido],
    catalogo
  );

  assert.equal(adjusted, true, "a remoção e a limitação de quantidade contam como ajuste");
  assert.deepEqual(
    reconciled.map(i => i.id),
    [20, 22, 23, 25],
    "esgotados saem; ausentes e inválidos ficam; a ordem original é preservada"
  );
  assert.ok(reconciled[1] === ausente, "ausente do catálogo: mesma referência, sem cópia");
  assert.ok(reconciled[3] === invalido, "disponibilidade inválida no catálogo: mesma referência");
  assert.deepEqual(reconciled[0], { ...estavel, disponibilidade: 5 });
  assert.deepEqual(reconciled[2], { ...excedido, quantity: 3, disponibilidade: 3 });
});

test("reconcileCartWithCatalog: carrinho vazio, catálogo vazio ou ausente não alteram nada", () => {
  assert.deepEqual(reconcileCartWithCatalog([], [{ id: 1, disponibilidade: 3 }]), {
    reconciled: [],
    adjusted: false
  });

  const carrinho = [{ id: 1, name: "Bolo", price: 20, image: "", quantity: 2, disponibilidade: 5 }];
  for (const catalogo of [[], undefined, null]) {
    const { reconciled, adjusted } = reconcileCartWithCatalog(carrinho, catalogo);
    assert.deepEqual(reconciled, carrinho);
    assert.equal(adjusted, false);
  }
});

test("remainingAvailability calcula estoque restante considerando itens no carrinho", () => {
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

test("getStockBadgeState reflete o estoque restante com os badges corretos", () => {
  // disponibilidade 3, carrinho 0 -> restante 3 -> baixo estoque ("poucas_unidades")
  assert.equal(getStockBadgeState(remainingAvailability(3, 0)), "poucas_unidades");

  // disponibilidade 3, carrinho 2 -> restante 1 -> última unidade ("ultima_unidade")
  assert.equal(getStockBadgeState(remainingAvailability(3, 2)), "ultima_unidade");

  // disponibilidade 3, carrinho 3 -> restante 0 -> esgotado ("esgotado")
  assert.equal(getStockBadgeState(remainingAvailability(3, 3)), "esgotado");

  // disponibilidade 5, carrinho 1 -> restante 4 -> sem badge de estoque baixo (null)
  assert.equal(getStockBadgeState(remainingAvailability(5, 1)), null);

  // disponibilidade 1, carrinho 0 -> restante 1 -> última unidade ("ultima_unidade")
  assert.equal(getStockBadgeState(remainingAvailability(1, 0)), "ultima_unidade");

  // disponibilidade 1, carrinho 1 -> restante 0 -> esgotado ("esgotado")
  assert.equal(getStockBadgeState(remainingAvailability(1, 1)), "esgotado");
});

test("calculateAddQuantity com quantidade: soma limitada à disponibilidade", () => {
  // C) quantidade > 1 sem exceder a disponibilidade
  assert.equal(calculateAddQuantity(0, 5, 3), 3);
  // D) disponibilidade 5 com 3 no carrinho -> só +2 cabem
  assert.equal(calculateAddQuantity(3, 5, 2), 5);
  // E) pedido acima do disponível é limitado
  assert.equal(calculateAddQuantity(3, 5, 10), 5);
  assert.equal(calculateAddQuantity(0, 5, 99), 5);
  // esgotado nunca adiciona
  assert.equal(calculateAddQuantity(0, 0, 3), 0);
  // quantidade inválida não altera nada
  assert.equal(calculateAddQuantity(2, 5, 0), 2);
  assert.equal(calculateAddQuantity(2, 5, -1), 2);
  assert.equal(calculateAddQuantity(2, 5, 1.5), 2);
  // padrão continua sendo +1 (chamadores existentes)
  assert.equal(calculateAddQuantity(2, 5), 3);
  // legado sem disponibilidade conhecida
  assert.equal(calculateAddQuantity(1, undefined, 3), 4);
});
