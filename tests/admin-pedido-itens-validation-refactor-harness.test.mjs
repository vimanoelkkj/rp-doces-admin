import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import ts from "typescript";

const path = "functions/api/admin/pedidos/[id]/itens.ts";
const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const validationPath = "functions/lib/pedidoItensValidation.ts";
const validationSource = (await readFile(validationPath, "utf8")).replace(/\r\n/g, "\n");
const bridge = Symbol.for("rp-doces.item-validation-harness");
const key = "Op_12345";
const validPost = { produtoId: 2, quantidade: 1, precoEsperadoCentavos: 100, operationKey: key };
const validPut = { itens: [{ produtoId: 2, quantidade: 1 }] };
const prelude = ["origin", "auth", "annul", "json"];
const replayTrace = [...prelude, "key", "fingerprint", "lookup", "conflict", "snapshot"];
const blocked = {
  error: "A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.",
  code: "EDICAO_ITENS_BLOQUEADA"
};
const annulled = {
  error: "Pedido anulado. O histórico está disponível somente para consulta.",
  code: "PEDIDO_ANULADO"
};

// Only external boundaries are replaced. Validation, identity, replay and HTTP
// responses run from real production modules; nothing is written to disk.
const seams = {
  auth: `
    export const sameOrigin = request => { state().trace.push('origin'); return real.sameOrigin(request); };
    export const requireUser = async () => {
      state().trace.push('auth');
      return state().auth ? { user: { id: 23 } } : { error: Response.json({error:'Não autenticado'}, {status:401}) };
    };`,
  pedidoValido: `
    export const recusarPedidoAnulado = async (_db, id) => {
      state().trace.push('annul'); state().annulId = id;
      return state().annul ? Response.json(state().annulResponse, {status:409}) : null;
    };`,
  pedidoAnulacao: `
    export const temEstornoAnulacaoAtivo = async (_db, id) => {
      state().trace.push('refund'); state().refundId = id; return state().refund;
    };`,
  operacoes: `
    export const parseOperationKey = value => {
      state().trace.push('key'); state().rawKey = value; return real.parseOperationKey(value);
    };
    export const fingerprint = payload => {
      state().trace.push('fingerprint'); state().payload = payload; return real.fingerprint(payload);
    };
    export const buscarOperacao = async (_db, key) => {
      state().trace.push('lookup'); state().lookupKey = key; return state().existing;
    };
    export const conflitoOperacao = (row, identity) => {
      state().trace.push('conflict'); state().identity = identity; return real.conflitoOperacao(row, identity);
    };
    export const parseResultado = row => { state().trace.push('snapshot'); return real.parseResultado(row); };`,
  pricing: `
    export const precoAtualCentavos = product => { state().trace.push('price'); return real.precoAtualCentavos(product); };`
};

async function compile(mutation) {
  const target = mutation?.target ?? validationPath;
  const contents = mutation ? mutation(target === path ? source : validationSource) : null;
  let loaded = 0;
  let validationLoaded = 0;
  const bundle = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "validation-boundaries",
        setup(builder) {
          builder.onLoad({ filter: /[/\\]pedidos[/\\]\[id\][/\\]itens\.ts$/ }, () => {
            loaded++;
            return { contents: target === path && mutation ? contents : source, loader: "ts" };
          });
          builder.onLoad({ filter: /[/\\]pedidoItensValidation\.ts$/ }, () => {
            validationLoaded++;
            return {
              contents: target === validationPath && mutation ? contents : validationSource,
              loader: "ts"
            };
          });
          builder.onResolve(
            { filter: /\/lib\/(auth|pedidoValido|pedidoAnulacao|operacoes|pricing)$/ },
            args => ({
              path: args.path.split("/").at(-1),
              namespace: "validation-boundaries"
            })
          );
          builder.onLoad({ filter: /.*/, namespace: "validation-boundaries" }, args => ({
            contents: `import * as real from './functions/lib/${args.path}.ts';
            export * from './functions/lib/${args.path}.ts';
            const state = () => globalThis[Symbol.for('rp-doces.item-validation-harness')];
            ${seams[args.path]}`,
            resolveDir: process.cwd(),
            loader: "ts"
          }));
        }
      }
    ]
  });
  assert.equal(loaded, 1, "the real handler must be loaded exactly once");
  assert.equal(validationLoaded, 1, "the real validation module must be loaded exactly once");
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

