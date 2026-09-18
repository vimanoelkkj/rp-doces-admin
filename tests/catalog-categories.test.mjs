import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `export {catalogCategories} from './src/pages/catalogCategories';`,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});

const {catalogCategories} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const product = (id, categorySlug, category = categorySlug) => ({
  id,
  name: `Produto ${id}`,
  category,
  categorySlug,
  price: 10,
  image: '',
});

test('cardápio deriva categorias dos produtos públicos sem lista fixa', () => {
  assert.deepEqual(
    catalogCategories([
      product(1, 'BOLO_NO_POTE', 'Bolo no Pote'),
      product(2, 'BRIGADEIROS', 'Brigadeiros'),
      product(3, 'BOLO_NO_POTE', 'Bolo no Pote'),
      product(4, '  MINI_PUDIM  ', '  Mini Pudim  '),
      product(5, '   ', '   '),
    ]),
    [
      {slug: 'BOLO_NO_POTE', nome: 'Bolo no Pote'},
      {slug: 'BRIGADEIROS', nome: 'Brigadeiros'},
      {slug: 'MINI_PUDIM', nome: 'Mini Pudim'},
    ],
  );
});

test('deduplicação é pelo slug canônico, não pelo texto de exibição', () => {
  // Duas linhas com o MESMO slug (mesma categoria real) mas nome
  // temporariamente divergente (ex.: leitura no meio de uma revalidação)
  // devem contar como uma única categoria — a identidade nunca é o rótulo.
  assert.deepEqual(
    catalogCategories([
      product(1, 'BOLO_NO_POTE', 'Bolo no Pote'),
      product(2, 'BOLO_NO_POTE', 'Bolo no pote (novo nome)'),
    ]),
    [{slug: 'BOLO_NO_POTE', nome: 'Bolo no Pote'}],
    'primeira ocorrência define o rótulo exibido; slug é a chave de identidade',
  );
});

test('navegação não mantém badge mockado em Pedidos', async () => {
  const source = await readFile(
    new URL('../src/admin/components/AdminSidebar.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /badge\s*:\s*4\b/);
  assert.match(source, /item\.to === "\/admin\/notificacoes" \? naoLidas/);
});
