import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { app, fixture } from "./helpers/b3.mjs";

// Real endpoint and auth. Controlled query results characterize transformation;
// disposable D1 scenarios below separately exercise the actual SQL filters.
// Negative controls mutate loaded production modules only in memory, allowing
// the transformation to move to a helper without coupling assertions to a path.
async function compile(mutation) {
  let replacements = 0;
  const result = await build({
    stdin: {
      contents: "export { onRequestGet } from './functions/api/admin/pedidos/[id]/historico';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: mutation
      ? [
          {
            name: "in-memory-negative-control",
            setup(api) {
              api.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
                const contents = await readFile(path, "utf8");
                if (!contents.includes(mutation.from)) return null;
                replacements++;
                return { contents: contents.replace(mutation.from, mutation.to), loader: "ts" };
              });
            }
          }
        ]
      : []
  });
  if (mutation) assert.equal(replacements, 1, `Unique mutation anchor: ${mutation.name}`);
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const endpoint = await compile();
const date = "2026-01-01 10:00:00";
const empty = () => ({
  items: [],
  exchanges: [],
  cancellations: [],
  cancellationRefunds: [],
  exchangeRefunds: [],
  payments: [],
  refunds: [],
  void: null
});
const exchangeRow = (changes = {}) => ({
  id: 20,
  item_origem_id: 10,
  item_destino_id: 11,
  produto_destino_id: 2,
  quantidade_destino: 2,
  valor_origem_centavos: 101,
  valor_destino_centavos: 200,
  diferenca_centavos: 99,
  tipo_diferenca: "POSITIVA",
  estoque_acao_origem: "NAO_REPOR",
  status: "CONCLUIDA",
  motivo: "troca",
  criado_em: "2026-01-03 10:00:00",
  concluido_em: "2026-01-04 10:00:00",
  origem_nome: "Bolo",
  origem_estoque_estado: "BAIXADO",
  destino_nome: "Torta",
  destino_estoque_estado: "RESERVADO",
  produto_destino_nome: "Produto atual",
  usuario_nome: "Ana",
  ...changes
});
const cancellationRow = (changes = {}) => ({
  id: 30,
  pedido_item_id: 12,
  status: "CONCLUIDO",
  estoque_acao: "REPOR",
  motivo: "cancelamento",
  valor_item_centavos: 101,
  criado_em: "2026-01-05 10:00:00",
  concluido_em: "2026-01-06 10:00:00",
  item_nome: "Doce",
  item_estoque_estado: "REPOSTO",
  usuario_nome: "Ana",
  ...changes
});
const paymentRow = (changes = {}) => ({
  id: 40,
  metodo: "DINHEIRO",
  valor_centavos: 1,
  pago_em: "2026-01-07 10:00:00",
  usuario_nome: null,
  ...changes
});
const refundRow = (changes = {}) => ({
  id: 50,
  metodo: "PIX_EXTERNO",
  valor_centavos: 99,
  motivo: "cortesia",
  data: "2026-01-08 10:00:00",
  usuario_nome: null,
  ...changes
});
const itemRow = (changes = {}) => ({
  id: 10,
  produto_nome: "Bolo",
  quantidade: 3,
  valor_total_centavos: 101,
  data: "2026-01-02 10:00:00",
  usuario_nome: "Ana",
  ...changes
});
const voidRow = () => ({
  id: 60,
  pedido_id: 1,
  criado_em: "2026-01-09 10:00:00",
  motivo: "",
  usuario_nome: "Ana",
  estoque_acao: "MANTER",
  liquido_original_centavos: 101
});