async function call(module, method, body, options = {}) {
  const normalized = options.normalized ?? {
    produtoId: 2,
    quantidade: 1,
    precoEsperadoCentavos: 100
  };
  const snapshot = { pedidoId: 7, item: { id: 11, ...normalized } };
  const state = {
    trace: [],
    writes: [],
    batches: 0,
    queries: [],
    auth: true,
    annul: false,
    refund: false,
    annulResponse: annulled,
    order: {
      id: 7,
      origem_pedido: "MANUAL",
      status_comanda: "ABERTA",
      status_pedido: "NOVO",
      status_pagamento: "PENDENTE"
    },
    product: {
      id: 2,
      nome: "Bolo",
      preco_centavos: 100,
      preco_promocional_centavos: null,
      promocao_ativa: 0,
      promocao_inicio: null,
      promocao_fim: null,
      ativo: 1,
      disponivel: 1,
      estoque: 0,
      estoque_reservado: 0
    },
    existing: {
      operation_key: key,
      tipo: "ITEM_ADICAO_ADMIN",
      escopo: "ADMIN",
      ator_usuario_id: 23,
      fingerprint_versao: 1,
      fingerprint: `1:{"pedidoId":7,"precoEsperadoCentavos":${normalized.precoEsperadoCentavos},"produtoId":${normalized.produtoId},"quantidade":${normalized.quantidade}}`,
      fase: "CONCLUIDA",
      resultado: JSON.stringify(snapshot)
    },
    ...options
  };
  globalThis[bridge] = state;
  const request = new Request("https://local.test/api/admin/pedidos/7/itens", {
    method,
    headers: { Origin: options.origin ?? "https://local.test" }
  });
  request.json = async () => {
    state.trace.push("json");
    if (Object.hasOwn(options, "raw")) return JSON.parse(options.raw);
    return body;
  };
  const db = {
    prepare(sql) {
      if (!/^\s*SELECT\b/i.test(sql)) {
        state.writes.push(sql);
        throw new Error("domain write prohibited in entry scenarios");
      }
      const query = { sql, args: [] };
      state.queries.push(query);
      return {
        bind(...args) {
          query.args = args;
          return this;
        },
        async first() {
          if (/FROM pedidos\b/.test(sql)) {
            state.trace.push("order");
            return state.order;
          }
          if (/FROM produtos\b/.test(sql)) {
            state.trace.push("product");
            return state.product;
          }
          throw new Error(`unexpected query: ${sql}`);
        }
      };
    },
    async batch() {
      state.batches++;
      throw new Error("financial/physical batch prohibited");
    }
  };
  const response = await module[method === "POST" ? "onRequestPost" : "onRequestPut"]({
    request,
    env: { DB: db },
    params: { id: options.id ?? "7" }
  });
  assert.deepEqual(state.writes, [], "entry scenarios must not prepare domain writes");
  assert.equal(state.batches, 0, "entry scenarios must not execute batch");
  return { status: response.status, body: await response.json(), state, snapshot };
}

