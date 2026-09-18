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

const product = (id, category) => ({
  id,
  name: `Produto ${id}`,
  category,
  price: 10,
  image: '',
});

test('cardápio deriva categorias dos produtos públicos sem lista fixa', () => {
  assert.deepEqual(
    catalogCategories([
      product(1, 'Bolo no Pote'),
      product(2, 'Brigadeiros'),
      product(3, 'Bolo no Pote'),
      product(4, '  Mini Pudim  '),
      product(5, '   '),
    ]),
    ['Bolo no Pote', 'Brigadeiros', 'Mini Pudim'],
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