// Explicit expected JSON, independent of the production builders.
const exchangeEvents = (baseChanges = {}, requestedChanges = {}, completed = true) => {
  const base = {
    itemOrigem: { id: 10, nome: "Bolo", valorCentavos: 101, estoqueEstado: "BAIXADO" },
    itemDestino: {
      id: 11,
      nome: "Torta",
      quantidade: 2,
      valorCentavos: 200,
      estoqueEstado: "RESERVADO"
    },
    valorOrigemCentavos: 101,
    valorDestinoCentavos: 200,
    diferencaCentavos: 99,
    tipoDiferenca: "POSITIVA",
    estoqueAcao: "NAO_REPOR",
    motivo: "troca",
    usuario: "Ana",
    referenciaId: 10,
    ...baseChanges
  };
  const requested = {
    id: "troca-solicitada-20",
    tipo: "TROCA_SOLICITADA",
    data: "2026-01-03 10:00:00",
    titulo: "Troca solicitada",
    status: null,
    ...base,
    ...requestedChanges
  };
  return completed
    ? [
        {
          id: "troca-concluida-20",
          tipo: "TROCA_CONCLUIDA",
          data: "2026-01-04 10:00:00",
          titulo: "Troca concluída",
          status: "CONCLUIDA",
          ...base
        },
        requested
      ]
    : [requested];
};
const cancellationEvents = (baseChanges = {}, requestedChanges = {}, completed = true) => {
  const base = {
    item: { id: 12, nome: "Doce", valorCentavos: 101, estoqueEstado: "REPOSTO" },
    estoqueAcao: "REPOR",
    motivo: "cancelamento",
    usuario: "Ana",
    referenciaId: 12,
    ...baseChanges
  };
  const requested = {
    id: "cancelamento-solicitado-30",
    tipo: "CANCELAMENTO_SOLICITADO",
    data: "2026-01-05 10:00:00",
    titulo: "Cancelamento solicitado",
    status: null,
    ...base,
    ...requestedChanges
  };
  return completed
    ? [
        {
          id: "cancelamento-concluido-30",
          tipo: "CANCELAMENTO_CONCLUIDO",
          data: "2026-01-06 10:00:00",
          titulo: "Cancelamento concluído",
          status: "CONCLUIDO",
          ...base
        },
        requested
      ]
    : [requested];
};
const itemEvent = (changes = {}) => ({
  id: "item-10",
  tipo: "ITEM_ADICIONADO",
  data: "2026-01-02 10:00:00",
  titulo: "Bolo adicionado",
  item: { id: 10, nome: "Bolo", quantidade: 3, valorCentavos: 101 },
  usuario: "Ana",
  referenciaId: 10,
  ...changes
});
const paymentEvent = (changes = {}) => ({
  id: "pagamento-40",
  tipo: "PAGAMENTO",
  data: "2026-01-07 10:00:00",
  titulo: "Pagamento registrado",
  metodo: "DINHEIRO",
  valorCentavos: 1,
  usuario: null,
  referenciaId: 40,
  ...changes
});
const refundEvent = (changes = {}) => ({
  id: "reembolso-50",
  tipo: "REEMBOLSO",
  data: "2026-01-08 10:00:00",
  titulo: "Reembolso confirmado",
  metodo: "PIX_EXTERNO",
  valorReembolsoCentavos: 99,
  motivo: "cortesia",
  usuario: null,
  referenciaId: 50,
  ...changes
});
const voidEvent = (changes = {}) => ({
  id: "anulacao-60",
  tipo: "PEDIDO_ANULADO",
  data: "2026-01-09 10:00:00",
  titulo: "Pedido anulado",
  status: "ANULADO",
  motivo: "",
  usuario: "Ana",
  estoqueAcao: "MANTER",
  valorCentavos: -101,
  ...changes
});
function fullScenario() {
  return {
    items: [itemRow()],
    exchanges: [exchangeRow()],
    cancellations: [cancellationRow()],
    cancellationRefunds: [
      { ref_id: 30, metodo: "DINHEIRO", valor: 1 },
      { ref_id: 30, metodo: "PIX_EXTERNO", valor: 100 },
      { ref_id: 30, metodo: "DINHEIRO", valor: 99 }
    ],
    exchangeRefunds: [
      { ref_id: 20, metodo: "PIX_EXTERNO", valor: 99 },
      { ref_id: 20, metodo: "DINHEIRO", valor: 1 },
      { ref_id: 20, metodo: "PIX_EXTERNO", valor: 1 }
    ],
    payments: [paymentRow()],
    refunds: [refundRow()],
    void: voidRow()
  };
}
function fullExpected() {
  return {
    eventos: [
      voidEvent(),
      refundEvent(),
      paymentEvent(),
      ...cancellationEvents({
        metodosReembolso: ["DINHEIRO", "PIX_EXTERNO"],
        valorReembolsoCentavos: 200
      }),
      ...exchangeEvents({
        metodosReembolso: ["PIX_EXTERNO", "DINHEIRO"],
        valorReembolsoCentavos: 101
      }),
      itemEvent()
    ]
  };
}