const scenarios = [];
function responseCase(name, method, body, status, response, trace, options = {}) {
  scenarios.push([
    name,
    async module => {
      const run = await call(module, method, body, options);
      assert.equal(run.status, status);
      assert.deepEqual(run.body, response);
      assert.deepEqual(run.state.trace, trace);
      if (!trace.includes("order")) assert.equal(run.state.queries.length, 0);
      return run;
    }
  ]);
}
function acceptedPost(
  name,
  body,
  normalized = { produtoId: 2, quantidade: 1, precoEsperadoCentavos: 100 }
) {
  scenarios.push([
    name,
    async module => {
      const run = await call(module, "POST", body, { normalized });
      assert.equal(run.status, 201);
      assert.deepEqual(run.body, run.snapshot);
      assert.deepEqual(run.state.trace, replayTrace);
      assert.deepEqual(run.state.payload, { pedidoId: 7, ...normalized });
      assert.deepEqual(run.state.identity, {
        tipo: "ITEM_ADICAO_ADMIN",
        escopo: "ADMIN",
        atorUsuarioId: 23,
        fingerprint: `1:{"pedidoId":7,"precoEsperadoCentavos":${normalized.precoEsperadoCentavos},"produtoId":${normalized.produtoId},"quantidade":${normalized.quantidade}}`
      });
      assert.equal(run.state.lookupKey, key);
      assert.equal(run.state.queries.length, 0);
      assert.equal(run.state.annulId, 7);
    }
  ]);
}

for (const method of ["POST", "PUT"]) {
  const valid = method === "POST" ? validPost : validPut;
  responseCase(
    `${method}: origin precedes auth, ID and JSON`,
    method,
    null,
    403,
    { error: "Origem inválida" },
    ["origin"],
    { origin: "https://other.test", auth: false, annul: true, id: "invalid", raw: "{" }
  );
  responseCase(
    `${method}: auth precedes annulment, ID and body`,
    method,
    null,
    401,
    { error: "Não autenticado" },
    ["origin", "auth"],
    { auth: false, annul: true, id: "invalid", raw: "{" }
  );
  responseCase(
    `${method}: annulment precedes ID and body validation`,
    method,
    null,
    409,
    annulled,
    ["origin", "auth", "annul"],
    { annul: true, raw: "{" }
  );
  for (const id of ["0", "-1", "1.5", "invalid", "Infinity"]) {
    responseCase(
      `${method}: invalid order ID ${id} precedes JSON`,
      method,
      valid,
      400,
      { error: "Id inválido" },
      ["origin", "auth", "annul"],
      { id, raw: "{" }
    );
  }
  for (const raw of ["{", ""])
    responseCase(
      `${method}: malformed JSON ${JSON.stringify(raw)}`,
      method,
      valid,
      400,
      { error: "JSON inválido" },
      prelude,
      { raw }
    );
}

for (const [label, body] of [
  ["null", null],
  ["array", []],
  ["string", "body"],
  ["number", 1],
  ["boolean", true],
  ["empty object", {}],
  ["array with valid properties", Object.assign([], validPost)]
])
  responseCase(
    `POST body: ${label}`,
    "POST",
    body,
    400,
    { error: "Dados do item inválidos" },
    prelude
  );

for (const field of ["produtoId", "quantidade", "precoEsperadoCentavos"]) {
  const missing = { ...validPost };
  delete missing[field];
  responseCase(
    `POST: missing ${field}`,
    "POST",
    missing,
    400,
    { error: "Dados do item inválidos" },
    prelude
  );
  const invalidValues =
    field === "produtoId"
      ? ["2", 0, -1, 1.5, NaN, Infinity]
      : field === "quantidade"
        ? ["1", 1.5, 0, 51, NaN, Infinity]
        : ["100", 1.5, 0, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity];
  for (const value of invalidValues) {
    responseCase(
      `POST ${field}: reject ${String(value)} (${typeof value})`,
      "POST",
      { ...validPost, [field]: value },
      400,
      { error: "Dados do item inválidos" },
      prelude
    );
  }
}
acceptedPost("POST: valid body", validPost);
acceptedPost("POST: normalized key and ignored extra fields", {
  ...validPost,
  operationKey: " \tOp_12345\n",
  extra: { ignored: true }
});
for (const [field, values] of [
  ["produtoId", [1, Number.MAX_SAFE_INTEGER + 1]],
  ["quantidade", [1, 50]],
  ["precoEsperadoCentavos", [1, Number.MAX_SAFE_INTEGER]]
]) {
  for (const value of values) {
    const normalized = { produtoId: 2, quantidade: 1, precoEsperadoCentavos: 100, [field]: value };
    acceptedPost(`POST ${field}: accept ${value}`, { ...validPost, [field]: value }, normalized);
  }
}
for (const operationKey of [undefined, null, "short", 123]) {
  responseCase(
    `POST: invalid operation key ${String(operationKey)}`,
    "POST",
    { ...validPost, operationKey },
    400,
    { error: "Identificação da operação ausente ou inválida", code: "OPERATION_KEY_INVALIDA" },
    [...prelude, "key"]
  );
}
responseCase(
  "POST: invalid numbers precede invalid key",
  "POST",
  { ...validPost, quantidade: 0, operationKey: "bad" },
  400,
  { error: "Dados do item inválidos" },
  prelude
);

