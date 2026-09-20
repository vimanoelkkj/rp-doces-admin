import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/b3.mjs';

const mutation = (path, method = 'POST') => new Request(`https://local.test${path}`, {
  method,
  headers: {
    Origin: 'https://attacker.invalid',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});

test('todas as mutações da Comanda Viva recusam origem cruzada antes de tocar o banco', async () => {
  const db = {
    prepare() {
      throw new Error('a origem cruzada alcançou o banco');
    },
  };
  const env = {DB: db, MP_ACCESS_TOKEN: 'unused'};
  const cases = [
    ['criar pedido', app.admin.onRequestPost, '/api/admin/pedidos', 'POST', {}],
    ['alterar status', app.adminOrder.onRequestPatch, '/api/admin/pedidos/1', 'PATCH', {id: '1'}],
    ['adicionar item', app.adminItems.onRequestPost, '/api/admin/pedidos/1/itens', 'POST', {id: '1'}],
    ['edição integral bloqueada', app.adminItems.onRequestPut, '/api/admin/pedidos/1/itens', 'PUT', {id: '1'}],
    ['registrar pagamento', app.adminPayment.onRequestPost, '/api/admin/pedidos/1/pagamentos', 'POST', {id: '1'}],
    ['gerar Pix', app.adminPix.onRequestPost, '/api/admin/pedidos/1/pix', 'POST', {id: '1'}],
    ['refund genérico', app.adminRefund.onRequestPost, '/api/admin/pedidos/1/reembolsos', 'POST', {id: '1'}],
    ['cancelar item', app.adminItemCancellation.onRequestPost, '/api/admin/pedidos/1/itens/1/cancelamentos', 'POST', {id: '1', itemId: '1'}],
    ['trocar item', app.adminItemExchange.onRequestPost, '/api/admin/pedidos/1/itens/1/trocas', 'POST', {id: '1', itemId: '1'}],
    ['refund de cancelamento', app.adminItemCancellationRefund.onRequestPost, '/api/admin/pedidos/1/cancelamentos/1/reembolsos', 'POST', {id: '1', cancelamentoId: '1'}],
    ['refund de troca', app.adminItemExchangeRefund.onRequestPost, '/api/admin/pedidos/1/trocas/1/reembolsos', 'POST', {id: '1', trocaId: '1'}],
  ];

  for (const [name, handler, path, method, params] of cases) {
    const response = await handler({request: mutation(path, method), env, params});
    assert.equal(response.status, 403, name);
  }
});
