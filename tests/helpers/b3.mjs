import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Bundle real production modules in memory; no test endpoints in functions/.
const bundle = await build({
  stdin: {
    contents: `
      export * as reconcile from './functions/lib/pedidoReconcile';
      export * as ledger from './functions/lib/comandaLedger';
      export * as sync from './functions/lib/paymentSync';
      export * as stock from './functions/lib/stock';
      export * as auth from './functions/lib/auth';
      export * as webhook from './functions/api/webhooks/mercadopago';
      export * as polling from './functions/api/pedido-status';
      export * as detail from './functions/api/pedido';
      export * as admin from './functions/api/admin/pedidos';
      export * as adminPayment from './functions/api/admin/pedidos/[id]/pagamentos';
      export * as adminRefund from './functions/api/admin/pedidos/[id]/reembolsos';
      export * as checkout from './functions/api/checkout';
      export * as adminPix from './functions/api/admin/pedidos/[id]/pix';
      export * as pix from './functions/lib/comandaPix';
      export * as adminOrder from './functions/api/admin/pedidos/[id]';
      export * as adminItems from './functions/api/admin/pedidos/[id]/itens';
      export * as operacoes from './functions/lib/operacoes';
      export * as mpPost from './functions/lib/mpPost';
      export * as adminCreate from './functions/api/admin/pedidos';
      export * as promocao from './shared/promocao';
      export * as produtos from './functions/api/produtos';
      export * as adminProdutos from './functions/api/admin/produtos';
      export * as adminProdutoId from './functions/api/admin/produtos/[id]';
      export * as notificacoes from './functions/lib/notificacoes';
      export * as adminNotificacoes from './functions/api/admin/notificacoes';
      export * as diagnosticoPix from './functions/api/admin/diagnosticos/pix';
      export * as diagnosticoPedidoTeste from './functions/api/admin/diagnosticos/pedido-teste';
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const source = `${bundle.outputFiles[0].text}\n//# sourceURL=rp-doces-b3-bundle.mjs`;
export const app = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const migrations = [];
for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) {
  const sql = (await readFile(`migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '');
  // These migrations have no semicolons in literals. Preserve trigger bodies.
  migrations.push(...(sql.match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? [])
    .map(s => s.trim()).filter(Boolean));
}

// Only local HTTP dispatch: avoids Miniflare's synchronous getD1Database proxy.
// SQL, constraints and batch rollback run in workerd/D1, not a fake SQL engine.
const bridge = `export default { async fetch(request, env) {
  const { statements } = await request.json();
  try {
    const results = await env.DB.batch(statements.map(s => env.DB.prepare(s.sql).bind(...s.args)));
    return Response.json({ results });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}}`;

export async function fixture(t, { paid = false, reserve = 'ATIVA', ledger = true } = {}) {
  // Rede MP simulada; a autoridade continua nascendo no GET de produção.
  t.mock.method(globalThis, 'fetch', async url => {
    if (!String(url).startsWith('https://api.mercadopago.com/v1/payments/')) throw new Error('unexpected network');
    return Response.json({id: Number(String(url).split('/').at(-1)), status: 'approved'});
  });
  const mf = new Miniflare({
    modules: true, script: bridge, cf: false,
    d1Databases: ['DB'], d1Persist: false,
  });
  t.after(() => mf.dispose());
  const db = {
    hook: null,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async all() { return (await db.send([this], 'all'))[0]; },
        async first(column) {
          const row = (await db.send([this], 'first'))[0].results[0] ?? null;
          return column ? row?.[column] ?? null : row;
        },
        async run() { return (await db.send([this], 'run'))[0]; },
      };
    },
    async send(statements, operation) {
      let wire = statements.map(({ sql, args }) => ({ sql, args }));
      if (db.hook) wire = await db.hook(wire, operation) ?? wire;
      const response = await mf.dispatchFetch('http://local.test/sql', {
        method: 'POST', body: JSON.stringify({ statements: wire }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result.results;
    },
    batch(statements) { return db.send(statements, 'batch'); },
  };
  // Fresh schema only; no access to .wrangler, .dev.vars or remote bindings.
  for (const sql of migrations) await db.prepare(sql).run();
  await db.batch([
    db.prepare(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
      VALUES(1,'Teste','teste','teste@example.invalid','unused','OWNER')`),
    db.prepare(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado)
      VALUES(1,'Bolo','BOLO',5000,10,?)`).bind(reserve === 'ATIVA' ? 2 : 0),
    db.prepare(`INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,
      idempotency_key,reserva_status,mp_payment_id,pix_expira_em)
      VALUES(1,'token','Teste','000',10000,'pedido-1',?,'101','2099-01-01T00:00:00Z')`).bind(reserve),
    db.prepare(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos) VALUES(1,1,1,'Bolo',2,5000,10000)`),
  ]);
  if (ledger) await db.batch([
    db.prepare(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
      mp_payment_id,idempotency_key) VALUES(1,1,'PIX_MP','SITE',10000,?,'101','pagamento-1')`).bind(paid ? 'PAGO' : 'PENDENTE'),
    db.prepare(`INSERT INTO pedido_pagamento_alocacoes(pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,10000)`),
  ]);
  return db;
}

export async function state(db) {
  return {
    pedido: await db.prepare('SELECT * FROM pedidos WHERE id=1').first(),
    produtos: (await db.prepare('SELECT * FROM produtos ORDER BY id').all()).results,
    itens: (await db.prepare('SELECT * FROM pedido_itens ORDER BY id').all()).results,
    pagamentos: (await db.prepare('SELECT * FROM pedido_pagamentos ORDER BY id').all()).results,
    alocacoes: (await db.prepare('SELECT * FROM pedido_pagamento_alocacoes ORDER BY id').all()).results,
    refunds: (await db.prepare('SELECT * FROM pedido_reembolsos ORDER BY id').all()).results,
    operacoes: (await db.prepare('SELECT * FROM pedido_operacoes ORDER BY id').all()).results,
  };
}

export function barrier(parties) {
  let arrived = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return async () => { if (++arrived === parties) release(); await gate; };
}

export const isProjection = sql => sql.includes('UPDATE pedidos AS p');
export const isPhysical = statements => statements.some(s => s.sql.includes('estoque = estoque -'));

export async function refund(db, amount) {
  await db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,
    status,idempotency_key) VALUES(1,1,'MANUAL','DINHEIRO',?,'REEMBOLSADO',?)`)
    .bind(amount, `refund-${amount}`).run();
}