scenarios.push([
  "POST: replay wins over refund, order, product and stock guards",
  async module => {
    const run = await call(module, "POST", validPost, { refund: true, order: null, product: null });
    assert.equal(run.status, 201);
    assert.deepEqual(run.body, run.snapshot);
    assert.deepEqual(run.state.trace, replayTrace);
    assert.equal(run.state.queries.length, 0);
  }
]);
const beforeReads = [...prelude, "key", "fingerprint", "lookup", "refund"];
responseCase(
  "POST: refund guard follows A1 lookup",
  "POST",
  validPost,
  409,
  {
    error:
      "Este pedido tem um estorno de exclusão em andamento no Mercado Pago. Nenhuma ação financeira é permitida até a exclusão ser concluída ou o estorno ser recusado.",
    code: "ESTORNO_ANULACAO_ATIVO"
  },
  beforeReads,
  { existing: null, refund: true }
);
const afterReads = [...beforeReads, "order", "product"];
responseCase(
  "POST: missing order guard",
  "POST",
  validPost,
  404,
  { error: "Pedido não encontrado" },
  afterReads,
  { existing: null, order: null, product: null }
);
responseCase(
  "POST: non-editable order guard precedes product",
  "POST",
  validPost,
  409,
  {
    error: "Este pedido não permite adicionar itens no estado atual.",
    code: "PEDIDO_NAO_EDITAVEL"
  },
  afterReads,
  { existing: null, order: { origem_pedido: "SITE" }, product: null }
);
responseCase(
  "POST: missing product guard",
  "POST",
  validPost,
  404,
  { error: "Produto não encontrado" },
  afterReads,
  { existing: null, product: null }
);
responseCase(
  "POST: unavailable product guard",
  "POST",
  validPost,
  409,
  { error: 'Produto "Bolo" indisponível', code: "PRODUTO_INDISPONIVEL" },
  afterReads,
  { existing: null, product: { nome: "Bolo", ativo: 0, disponivel: 0 } }
);
responseCase(
  "POST: current price guard precedes stock",
  "POST",
  { ...validPost, precoEsperadoCentavos: 1 },
  409,
  {
    error: "O preço do produto mudou. Atualize os dados antes de adicionar o item.",
    code: "PRECO_ALTERADO",
    precoAtualCentavos: 100
  },
  [...afterReads, "price"],
  { existing: null }
);
scenarios.push([
  "POST: normalized product reaches reads and quantity reaches stock guard",
  async module => {
    const run = await call(
      module,
      "POST",
      { ...validPost, produtoId: 3, quantidade: 50 },
      { existing: null }
    );
    assert.equal(run.status, 409);
    assert.deepEqual(run.body, {
      error: 'Estoque insuficiente para "Bolo"',
      code: "ESTOQUE_INSUFICIENTE"
    });
    assert.deepEqual(run.state.trace, [...afterReads, "price"]);
    assert.deepEqual(
      run.state.queries.map(query => query.args),
      [[7], [3]]
    );
    assert.deepEqual(run.state.payload, {
      pedidoId: 7,
      produtoId: 3,
      quantidade: 50,
      precoEsperadoCentavos: 100
    });
  }
]);