function controlledDb(data, { exists = true, failure } = {}) {
  const calls = [];
  const classify = sql => {
    if (sql.includes("FROM admin_sessoes")) return "auth";
    if (sql.includes("SELECT id FROM pedidos")) return "exists";
    if (sql.includes("SELECT * FROM pedido_anulacoes")) return "void";
    if (sql.includes("FROM pedido_itens pi")) return "items";
    if (sql.includes("FROM pedido_item_trocas t")) return "exchanges";
    if (sql.includes("FROM pedido_item_cancelamentos c")) return "cancellations";
    if (sql.includes("SUM(ra.valor_centavos) AS valor")) return "cancellationRefunds";
    if (sql.includes("SUM(ta.valor_centavos) AS valor")) return "exchangeRefunds";
    if (sql.includes("FROM pedido_pagamentos pp")) return "payments";
    if (sql.includes("FROM pedido_reembolsos r")) return "refunds";
    assert.fail(`Unexpected SQL: ${sql}`);
  };
  const db = {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT\b/i, "Only SELECT is authorized");
      const key = classify(sql);
      let args = [];
      const result = () => {
        calls.push({ key, sql, args });
        if (failure === key) throw new Error("Injected query failure");
        if (key === "auth") return { id: 1, nome: "Ana", ativo: 1, papel: "ADMIN" };
        if (key === "exists") return exists ? { id: 1 } : null;
        if (key === "void") return data.void;
        return structuredClone(data[key]);
      };
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return result();
        },
        async all() {
          return { results: result() };
        },
        run() {
          assert.fail("No run/mutation");
        }
      };
    },
    batch() {
      assert.fail("No batch/mutation");
    }
  };
  return { db, calls };
}
async function request(module, db, id = "1", cookie = "rp_admin_session=harness") {
  return module.onRequestGet({
    env: { DB: db },
    params: { id },
    request: new Request(`https://local.test/api/admin/pedidos/${id}/historico`, {
      headers: cookie ? { Cookie: cookie } : {}
    })
  });
}
async function json(data, options = {}, module = endpoint) {
  const { db, calls } = controlledDb(data, options);
  const response = await request(module, db, options.id ?? "1");
  return { status: response.status, body: await response.json(), calls };
}
async function expect(data, events, module = endpoint) {
  const before = structuredClone(data);
  const result = await json(data, {}, module);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { eventos: events });
  assert.deepEqual(data, before, "Input query results remain unchanged");
  return result;
}

