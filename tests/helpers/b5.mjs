import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

// Harness do B5: monta um D1 LOCAL e descartável com a TOPOLOGIA do banco
// histórico de produção (tests/fixtures/producao-simulada.sql), popula dados
// SINTÉTICOS com as mesmas contagens observadas na auditoria, e permite
// aplicar `scripts/b5-production-compat.sql` como o cutover faria.
//
// Nenhum acesso remoto, nenhum dado pessoal real. O objetivo é provar o
// script e os handlers contra o schema que produção realmente tem.

// Mesmo bridge do harness B3: SQL roda em workerd/D1 de verdade, não num
// motor simulado — constraints, CHECKs e rollback de batch são reais.
const bridge = `export default { async fetch(request, env) {
  const { statements } = await request.json();
  try {
    const results = await env.DB.batch(statements.map(s => env.DB.prepare(s.sql).bind(...s.args)));
    return Response.json({ results });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}}`;

function separarStatements(sql) {
  return (sql.replace(/--[^\n]*/g, '')
    .match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? [])
    .map(s => s.trim())
    .filter(Boolean);
}

export const SCHEMA_PRODUCAO = separarStatements(
  await readFile('tests/fixtures/producao-simulada.sql', 'utf8'),
);
export const SCRIPT_B5 = separarStatements(
  await readFile('scripts/b5-production-compat.sql', 'utf8'),
);
export const VALIDACAO_B5 = separarStatements(
  await readFile('scripts/b5-production-validate.sql', 'utf8'),
);