for (const [label, body] of [
  ["null", null],
  ["array", []],
  ["string", "body"],
  ["number", 1],
  ["boolean", true],
  ["missing itens", {}],
  ["null itens", { itens: null }],
  ["object itens", { itens: {} }],
  ["string itens", { itens: "items" }],
  ["empty itens", { itens: [] }],
  ["array with itens", Object.assign([], validPut)]
])
  responseCase(
    `PUT body: ${label}`,
    "PUT",
    body,
    400,
    { error: "A comanda precisa ter ao menos um item" },
    prelude
  );

for (const [label, item] of [
  ["null", null],
  ["array", []],
  ["string", "item"],
  ["number", 1],
  ["boolean", true],
  ["empty object", {}],
  ["missing product", { quantidade: 1 }],
  ["missing quantity", { produtoId: 2 }],
  ...["2", 0, -1, 1.5, NaN, Infinity].map(value => [
    `product ${String(value)} (${typeof value})`,
    { produtoId: value, quantidade: 1 }
  ]),
  ...["1", 0, -1, 1.5, 51, NaN, Infinity].map(value => [
    `quantity ${String(value)} (${typeof value})`,
    { produtoId: 2, quantidade: value }
  ])
])
  responseCase(
    `PUT item: ${label}`,
    "PUT",
    { itens: [item] },
    400,
    { error: "Item inválido" },
    prelude
  );

for (const [name, body] of [
  ["one item", validPut],
  ["quantity 50", { itens: [{ produtoId: 2, quantidade: 50 }] }],
  ["50 items", { itens: Array(50).fill(validPut.itens[0]) }],
  ["extra fields", { extra: true, itens: [{ produtoId: 2, quantidade: 1, extra: true }] }],
  [
    "repeated products",
    {
      itens: [
        { produtoId: 2, quantidade: 1 },
        { produtoId: 2, quantidade: 50 }
      ]
    }
  ]
]) {
  scenarios.push([
    `PUT valid: ${name}, only order SELECT and no editing`,
    async module => {
      const run = await call(module, "PUT", body);
      assert.equal(run.status, 409);
      assert.deepEqual(run.body, blocked);
      assert.deepEqual(run.state.trace, [...prelude, "order"]);
      assert.deepEqual(run.state.queries, [
        { sql: "SELECT id FROM pedidos WHERE id = ?", args: [7] }
      ]);
    }
  ]);
}
responseCase(
  "PUT: 51 valid items",
  "PUT",
  { itens: Array(51).fill(validPut.itens[0]) },
  400,
  { error: "Itens demais" },
  prelude
);
responseCase(
  "PUT: 51 invalid items still fail the count first",
  "PUT",
  { itens: Array(51).fill(null) },
  400,
  { error: "Itens demais" },
  prelude
);
responseCase(
  "PUT: missing order after valid body",
  "PUT",
  validPut,
  404,
  { error: "Pedido não encontrado" },
  [...prelude, "order"],
  { order: null }
);
responseCase(
  "PUT: invalid body precedes missing-order lookup",
  "PUT",
  null,
  400,
  { error: "A comanda precisa ter ao menos um item" },
  prelude,
  { order: null }
);

