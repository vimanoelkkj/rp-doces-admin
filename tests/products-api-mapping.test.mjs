import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Correção de categorias hardcoded: o bug real estava aqui — a API pública
// (`GET /api/produtos`) já retorna `categoria` (slug canônico, id em
// `categorias`) junto com `categoria_nome` (rótulo), mas o mapeamento
// `toProduct()` descartava o slug e só repassava o nome. Sem este teste,
// alguém poderia voltar a descartar `categorySlug` silenciosamente e nada
// pegaria a regressão — `catalogCategories`/`Cardapio.tsx` dependem dele.

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `export {fetchProducts} from './src/api/products';`,
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const {fetchProducts} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

test('fetchProducts preserva o slug canônico da categoria, separado do rótulo', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    produtos: [{
      id: 1, nome: 'Bolo de Morango', categoria: 'BOLO_NO_POTE', categoria_nome: 'Bolo no Pote',
      descricao: '', preco_centavos: 3500, preco_promocional_centavos: null,
      promocao_ativa: 0, promocao_inicio: null, promocao_fim: null,
      destaque: 0, ordem: 0, estoque: 10, estoque_reservado: 0, image_key: null,
    }],
  }));

  const [produto] = await fetchProducts();
  assert.equal(produto.category, 'Bolo no Pote', 'rótulo de exibição inalterado');
  assert.equal(produto.categorySlug, 'BOLO_NO_POTE', 'slug canônico preservado, não descartado');
});

test('fallback de categoria ausente ainda produz um slug utilizável', async t => {
  // COALESCE(c.nome, p.categoria) no backend: se a categoria foi removida,
  // `categoria_nome` cai para o próprio slug. O slug continua o mesmo campo.
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    produtos: [{
      id: 2, nome: 'Doce órfão', categoria: 'SEM_CATEGORIA', categoria_nome: 'SEM_CATEGORIA',
      descricao: '', preco_centavos: 1000, preco_promocional_centavos: null,
      promocao_ativa: 0, promocao_inicio: null, promocao_fim: null,
      destaque: 0, ordem: 0, estoque: 5, estoque_reservado: 0, image_key: null,
    }],
  }));

  const [produto] = await fetchProducts();
  assert.equal(produto.categorySlug, 'SEM_CATEGORIA');
  assert.equal(produto.category, 'SEM_CATEGORIA');
});