function criarDb(mf) {
  const db = {
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
    async send(statements) {
      const response = await mf.dispatchFetch('http://local.test/sql', {
        method: 'POST',
        body: JSON.stringify({ statements: statements.map(({ sql, args }) => ({ sql, args })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result.results;
    },
    batch(statements) { return db.send(statements, 'batch'); },
  };
  return db;
}

/**
 * Banco com o schema histórico de produção e dados sintéticos.
 * `popular: false` deixa o banco vazio (para testes de schema puro).
 */
export async function bancoProducao(t, { popular = true } = {}) {
  const mf = new Miniflare({
    modules: true, script: bridge, cf: false,
    d1Databases: ['DB'], d1Persist: false,
  });
  t.after(() => mf.dispose());
  const db = criarDb(mf);
  for (const sql of SCHEMA_PRODUCAO) await db.prepare(sql).run();
  if (popular) await popularHistorico(db);
  return db;
}

/** Aplica o script de compatibilidade, statement a statement, como o cutover. */
export async function aplicarB5(db) {
  for (const sql of SCRIPT_B5) await db.prepare(sql).run();
}

/** Roda a validação e devolve as linhas de verificacao/resultado. */
export async function validarB5(db) {
  const linhas = [];
  for (const sql of VALIDACAO_B5) {
    const { results } = await db.prepare(sql).all();
    linhas.push(...results);
  }
  return linhas;
}

// ─────────────────────────── dados sintéticos ───────────────────────────
//
// Reproduz as contagens exatas da auditoria (5 produtos, 3 categorias,
// 26 pedidos, 34 itens, 27 pagamentos, 35 alocações, 0 reembolsos) e, mais
// importante, os ESTADOS observados — inclusive o pedido inconsistente.
//
// Os seis primeiros pedidos são os casos nomeados; os vinte seguintes são
// preenchimento genérico para bater o volume real sem inventar topologia
// nova. Volume importa aqui porque as contagens são justamente a prova de
// preservação na simulação do cutover.

async function popularHistorico(db) {
  const stmts = [];
  const add = (sql, ...args) => stmts.push(db.prepare(sql).bind(...args));

  for (const [id, nome] of [['BOLO', 'Bolos'], ['DOCE', 'Doces'], ['TORTA', 'Tortas']]) {
    add(`INSERT INTO categorias(id,nome,sistema) VALUES(?,?,1)`, id, nome);
  }
  // estoque total 27, reservado 0 — como observado.
  for (const [id, cat, preco, estoque] of [
    [1, 'BOLO', 5000, 10], [2, 'DOCE', 300, 8], [3, 'TORTA', 7000, 5],
    [4, 'BOLO', 4500, 3], [5, 'DOCE', 250, 1],
  ]) {
    add(`INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado)
         VALUES(?,?,?,?,?,0)`, id, `Produto ${id}`, cat, preco, estoque);
  }
  add(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
       VALUES(1,'Operadora','op','op@example.invalid','unused','OWNER')`);
  add(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
       VALUES(2,'Admin 2','a2','a2@example.invalid','unused','ADMIN')`);
  add(`INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel)
       VALUES(3,'Admin 3','a3','a3@example.invalid','unused','ADMIN')`);
  add(`INSERT INTO configuracoes_loja(chave,valor) VALUES('loja_aberta','1')`);

  // Pedido histórico: PAGO + ENTREGUE + comanda ENCERRADA, como os 26 reais.
  const pedido = (id, origem, reserva, baixado, mpId = null) =>
    add(`INSERT INTO pedidos(id, token_publico, produto_nome, quantidade,
           valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
           cliente_whatsapp, idempotency_key, status_pagamento, status_pedido,
           status_comanda, origem_pedido, reserva_status, estoque_baixado_em, mp_payment_id)
         VALUES(?, ?, '', 1, 0, 0, ?, '', '000', ?, 'PAGO', 'ENTREGUE',
                'ENCERRADA', ?, ?, ?, ?)`,
      id, `tok-${id}`, `Cliente ${id}`, `hist-${id}`, origem, reserva, baixado, mpId);

  const item = (id, pedidoId, produtoId, qtd, unit) =>
    add(`INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,
           valor_unitario_centavos,valor_total_centavos,estoque_baixado_em)
         VALUES(?,?,?,?,?,?,?, '2026-01-01 00:00:00')`,
      id, pedidoId, produtoId, `Produto ${produtoId}`, qtd, unit, qtd * unit);

  const pagamento = (id, pedidoId, metodo, origem, valor, status, mpId = null) =>
    add(`INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
           mp_payment_id,idempotency_key,pago_em)
         VALUES(?,?,?,?,?,?,?,?, CASE WHEN ?='PAGO' THEN '2026-01-01 00:00:00' ELSE NULL END)`,
      id, pedidoId, metodo, origem, valor, status, mpId, `pag-${id}`, status);

  const alocacao = (id, pagamentoId, itemId, valor) =>
    add(`INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
         VALUES(?,?,?,?)`, id, pagamentoId, itemId, valor);

  // 1 — SITE histórico, PIX_MP pago, 1 item.
  pedido(1, 'SITE', 'CONVERTIDA', '2026-01-01 00:00:00', '90001');
  item(1, 1, 1, 1, 5000); pagamento(1, 1, 'PIX_MP', 'SITE', 5000, 'PAGO', '90001');
  alocacao(1, 1, 1, 5000);

  // 2 — SITE histórico com MÚLTIPLOS itens.
  pedido(2, 'SITE', 'CONVERTIDA', '2026-01-02 00:00:00', '90002');
  item(2, 2, 1, 1, 5000); item(3, 2, 2, 2, 300);
  pagamento(2, 2, 'PIX_MP', 'SITE', 5600, 'PAGO', '90002');
  alocacao(2, 2, 2, 5000); alocacao(3, 2, 3, 600);

  // 3 — MANUAL histórico, pagamento manual em dinheiro.
  pedido(3, 'MANUAL', 'CONVERTIDA', '2026-01-03 00:00:00');
  item(4, 3, 3, 1, 7000); pagamento(3, 3, 'DINHEIRO', 'ADMIN', 7000, 'PAGO');
  alocacao(4, 3, 4, 7000);

  // 4 — MANUAL com múltiplos itens e PIX externo.
  pedido(4, 'MANUAL', 'CONVERTIDA', '2026-01-04 00:00:00');
  item(5, 4, 1, 1, 5000); item(6, 4, 4, 1, 4500);
  pagamento(4, 4, 'PIX_EXTERNO', 'ADMIN', 9500, 'PAGO');
  alocacao(5, 4, 5, 5000); alocacao(6, 4, 6, 4500);

  // 5 — O PEDIDO INCONSISTENTE observado em produção:
  //     reserva ATIVA, pedidos.estoque_baixado_em NULL, itens já baixados,
  //     estoque_reservado global = 0.
  pedido(5, 'MANUAL', 'ATIVA', null);
  item(7, 5, 2, 1, 300); pagamento(5, 5, 'DINHEIRO', 'ADMIN', 300, 'PAGO');
  alocacao(7, 5, 7, 300);

  // 6 — MANUAL com dois pagamentos: um CANCELADO e um PAGO (cartão).
  pedido(6, 'MANUAL', 'CONVERTIDA', '2026-01-06 00:00:00');
  item(8, 6, 3, 1, 7000); item(9, 6, 5, 1, 250);
  pagamento(6, 6, 'A_COMBINAR', 'ADMIN', 7250, 'CANCELADO');
  pagamento(7, 6, 'CARTAO', 'ADMIN', 7250, 'PAGO');
  alocacao(8, 7, 8, 7000); alocacao(9, 7, 9, 250);
  // A tentativa cancelada preserva sua alocação histórica: é o que explica
  // produção ter mais alocações (35) do que itens (34).
  alocacao(10, 6, 8, 7000);

  // 7..26 — preenchimento até as contagens reais: 26 pedidos, 34 itens,
  // 27 pagamentos, 35 alocações. Cinco deles têm 2 itens.
  let itemId = 10, pagId = 8, alocId = 11;
  for (let p = 7; p <= 26; p++) {
    pedido(p, p % 3 === 0 ? 'SITE' : 'MANUAL', 'CONVERTIDA', '2026-02-01 00:00:00');
    const doisItens = p >= 22; // 5 pedidos com 2 itens
    const i1 = itemId++;
    item(i1, p, 2, 1, 300);
    let total = 300;
    let i2 = null;
    if (doisItens) { i2 = itemId++; item(i2, p, 5, 1, 250); total += 250; }
    pagamento(pagId, p, 'PIX_EXTERNO', 'ADMIN', total, 'PAGO');
    alocacao(alocId++, pagId, i1, 300);
    if (i2) alocacao(alocId++, pagId, i2, 250);
    pagId++;
  }

  // Alinha o total do pedido com a soma real dos itens (invariante que a
  // validação confere), sem tocar em nada mais.
  add(`UPDATE pedidos SET valor_total_centavos = (
         SELECT COALESCE(SUM(valor_total_centavos),0) FROM pedido_itens WHERE pedido_id = pedidos.id)`);

  for (const stmt of stmts) await stmt.run();
  return db;
}

/** Fotografia completa do banco, para comparar ESTADO A × ESTADO B. */
export async function snapshot(db) {
  const tabelas = ['produtos', 'categorias', 'pedidos', 'pedido_itens', 'pedido_pagamentos',
    'pedido_pagamento_alocacoes', 'pedido_reembolsos', 'usuarios_admin', 'configuracoes_loja'];
  const dados = {};
  for (const t of tabelas) {
    const chave = t === 'configuracoes_loja' ? 'chave' : 'id';
    dados[t] = (await db.prepare(`SELECT * FROM ${t} ORDER BY ${chave}`).all()).results;
  }
  dados.__objetos = (await db.prepare(
    `SELECT type, name FROM sqlite_master ORDER BY type, name`).all()).results;
  dados.__fk = (await db.prepare(`SELECT COUNT(*) AS n FROM pragma_foreign_key_check`).first()).n;
  return dados;
}