function replaceOnce(contents, from, to) {
  assert.equal(contents.split(from).length - 1, 1, "mutation anchor must occur exactly once");
  return contents.replace(from, to);
}
function replace(from, to, target = validationPath) {
  const mutation = contents => replaceOnce(contents, from, to);
  mutation.target = target;
  return mutation;
}
function handlerMutation(mutation) {
  mutation.target = path;
  return mutation;
}
function statements(contents, handler) {
  const ast = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
  const declaration =
    ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === handler) ??
    ast.statements
      .flatMap(node => (ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []))
      .find(node => node.name.getText(ast) === handler);
  const body = declaration?.body ?? declaration?.initializer?.body;
  assert.ok(body, "function mutation anchor must exist");
  return { ast, nodes: body.statements };
}
function moveKeyBeforeNumbers(contents) {
  const { ast, nodes } = statements(contents, "onRequestPost");
  const keyNode = nodes.find(node => node.getText(ast).startsWith("const chave ="));
  const keyIndex = nodes.indexOf(keyNode);
  const numericNode = nodes.find(
    node =>
      ts.isVariableStatement(node) &&
      node.getText(ast).startsWith("const validacao = validarAdicionarItemBody(")
  );
  assert.ok(keyNode && numericNode && nodes[keyIndex + 1]);
  const keyBlock = contents
    .slice(keyNode.getStart(ast), nodes[keyIndex + 1].end)
    .replace("body.operationKey", "body?.operationKey");
  const start = numericNode.getStart(ast);
  return (
    contents.slice(0, start) +
    keyBlock +
    "\n" +
    contents.slice(start, keyNode.getStart(ast)) +
    contents.slice(nodes[keyIndex + 1].end)
  );
}
function acceptPostPrimitives(contents) {
  const { ast, nodes } = statements(contents, "onRequestPost");
  const parsing = nodes.find(
    node => ts.isTryStatement(node) && node.getText(ast).includes("body = await request.json();")
  );
  assert.ok(parsing, "POST parsing mutation anchor must exist");
  const changed = replaceOnce(
    parsing.getText(ast),
    "body = await request.json();",
    `body = await request.json();
     if (!body || typeof body !== "object" || Array.isArray(body)) {
       body = { produtoId: 2, quantidade: 1, precoEsperadoCentavos: 100, operationKey: "Op_12345" };
     }`
  );
  return contents.slice(0, parsing.getStart(ast)) + changed + contents.slice(parsing.end);
}
function reorderPutCount(contents) {
  const { ast, nodes } = statements(contents, "validarEditarItensBody");
  const count = nodes.find(
    node =>
      ts.isIfStatement(node) &&
      node.expression.getText(ast) === "body.itens.length > MAX_ITENS_PER_PEDIDO"
  );
  const items = nodes.find(
    node => ts.isIfStatement(node) && node.expression.getText(ast).includes("body.itens.every")
  );
  assert.ok(count && items);
  return (
    contents.slice(0, count.getStart(ast)) +
    items.getText(ast) +
    "\n" +
    count.getText(ast) +
    contents.slice(items.end)
  );
}
function earlyValidation(handler, before) {
  return handlerMutation(contents => {
    const { ast, nodes } = statements(contents, handler);
    const start = nodes.find(
      node => ts.isVariableStatement(node) && node.getText(ast).startsWith("let body:")
    );
    const end =
      handler === "onRequestPost"
        ? nodes
            .find(
              node => ts.isVariableStatement(node) && node.getText(ast).startsWith("const chave =")
            )
            .getStart(ast)
        : nodes
            .find(
              node =>
                ts.isTryStatement(node) &&
                node.getText(ast).includes("const pedido = await env.DB.prepare")
            )
            .getStart(ast);
    const anchor = nodes.find(
      node => ts.isVariableStatement(node) && node.getText(ast).startsWith(`const ${before} =`)
    );
    assert.ok(start && anchor && end > start.getStart(ast));
    const block = contents.slice(start.getStart(ast), end);
    return (
      contents.slice(0, anchor.getStart(ast)) +
      block +
      contents.slice(anchor.getStart(ast), start.getStart(ast)) +
      contents.slice(end)
    );
  });
}
const mutations = [
  [
    "coerce POST numeric string",
    replace("const produtoId = entrada.produtoId;", "const produtoId = Number(entrada.produtoId);")
  ],
  ["accept POST float", replace("!Number.isInteger(produtoId)", "!Number.isFinite(produtoId)")],
  ["increase POST quantity limit", replace("Number(quantidade) > 50", "Number(quantidade) > 51")],
  [
    "accept zero expected price",
    replace("Number(precoEsperadoCentavos) < 1", "Number(precoEsperadoCentavos) < 0")
  ],
  [
    "use integer instead of safe integer",
    replace(
      "!Number.isSafeInteger(precoEsperadoCentavos)",
      "!Number.isInteger(precoEsperadoCentavos)"
    )
  ],
  [
    "accept POST array",
    replace(
      '!body || typeof body !== "object" || Array.isArray(body)',
      '!body || typeof body !== "object"'
    )
  ],
  ["accept POST primitives", handlerMutation(acceptPostPrimitives)],
  [
    "change POST message",
    replace(
      'return { ok: false, error: "Dados do item inválidos", status: 400 };\n  }\n  const entrada',
      'return { ok: false, error: "Item inválido", status: 400 };\n  }\n  const entrada'
    )
  ],
  [
    "change POST status",
    replace(
      'return { ok: false, error: "Dados do item inválidos", status: 400 };\n  }\n  const entrada',
      'return { ok: false, error: "Dados do item inválidos", status: 422 };\n  }\n  const entrada'
    )
  ],
  [
    "add code to structural error",
    replace(
      'return { ok: false, error: "Dados do item inválidos", status: 400 };\n  }\n  const entrada',
      'return { ok: false, error: "Dados do item inválidos", status: 400, code: "ITEM_INVALIDO" };\n  }\n  const entrada'
    )
  ],
  ["key parsing before numeric validation", handlerMutation(moveKeyBeforeNumbers)],
  ["PUT items before array count", reorderPutCount],
  [
    "relax PUT product",
    replace("Number.isInteger(i.produtoId)", "Number.isFinite(Number(i.produtoId))")
  ],
  ["relax PUT quantity", replace("i.quantidade <= 50", "i.quantidade <= 51")],
  [
    "increase PUT array limit",
    replace("const MAX_ITENS_PER_PEDIDO = 50;", "const MAX_ITENS_PER_PEDIDO = 51;")
  ],
  [
    "change PUT blocked code",
    replace('code: "EDICAO_ITENS_BLOQUEADA"', 'code: "EDICAO_LIBERADA"', path)
  ],
  ["accept PUT body array", replace("    Array.isArray(body) ||\n", "")],
  ["POST validation before auth", earlyValidation("onRequestPost", "auth")],
  ["POST validation before annulment", earlyValidation("onRequestPost", "anulado")],
  ["PUT validation before auth", earlyValidation("onRequestPut", "auth")],
  ["PUT validation before annulment", earlyValidation("onRequestPut", "anulado")],
  [
    "replay after mutable refund guard",
    handlerMutation(contents => {
      const from =
        "    const existente = await buscarOperacao(env.DB, operationKey);\n    if (existente) return await replayAdicionarItem(env.DB, existente, identidade);\n";
      const removed = replaceOnce(contents, from, "");
      const anchor =
        "    const [pedido, produto] = await Promise.all([\n      carregarPedido(env.DB, pedidoId),";
      return replaceOnce(removed, anchor, from + anchor);
    })
  ]
];

test("Admin order item validation characterization", async t => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("network prohibited");
  });
  t.mock.method(console, "error", () => {});
  t.after(() => {
    delete globalThis[bridge];
  });
  const module = await compile();
  for (const [name, contract] of scenarios) await t.test(name, () => contract(module));
  for (const [name, mutation] of mutations) {
    await t.test(`negative control: ${name}`, async () => {
      for (const [, contract] of scenarios) await contract(module);
      // Missing anchors and compilation errors fail here, outside detection.
      const mutant = await compile(mutation);
      const failures = [];
      for (const [scenario, contract] of scenarios) {
        try {
          await contract(mutant);
        } catch (error) {
          assert.equal(error.code, "ERR_ASSERTION", `${scenario} must fail behaviorally`);
          failures.push(scenario);
        }
      }
      assert.ok(failures.length > 0, "mutation must reach a behavioral assertion failure");
    });
  }
  assert.equal(network.mock.callCount(), 0);
});