test("complete JSON: all eight event types, IDs, references, cents and grouped refunds", async () => {
  await expect(fullScenario(), fullExpected().eventos);
});
test("repeated GET preserves complete JSON and stable IDs", async () => {
  const first = await json(fullScenario());
  const second = await json(fullScenario());
  assert.deepEqual(first.body, fullExpected());
  assert.deepEqual(second.body, first.body);
});
test("empty timeline", async () => {
  await expect(empty(), []);
});
for (const status of ["AGUARDANDO_COBRANCA", "AGUARDANDO_REEMBOLSO", "FALHOU"]) {
  test(`exchange ${status}: requested only with original status`, async () => {
    await expect(
      { ...empty(), exchanges: [exchangeRow({ status })] },
      exchangeEvents({}, { status }, false)
    );
  });
}
for (const status of ["SOLICITADO", "AGUARDANDO_REEMBOLSO", "INCONCLUSIVO"]) {
  test(`cancellation ${status}: requested only with original status`, async () => {
    await expect(
      { ...empty(), cancellations: [cancellationRow({ status })] },
      cancellationEvents({}, { status }, false)
    );
  });
}
test("completed exchange without completion date: requested status null, no completed event", async () => {
  await expect(
    { ...empty(), exchanges: [exchangeRow({ concluido_em: null })] },
    exchangeEvents({}, {}, false)
  );
});
test("completed cancellation without completion date: requested status null, no completed event", async () => {
  await expect(
    { ...empty(), cancellations: [cancellationRow({ concluido_em: null })] },
    cancellationEvents({}, {}, false)
  );
});
test("no refund fields on either requested or completed events without allocations", async () => {
  await expect({ ...empty(), exchanges: [exchangeRow()], cancellations: [cancellationRow()] }, [
    ...cancellationEvents(),
    ...exchangeEvents()
  ]);
});
test("refund groups are independent across parent IDs and ignore unrelated groups", async () => {
  await expect(
    {
      ...empty(),
      exchanges: [exchangeRow()],
      cancellations: [cancellationRow()],
      exchangeRefunds: [
        { ref_id: 20, metodo: "CARTAO", valor: 99 },
        { ref_id: 999, metodo: "DINHEIRO", valor: 1000 }
      ],
      cancellationRefunds: [{ ref_id: 30, metodo: "DINHEIRO", valor: 1 }]
    },
    [
      ...cancellationEvents({ metodosReembolso: ["DINHEIRO"], valorReembolsoCentavos: 1 }),
      ...exchangeEvents({ metodosReembolso: ["CARTAO"], valorReembolsoCentavos: 99 })
    ]
  );
});
for (const [difference, kind] of [
  [99, "POSITIVA"],
  [-99, "NEGATIVA"],
  [0, "ZERO"]
]) {
  test(`exchange difference ${difference} cents is unchanged`, async () => {
    await expect(
      {
        ...empty(),
        exchanges: [exchangeRow({ diferenca_centavos: difference, tipo_diferenca: kind })]
      },
      exchangeEvents({ diferencaCentavos: difference, tipoDiferenca: kind })
    );
  });
}
test("numeric query strings convert to exact integer cents and quantities", async () => {
  await expect(
    {
      ...empty(),
      items: [itemRow({ quantidade: "3", valor_total_centavos: "101" })],
      payments: [paymentRow({ valor_centavos: "1" })],
      refunds: [refundRow({ valor_centavos: "99" })]
    },
    [refundEvent(), paymentEvent(), itemEvent()]
  );
});
for (const [name, expectedName] of [
  [null, "Produto atual"],
  ["", ""],
  ["Snapshot", "Snapshot"]
]) {
  test(`destination name ${JSON.stringify(name)} preserves nullish fallback`, async () => {
    await expect(
      { ...empty(), exchanges: [exchangeRow({ destino_nome: name })] },
      exchangeEvents({
        itemDestino: {
          id: 11,
          nome: expectedName,
          quantidade: 2,
          valorCentavos: 200,
          estoqueEstado: "RESERVADO"
        }
      })
    );
  });
}
test("missing destination item retains null ID and stock state", async () => {
  await expect(
    {
      ...empty(),
      exchanges: [
        exchangeRow({ item_destino_id: null, destino_nome: null, destino_estoque_estado: null })
      ]
    },
    exchangeEvents({
      itemDestino: {
        id: null,
        nome: "Produto atual",
        quantidade: 2,
        valorCentavos: 200,
        estoqueEstado: null
      }
    })
  );
});
test("empty motives are absent after JSON serialization, except void motive", async () => {
  const ex = exchangeEvents();
  const ca = cancellationEvents();
  const ref = refundEvent();
  for (const event of [...ex, ...ca, ref]) delete event.motivo;
  await expect(
    {
      ...empty(),
      exchanges: [exchangeRow({ motivo: "" })],
      cancellations: [cancellationRow({ motivo: "" })],
      refunds: [refundRow({ motivo: "" })],
      void: voidRow()
    },
    [voidEvent(), ref, ...ca, ...ex]
  );
});
test("null event dates remain null in serialized JSON", async () => {
  await expect(
    {
      ...empty(),
      items: [itemRow({ data: null })],
      payments: [paymentRow({ pago_em: null })],
      refunds: [refundRow({ data: null })]
    },
    [itemEvent({ data: null }), paymentEvent({ data: null }), refundEvent({ data: null })]
  );
});
function tiedScenario() {
  return {
    ...fullScenario(),
    items: [itemRow({ data: date })],
    exchanges: [exchangeRow({ criado_em: date, concluido_em: date })],
    cancellations: [cancellationRow({ criado_em: date, concluido_em: date })],
    payments: [paymentRow({ pago_em: date })],
    refunds: [refundRow({ data: date })],
    void: { ...voidRow(), criado_em: date }
  };
}
function tiedExpected() {
  const events = fullExpected().eventos;
  const ids = [
    "anulacao-60",
    "item-10",
    "troca-solicitada-20",
    "troca-concluida-20",
    "cancelamento-solicitado-30",
    "cancelamento-concluido-30",
    "pagamento-40",
    "reembolso-50"
  ];
  return ids.map(id => ({ ...events.find(event => event.id === id), data: date }));
}
test("equal dates preserve void, item, requested/completed exchange and cancellation, payment, refund order", async () => {
  await expect(tiedScenario(), tiedExpected());
});
test("mixed date formats sort textually rather than chronologically", async () => {
  const dates = ["2026-01-01T00:00:00Z", "2026-01-01 23:59:59", "2026-01-02 00:00:00"];
  await expect(
    { ...empty(), items: dates.map((data, index) => itemRow({ id: index + 1, data })) },
    [2, 0, 1].map(index =>
      itemEvent({
        id: `item-${index + 1}`,
        referenciaId: index + 1,
        data: dates[index],
        item: { id: index + 1, nome: "Bolo", quantidade: 3, valorCentavos: 101 }
      })
    )
  );
});
test("read-only request uses only SELECT, fixed arguments and current physical query sequence", async () => {
  const { calls } = await expect(fullScenario(), fullExpected().eventos);
  assert.deepEqual(
    calls.map(call => call.key),
    [
      "auth",
      "exists",
      "items",
      "exchanges",
      "cancellations",
      "cancellationRefunds",
      "exchangeRefunds",
      "payments",
      "refunds",
      "void"
    ]
  );
  for (const call of calls.slice(1)) assert.deepEqual(call.args, [1]);
});
for (const id of ["0", "-1", "1.5", "invalid"]) {
  test(`invalid ID ${id} returns exact 400 JSON before order queries`, async () => {
    const result = await json(empty(), { id });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: "Id inválido" });
    assert.deepEqual(
      result.calls.map(call => call.key),
      ["auth"]
    );
  });
}
test("missing order returns exact 404 JSON without timeline queries", async () => {
  const result = await json(empty(), { exists: false });
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "Pedido não encontrado" });
  assert.deepEqual(
    result.calls.map(call => call.key),
    ["auth", "exists"]
  );
});
test("query error returns exact 500 JSON", async t => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const result = await json(empty(), { failure: "exchanges" });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "Erro interno ao buscar histórico" });
  assert.equal(errors.length, 1);
  assert.ok(!result.calls.some(call => call.key === "void"));
});
test("unauthenticated request returns exact 401 JSON without any query", async () => {
  const { db, calls } = controlledDb(empty());
  const response = await request(endpoint, db, "1", null);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Não autenticado" });
  assert.deepEqual(calls, []);
});

// Exercise SQL against the real migrated schema, not the controlled row adapter.
async function sqlScenario(t) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db.prepare(
      "UPDATE pedido_itens SET quantidade=1,valor_unitario_centavos=1500,valor_total_centavos=1500,criado_em='2026-01-01 10:00:00' WHERE id=1"
    ),
    db.prepare(
      "INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key,pago_em) VALUES(2,1,'DINHEIRO','ADMIN',1500,'PAGO','h-pag','2026-01-01 10:05:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos) VALUES(2,2,1,1500)"
    ),
    db.prepare(
      "INSERT INTO pedido_item_cancelamentos(id,pedido_id,pedido_item_id,status,valor_item_centavos,valor_pago_associado_centavos,valor_reembolso_necessario_centavos,estoque_acao,motivo,snapshot_financeiro,criado_em,concluido_em) VALUES(1,1,1,'CONCLUIDO',1500,1500,1500,'LIBERAR_RESERVA','','{}','2026-01-01 11:00:00','2026-01-01 11:05:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,criado_em) VALUES(3,1,1,'Destino',1,1500,1500,'ATIVO','BAIXADO','2026-01-02 09:00:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_item_trocas(id,pedido_id,item_origem_id,item_destino_id,produto_destino_id,quantidade_destino,preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,diferenca_centavos,tipo_diferenca,estoque_acao_origem,status,motivo,snapshot_financeiro,criado_em,concluido_em) VALUES(1,1,1,3,1,1,1500,1500,1500,0,'ZERO','LIBERAR_RESERVA','CONCLUIDA','','{}','2026-01-02 10:00:00','2026-01-02 10:05:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,criado_em,concluido_em) VALUES(1,1,2,'MANUAL','DINHEIRO',1,'REEMBOLSADO','h-ref1','2026-01-01 11:05:00','2026-01-01 11:05:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos) VALUES(1,2,1,1)"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,criado_em,concluido_em) VALUES(2,1,2,'MANUAL','PIX_EXTERNO',99,'REEMBOLSADO','h-ref2','2026-01-02 10:05:00','2026-01-02 10:05:00')"
    ),
    db.prepare(
      "INSERT INTO pedido_item_troca_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos) VALUES(2,2,1,99)"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,motivo,criado_em) VALUES(3,1,2,'MANUAL','DINHEIRO',101,'REEMBOLSADO','h-ref3','','2026-01-03 10:00:00')"
    )
  ]);
  const session = await app.auth.createSession(db, 1);
  const read = async () => {
    const response = await request(endpoint, db, "1", session.cookie.split(";")[0]);
    assert.equal(response.status, 200);
    return response.json();
  };
  return { db, read };
}
test("D1: nonfailed exchange destination excluded; allocated refunds never appear as standalone", async t => {
  const { read } = await sqlScenario(t);
  const body = await read();
  assert.deepEqual(
    body.eventos.filter(e => e.tipo === "ITEM_ADICIONADO").map(e => e.item.id),
    [1]
  );
  assert.deepEqual(
    body.eventos.filter(e => e.tipo === "REEMBOLSO"),
    [
      {
        id: "reembolso-3",
        tipo: "REEMBOLSO",
        data: "2026-01-03 10:00:00",
        titulo: "Reembolso confirmado",
        metodo: "DINHEIRO",
        valorReembolsoCentavos: 101,
        usuario: null,
        referenciaId: 3
      }
    ]
  );
  assert.equal(body.eventos.find(e => e.tipo === "TROCA_CONCLUIDA").valorReembolsoCentavos, 99);
  assert.equal(
    body.eventos.find(e => e.tipo === "CANCELAMENTO_CONCLUIDO").valorReembolsoCentavos,
    1
  );
});
test("D1: multiple allocations aggregate by parent and method without duplicate methods", async t => {
  const { db, read } = await sqlScenario(t);
  const expected = await read();
  await db.batch([
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key) VALUES(4,1,2,'MANUAL','DINHEIRO',1,'REEMBOLSADO','h-ref4')"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos) VALUES(4,2,1,1)"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key) VALUES(5,1,2,'MANUAL','PIX_EXTERNO',99,'REEMBOLSADO','h-ref5')"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos) VALUES(5,2,1,99)"
    ),
    db.prepare(
      "INSERT INTO pedido_reembolsos(id,pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key) VALUES(6,1,2,'MANUAL','DINHEIRO',101,'REEMBOLSADO','h-ref6')"
    ),
    db.prepare(
      "INSERT INTO pedido_item_troca_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos) VALUES(6,2,1,101)"
    )
  ]);
  for (const event of expected.eventos) {
    if (event.tipo.startsWith("CANCELAMENTO_")) {
      event.valorReembolsoCentavos = 101;
      event.metodosReembolso = ["DINHEIRO", "PIX_EXTERNO"];
    }
    if (event.tipo.startsWith("TROCA_")) {
      event.valorReembolsoCentavos = 200;
      event.metodosReembolso = ["DINHEIRO", "PIX_EXTERNO"];
    }
  }
  assert.deepEqual(await read(), expected);
});
test("D1: FALHOU exchange restores destination ITEM_ADICIONADO and keeps requested event", async t => {
  const { db, read } = await sqlScenario(t);
  await db.prepare("UPDATE pedido_item_trocas SET status='FALHOU' WHERE id=1").run();
  const body = await read();
  assert.deepEqual(
    body.eventos.filter(e => e.tipo === "ITEM_ADICIONADO").map(e => e.item.id),
    [3, 1]
  );
  assert.equal(body.eventos.filter(e => e.tipo === "TROCA_CONCLUIDA").length, 0);
  assert.equal(body.eventos.find(e => e.tipo === "TROCA_SOLICITADA").status, "FALHOU");
});
test("D1: nonpaid payment and nonconfirmed refunds excluded from all event paths", async t => {
  const { db, read } = await sqlScenario(t);
  await db.batch([
    db.prepare("UPDATE pedido_pagamentos SET status='PENDENTE' WHERE id=2"),
    db.prepare("UPDATE pedido_reembolsos SET status='PENDENTE'")
  ]);
  const body = await read();
  assert.ok(!body.eventos.some(e => e.tipo === "PAGAMENTO" || e.tipo === "REEMBOLSO"));
  for (const event of body.eventos) {
    assert.ok(!Object.hasOwn(event, "valorReembolsoCentavos"));
    assert.ok(!Object.hasOwn(event, "metodosReembolso"));
  }
});
test("D1: GET repeat preserves complete JSON; no SQL write or network request", async t => {
  const { db, read } = await sqlScenario(t);
  const statements = [];
  db.hook = (wire, operation) => {
    assert.notEqual(operation, "run");
    assert.notEqual(operation, "batch");
    for (const statement of wire) {
      assert.match(statement.sql.trim(), /^SELECT\b/i);
      statements.push(statement.sql);
    }
  };
  t.mock.method(globalThis, "fetch", () => assert.fail("No network/reconciliation/MP"));
  const first = await read();
  assert.deepEqual(await read(), first);
  assert.equal(statements.length, 20);
});

const negatives = [
  { name: "changed event ID", from: "id: `item-", to: "id: `wrong-" },
  {
    name: "wrong reference ID",
    from: "referenciaId: row.item_origem_id",
    to: "referenciaId: row.id"
  },
  {
    name: "wrong cents sign",
    from: "valorCentavos: -anulacao.liquido_original_centavos",
    to: "valorCentavos: anulacao.liquido_original_centavos"
  },
  {
    name: "duplicate refund methods",
    from: "Array.from(new Set(refundTroca.metodos))",
    to: "refundTroca.metodos"
  },
  {
    name: "changed tie ordering",
    from: "eventos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))",
    to: "eventos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.id.localeCompare(a.id)))",
    tied: true
  },
  {
    name: "undefined becomes null",
    from: "motivo: row.motivo || undefined",
    to: "motivo: row.motivo || null",
    emptyMotive: true
  },
  {
    name: "incorrect name fallback",
    from: "row.destino_nome ?? row.produto_destino_nome",
    to: "row.destino_nome || row.produto_destino_nome",
    emptyName: true
  }
];
for (const mutation of negatives) {
  test(`negative control: ${mutation.name}`, async () => {
    const mutant = await compile(mutation);
    const data = mutation.tied ? tiedScenario() : fullScenario();
    let expected = mutation.tied ? tiedExpected() : fullExpected().eventos;
    if (mutation.emptyMotive) {
      data.exchanges[0].motivo = "";
      expected = structuredClone(expected);
      for (const event of expected.filter(e => e.tipo.startsWith("TROCA_"))) delete event.motivo;
    }
    if (mutation.emptyName) {
      data.exchanges[0].destino_nome = "";
      expected = structuredClone(expected);
      for (const event of expected.filter(e => e.tipo.startsWith("TROCA_")))
        event.itemDestino.nome = "";
    }
    await expect(data, expected);
    const observed = await json(data, {}, mutant);
    assert.equal(observed.status, 200, "Mutation reaches normal JSON response");
    assert.throws(() => assert.deepEqual(observed.body, { eventos: expected }), {
      code: "ERR_ASSERTION"
    });
  });
}
