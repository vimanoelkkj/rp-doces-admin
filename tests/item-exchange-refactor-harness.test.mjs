import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { app, fixture, state } from "./helpers/b3.mjs";

// Real migrations, D1 transactions and production exports from the shared B3 fixture.
// Only the scenario data and the contract assertions belong to this harness.
async function scenario(
  t,
  {
    price = 1200,
    paid = 1500,
    stock = "RESERVADO",
    mixed = false,
    method = "DINHEIRO",
    quantity = 1
  } = {}
) {
  const db = await fixture(t, { ledger: false, reserve: "ATIVA" });
  await db.batch([
    db
      .prepare(
        `UPDATE pedidos SET origem_pedido='MANUAL',status_comanda='ABERTA',
      status_pedido='NOVO',valor_total_centavos=1500,status_pagamento=? WHERE id=1`
      )
      .bind(paid === 0 ? "PENDENTE" : paid < 1500 ? "PARCIAL" : "PAGO"),
    db
      .prepare(
        `UPDATE pedido_itens SET produto_nome='A',quantidade=1,valor_unitario_centavos=1500,
      valor_total_centavos=1500,estoque_estado=? WHERE id=1`
      )
      .bind(stock),
    db
      .prepare(
        `UPDATE produtos SET nome='A',preco_centavos=1500,estoque=10,
      estoque_reservado=? WHERE id=1`
      )
      .bind(stock === "RESERVADO" ? 1 : 0),
    db
      .prepare(
        `INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado,ativo,disponivel)
      VALUES(2,'B','BOLO',?,10,0,1,1)`
      )
      .bind(price)
  ]);
  const payments = mixed
    ? [
        [1000, "PIX_MP"],
        [500, "DINHEIRO"]
      ]
    : paid
      ? [[paid, method]]
      : [];
  for (const [index, [value, paymentMethod]] of payments.entries()) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,
        mp_payment_id,idempotency_key,pago_em) VALUES(?,1,?,'ADMIN',?,'PAGO',?, ?,CURRENT_TIMESTAMP)`
        )
        .bind(
          index + 1,
          paymentMethod,
          value,
          paymentMethod === "PIX_MP" ? "9002" : null,
          `paid-${index}`
        ),
      db
        .prepare(
          `INSERT INTO pedido_pagamento_alocacoes(id,pagamento_id,pedido_item_id,valor_centavos)
        VALUES(?,?,1,?)`
        )
        .bind(index + 1, index + 1, value)
    ]);
  }
  const action =
    stock === "RESERVADO" ? "LIBERAR_RESERVA" : stock === "BAIXADO" ? "NAO_REPOR" : "NENHUMA";
  const input = {
    pedidoId: 1,
    itemId: 1,
    produtoDestinoId: 2,
    quantidadeDestino: quantity,
    precoEsperadoCentavos: price,
    estoqueAcaoOrigem: action
  };
  return { db, input, paid, price, stock, mixed, quantity, method };
}

function expectedPreview(
  s,
  { blockers = [], available = 10, action = s.input.estoqueAcaoOrigem } = {}
) {
  const total = s.price * s.quantity;
  const balance = Math.max(0, total - s.paid);
  const excess = Math.max(0, s.paid - total);
  let remaining = excess;
  const sources = s.mixed
    ? [
        [2, "DINHEIRO", 500],
        [1, "PIX_MP", 1000]
      ]
    : s.paid
      ? [[1, s.method, s.paid]]
      : [];
  const refunds = [];
  for (const [id, method, value] of sources) {
    const amount = Math.min(remaining, value);
    if (amount > 0)
      refunds.push({
        pagamentoId: id,
        pagamentoAlocacaoId: id,
        metodo: method,
        valorCentavos: amount,
        confirmacaoManualPermitida: ["DINHEIRO", "CARTAO", "PIX_EXTERNO"].includes(method)
      });
    remaining -= amount;
  }
  const content = {
    pedidoId: 1,
    itemOrigem: {
      id: 1,
      nome: "A",
      valorCentavos: 1500,
      coberturaEfetivaCentavos: s.paid,
      estoqueEstado: s.stock
    },
    itemDestino: {
      produtoId: 2,
      nome: "B",
      quantidade: s.quantity,
      precoUnitarioCentavos: s.price,
      valorCentavos: total,
      estoqueDisponivel: available
    },
    financeiro: {
      totalAtualCentavos: 1500,
      liquidoAtualCentavos: s.paid,
      totalProjetadoCentavos: total,
      diferencaCentavos: balance > 0 ? balance : -excess,
      tipoDiferenca: balance > 0 ? "COBRAR" : excess > 0 ? "DEVOLVER" : "ZERO",
      saldoProjetadoCentavos: balance,
      excessoProjetadoCentavos: excess
    },
    refundsPropostos: refunds,
    estoque: {
      acaoOrigem: action,
      acoesOrigemPermitidas:
        s.stock === "RESERVADO"
          ? ["LIBERAR_RESERVA"]
          : s.stock === "BAIXADO"
            ? ["NAO_REPOR", "REPOR"]
            : ["NENHUMA"],
      estadoDestino: "RESERVADO"
    },
    bloqueios: blockers,
    trocaExecutavel: blockers.length === 0
  };
  // Independently constructed payload; the existing canonical serializer defines the versioned fingerprint.
  return { previewFingerprint: app.operacoes.fingerprint(content), ...content };
}

function createInput(s, preview, overrides = {}) {
  return {
    ...s.input,
    usuarioId: 1,
    motivo: "troca",
    operationKey: "harness-exchange-01",
    previewFingerprint: preview.previewFingerprint,
    ...overrides
  };
}

async function create(s, api = app.itemExchange) {
  const preview = await api.getItemExchangePreview(s.db, s.input);
  const params = createInput(s, preview);
  const result = await api.createItemExchange(s.db, params);
  assert.equal(result.ok, true);
  return { preview, params, result };
}

function refundInput(view, overrides = {}) {
  const leg = view.refundsPendentes[0];
  return {
    pedidoId: 1,
    exchangeId: view.id,
    usuarioId: 1,
    operationKey: "harness-refund-01",
    pagamentoId: leg.pagamentoId,
    pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
    valorCentavos: leg.valorCentavos,
    confirmacao: true,
    ...overrides
  };
}

function expectedView(s, { status, finalized = false, confirmed = [] } = {}) {
  const preview = expectedPreview(s);
  const excess = preview.financeiro.excessoProjetadoCentavos;
  const initial =
    excess > 0
      ? "AGUARDANDO_REEMBOLSO"
      : preview.financeiro.saldoProjetadoCentavos > 0
        ? "AGUARDANDO_COBRANCA"
        : "CONCLUIDA";
  const resolved = finalized || initial !== "AGUARDANDO_REEMBOLSO";
  const total = resolved ? s.price * s.quantity : 1500;
  const liquid = s.paid - confirmed.reduce((sum, r) => sum + r.valorCentavos, 0);
  return {
    id: 1,
    pedidoId: 1,
    itemOrigemId: 1,
    itemDestinoId: 2,
    status: status ?? (finalized ? "CONCLUIDA" : initial),
    reembolsoPendenteCentavos: finalized ? 0 : excess,
    refundsPendentes: finalized ? [] : preview.refundsPropostos,
    estoqueOrigemEstado: resolved
      ? s.input.estoqueAcaoOrigem === "LIBERAR_RESERVA"
        ? "LIBERADO"
        : s.input.estoqueAcaoOrigem === "REPOR"
          ? "REPOSTO"
          : s.stock
      : s.stock,
    estoqueDestinoEstado: resolved && liquid >= total ? "BAIXADO" : "RESERVADO",
    reembolsosConfirmados: confirmed,
    financeiro: {
      status: liquid >= total ? "PAGO" : liquid > 0 ? "PARCIAL" : "PENDENTE",
      totalCentavos: total,
      liquidoCentavos: liquid,
      saldoCentavos: Math.max(0, total - liquid)
    }
  };
}

async function snapshot(db) {
  const persisted = {
    ...(await state(db)),
    exchanges: (await db.prepare("SELECT * FROM pedido_item_trocas ORDER BY id").all()).results,
    refundAllocations: (
      await db.prepare("SELECT * FROM pedido_item_troca_reembolso_alocacoes ORDER BY id").all()
    ).results
  };
  // Replayed finalization may refresh projection timestamps. Compare their presence,
  // not the wall clock, while retaining fact timestamps and every financial/stock field.
  for (const rows of Object.values(persisted)) {
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      if (row?.atualizado_em != null) row.atualizado_em = "<projection timestamp>";
    }
  }
  return persisted;
}

async function assertPersisted(s, preview, view) {
  const row = await s.db
    .prepare(
      `SELECT pedido_id,item_origem_id,item_destino_id,status,produto_destino_id,
    quantidade_destino,preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,
    diferenca_centavos,tipo_diferenca,estoque_acao_origem,motivo,snapshot_financeiro
    FROM pedido_item_trocas WHERE id=1`
    )
    .first();
  assert.deepEqual(row, {
    pedido_id: 1,
    item_origem_id: 1,
    item_destino_id: 2,
    status: view.status,
    produto_destino_id: 2,
    quantidade_destino: s.quantity,
    preco_unitario_destino_centavos: s.price,
    valor_origem_centavos: 1500,
    valor_destino_centavos: s.price * s.quantity,
    diferenca_centavos: preview.financeiro.diferencaCentavos || 0,
    tipo_diferenca: preview.financeiro.tipoDiferenca,
    estoque_acao_origem: s.input.estoqueAcaoOrigem,
    motivo: "troca",
    snapshot_financeiro: JSON.stringify(preview)
  });
  const pending = view.status === "AGUARDANDO_REEMBOLSO";
  assert.deepEqual(
    (
      await s.db
        .prepare(
          `SELECT id,produto_id,produto_nome,quantidade,valor_unitario_centavos,
    valor_total_centavos,status_item,estoque_estado,pedido_item_troca_id FROM pedido_itens ORDER BY id`
        )
        .all()
    ).results,
    [
      {
        id: 1,
        produto_id: 1,
        produto_nome: "A",
        quantidade: 1,
        valor_unitario_centavos: 1500,
        valor_total_centavos: 1500,
        status_item: pending ? "ATIVO" : "CANCELADO",
        estoque_estado: view.estoqueOrigemEstado,
        pedido_item_troca_id: null
      },
      {
        id: 2,
        produto_id: 2,
        produto_nome: "B",
        quantidade: s.quantity,
        valor_unitario_centavos: s.price,
        valor_total_centavos: s.price * s.quantity,
        status_item: pending ? "TROCA_PENDENTE" : "ATIVO",
        estoque_estado: view.estoqueDestinoEstado,
        pedido_item_troca_id: pending ? 1 : null
      }
    ]
  );
  assert.deepEqual(
    (await s.db.prepare("SELECT id,estoque,estoque_reservado FROM produtos ORDER BY id").all())
      .results,
    [
      {
        id: 1,
        estoque: 10 + (!pending && s.input.estoqueAcaoOrigem === "REPOR" ? 1 : 0),
        estoque_reservado: pending && s.stock === "RESERVADO" ? 1 : 0
      },
      {
        id: 2,
        estoque: view.estoqueDestinoEstado === "BAIXADO" ? 10 - s.quantity : 10,
        estoque_reservado: view.estoqueDestinoEstado === "RESERVADO" ? s.quantity : 0
      }
    ]
  );
  assert.deepEqual(
    await s.db
      .prepare("SELECT valor_total_centavos,status_pagamento FROM pedidos WHERE id=1")
      .first(),
    {
      valor_total_centavos: view.financeiro.totalCentavos,
      status_pagamento: view.financeiro.status
    }
  );
  assert.deepEqual(
    await s.db
      .prepare(
        "SELECT operation_key,tipo,escopo,fase,pedido_item_troca_id FROM pedido_operacoes WHERE tipo='ITEM_TROCA_ADMIN'"
      )
      .first(),
    {
      operation_key: "harness-exchange-01",
      tipo: "ITEM_TROCA_ADMIN",
      escopo: "ADMIN",
      fase: "CONCLUIDA",
      pedido_item_troca_id: 1
    }
  );
}

for (const [label, options] of [
  ["ZERO", { price: 1500 }],
  ["COBRAR", { price: 2000 }],
  ["DEVOLVER", { price: 1200 }],
  ["unpaid quantity two", { price: 101, paid: 0, quantity: 2 }],
  ["mixed LIFO", { price: 800, mixed: true }],
  ["small cents", { price: 1499 }],
  ["partial coverage", { price: 1200, paid: 99 }],
  ["BAIXADO default", { price: 1500, stock: "BAIXADO" }],
  ["SEM_RESERVA", { price: 1500, stock: "SEM_RESERVA" }]
])
  test(`preview: complete contract ${label}, stable fingerprint and no writes`, async t => {
    const s = await scenario(t, options);
    const before = await snapshot(s.db);
    const requests = [];
    s.db.hook = async statements => {
      requests.push(...statements);
    };
    assert.deepEqual(
      await app.itemExchange.getItemExchangePreview(s.db, s.input),
      expectedPreview(s)
    );
    assert.deepEqual(
      await app.itemExchange.getItemExchangePreview(s.db, s.input),
      expectedPreview(s)
    );
    s.db.hook = null;
    assert.ok(requests.length > 0);
    assert.ok(
      requests.every(statement => /^\s*(SELECT|WITH)\b/i.test(statement.sql)),
      "preview only reads D1"
    );
    assert.deepEqual(await snapshot(s.db), before);
  });

for (const [label, sql, code, message, available] of [
  [
    "non manual",
    "UPDATE pedidos SET origem_pedido='SITE'",
    "PEDIDO_NAO_TROCAVEL",
    "Este pedido não aceita troca nesta etapa.",
    10
  ],
  [
    "ready",
    "UPDATE pedidos SET status_pedido='PRONTO'",
    "STATUS_PEDIDO_PRONTO",
    "Pedido pronto não pode ser reaberto nesta fase.",
    10
  ],
  [
    "stock",
    "UPDATE produtos SET estoque=0 WHERE id=2",
    "ESTOQUE_INSUFICIENTE",
    "Estoque insuficiente para o produto de destino.",
    0
  ],
  [
    "pending Pix",
    "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,'PIX_MP','ADMIN',500,'PENDENTE','pending-pix')",
    "PIX_PENDENTE",
    "Há um Pix pendente nesta comanda.",
    10
  ],
  [
    "unattributed excess",
    "DELETE FROM pedido_pagamento_alocacoes",
    "COBERTURA_INSUFICIENTE",
    "A origem financeira do excesso não pôde ser determinada.",
    10
  ]
])
  test(`blocker: ${label}`, async t => {
    const s = await scenario(t);
    await s.db.prepare(sql).run();
    const expected = expectedPreview(s, {
      blockers: [{ codigo: code, mensagem: message }],
      available
    });
    if (code === "COBERTURA_INSUFICIENTE") {
      expected.itemOrigem.coberturaEfetivaCentavos = 0;
      expected.refundsPropostos = [];
      const { previewFingerprint: _fingerprint, ...content } = expected;
      expected.previewFingerprint = app.operacoes.fingerprint(content);
    }
    const before = await snapshot(s.db);
    assert.deepEqual(await app.itemExchange.getItemExchangePreview(s.db, s.input), expected);
    assert.deepEqual(await app.itemExchange.createItemExchange(s.db, createInput(s, expected)), {
      ok: false,
      erro: ["PIX_PENDENTE", "ESTOQUE_INSUFICIENTE"].includes(code) ? code : "PREVIEW_OBSOLETO",
      preview: expected
    });
    assert.deepEqual(await snapshot(s.db), before);
  });

for (const [label, sql, overrides, code] of [
  ["changed price", "UPDATE produtos SET preco_centavos=1201 WHERE id=2", {}, "PRECO_ALTERADO"],
  [
    "inactive item",
    "UPDATE pedido_itens SET status_item='CANCELADO' WHERE id=1",
    {},
    "ITEM_NAO_ATIVO"
  ],
  ["foreign item", null, { pedidoId: 2 }, "PEDIDO_NAO_ENCONTRADO"],
  ["quantity invalid", null, { quantidadeDestino: 0 }, "QUANTIDADE_INVALIDA"],
  ["stock action invalid", null, { estoqueAcaoOrigem: "REPOR" }, "ESTOQUE_ACAO_INVALIDA"],
  [
    "indeterminate legacy refund",
    "INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(1,1,'DINHEIRO','MANUAL',1,'REEMBOLSADO','legacy-refund')",
    {},
    "COBERTURA_INDETERMINADA"
  ]
])
  test(`preview rejection: ${label}`, async t => {
    const s = await scenario(t);
    if (sql) await s.db.prepare(sql).run();
    const before = await snapshot(s.db);
    await assert.rejects(
      app.itemExchange.getItemExchangePreview(s.db, { ...s.input, ...overrides }),
      error => error.code === code
    );
    assert.deepEqual(await snapshot(s.db), before);
  });

for (const [stock, price, action, executable] of [
  ["RESERVADO", 1500, "LIBERAR_RESERVA", true],
  ["BAIXADO", 1500, "REPOR", true],
  ["BAIXADO", 1500, "NAO_REPOR", false],
  ["RESERVADO", 1200, "LIBERAR_RESERVA", false]
])
  test(`same-product stock preview: ${stock}/${action}/${price}`, async t => {
    const s = await scenario(t, { stock, price });
    await s.db
      .prepare("UPDATE produtos SET preco_centavos=?,estoque=?,disponivel=1 WHERE id=1")
      .bind(price, stock === "RESERVADO" ? 1 : 0)
      .run();
    const input = { ...s.input, produtoDestinoId: 1, estoqueAcaoOrigem: action };
    const preview = await app.itemExchange.getItemExchangePreview(s.db, input);
    const expected = expectedPreview(s, {
      action,
      available: 0,
      blockers: executable
        ? []
        : [
            {
              codigo: "ESTOQUE_INSUFICIENTE",
              mensagem: "Estoque insuficiente para o produto de destino."
            }
          ]
    });
    expected.itemDestino.produtoId = 1;
    expected.itemDestino.nome = "A";
    const { previewFingerprint: _fingerprint, ...content } = expected;
    expected.previewFingerprint = app.operacoes.fingerprint(content);
    assert.deepEqual(preview, expected);
    // Preview credits the origin only when no refund delays its physical release.
    // Creation's separate reservation guard is deliberately not inferred from this preview.
  });

test("preview fingerprint changes with stock availability; pending reconciliation and view are inert", async t => {
  const s = await scenario(t);
  const before = await app.itemExchange.getItemExchangePreview(s.db, s.input);
  await s.db.prepare("UPDATE produtos SET estoque=9 WHERE id=2").run();
  const changed = await app.itemExchange.getItemExchangePreview(s.db, s.input);
  assert.notEqual(changed.previewFingerprint, before.previewFingerprint);
  assert.deepEqual(changed, expectedPreview(s, { available: 9 }));
  await create(s);
  const persisted = await snapshot(s.db);
  await app.itemExchange.getExchangeView(s.db, 1, 1);
  await app.itemExchange.reconcileExchangeFinalization(s.db, 1);
  await app.itemExchange.reconcileExchangeFinalizationsForPedido(s.db, 1);
  assert.deepEqual(await snapshot(s.db), persisted);
});

test("preview rejects an item outside an existing order", async t => {
  const s = await scenario(t);
  await s.db
    .prepare(
      `INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key)
    VALUES(2,'other-token','Other','000',0,'other-order')`
    )
    .run();
  await assert.rejects(
    app.itemExchange.getItemExchangePreview(s.db, { ...s.input, pedidoId: 2 }),
    error => error.code === "ITEM_FORA_DO_PEDIDO"
  );
});

for (const [label, options, action] of [
  ["charge", { price: 2000 }],
  ["immediate ZERO", { price: 1500 }],
  ["refund", { price: 1200 }],
  ["reposition", { price: 1500, stock: "BAIXADO" }, "REPOR"],
  ["no reposition", { price: 1500, stock: "BAIXADO" }],
  ["no stock action", { price: 1500, stock: "SEM_RESERVA" }],
  ["two destination units", { price: 1000, quantity: 2 }]
])
  test(`creation: ${label}, complete view, persisted facts and exact replay`, async t => {
    const s = await scenario(t, options);
    if (action) s.input.estoqueAcaoOrigem = action;
    const { preview, params, result } = await create(s);
    const view = expectedView(s);
    assert.deepEqual(result, { ok: true, troca: view });
    assert.deepEqual(await app.itemExchange.getExchangeView(s.db, 1, 1), view);
    await assertPersisted(s, preview, view);
    const before = await snapshot(s.db);
    assert.deepEqual(await app.itemExchange.createItemExchange(s.db, params), {
      ok: true,
      troca: view,
      replay: true
    });
    assert.deepEqual(await snapshot(s.db), before);
    assert.deepEqual(
      await app.itemExchange.createItemExchange(s.db, { ...params, motivo: "different" }),
      { ok: false, erro: "OPERACAO_CONFLITO_PAYLOAD" }
    );
    assert.deepEqual(await snapshot(s.db), before);
  });

test("creation rejects stale fingerprint, changed price and invalid operation key without mutation", async t => {
  const s = await scenario(t);
  const preview = await app.itemExchange.getItemExchangePreview(s.db, s.input);
  const before = await snapshot(s.db);
  assert.deepEqual(
    await app.itemExchange.createItemExchange(
      s.db,
      createInput(s, preview, { previewFingerprint: "stale" })
    ),
    { ok: false, erro: "PREVIEW_OBSOLETO", preview }
  );
  assert.deepEqual(
    await app.itemExchange.createItemExchange(s.db, createInput(s, preview, { operationKey: "" })),
    { ok: false, erro: "OPERATION_KEY_INVALIDA" }
  );
  assert.deepEqual(await snapshot(s.db), before);
  await s.db.prepare("UPDATE produtos SET preco_centavos=1201 WHERE id=2").run();
  assert.deepEqual(await app.itemExchange.createItemExchange(s.db, createInput(s, preview)), {
    ok: false,
    erro: "PRECO_ALTERADO",
    precoAtualCentavos: 1201
  });
});

test("existing exchange blocks a second preview; missing exchange view is null", async t => {
  const s = await scenario(t);
  assert.equal(await app.itemExchange.getExchangeView(s.db, 1, 1), null);
  await create(s);
  await assert.rejects(
    app.itemExchange.getItemExchangePreview(s.db, s.input),
    error => error.code === "TROCA_JA_EXISTENTE"
  );
});

test("competing creation keys admit one exchange, one destination and one reservation", async t => {
  const s = await scenario(t, { price: 2000 });
  const preview = await app.itemExchange.getItemExchangePreview(s.db, s.input);
  const results = await Promise.all(
    ["harness-tab-one", "harness-tab-two"].map(operationKey =>
      app.itemExchange.createItemExchange(s.db, createInput(s, preview, { operationKey }))
    )
  );
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.deepEqual(await s.db.prepare("SELECT COUNT(*) n FROM pedido_item_trocas").first(), {
    n: 1
  });
  assert.deepEqual(
    await s.db.prepare("SELECT COUNT(*) n FROM pedido_itens WHERE produto_id=2").first(),
    { n: 1 }
  );
  assert.deepEqual(
    await s.db.prepare("SELECT estoque,estoque_reservado FROM produtos WHERE id=2").first(),
    { estoque: 10, estoque_reservado: 1 }
  );
});

test("manual refund: exact amount, allocation, complete final view and replay without duplicated ledger", async t => {
  const s = await scenario(t);
  const { result } = await create(s);
  const input = refundInput(result.troca);
  const before = await snapshot(s.db);
  for (const [override, erro] of [
    [{ valorCentavos: 299 }, "VALOR_REFUND_DIVERGENTE"],
    [{ confirmacao: false }, "VALOR_REFUND_DIVERGENTE"],
    [{ pagamentoAlocacaoId: 999 }, "PAGAMENTO_ALOCACAO_INVALIDA"],
    [{ exchangeId: 999 }, "TROCA_NAO_ENCONTRADA"]
  ]) {
    assert.deepEqual(
      await app.itemExchange.confirmExchangeRefund(s.db, { ...input, ...override }),
      { ok: false, erro }
    );
    assert.deepEqual(await snapshot(s.db), before);
  }
  const confirmed = [
    { id: 1, metodo: "DINHEIRO", valorCentavos: 300, origem: "MANUAL", mpRefundId: null }
  ];
  const view = expectedView(s, { finalized: true, confirmed });
  assert.deepEqual(await app.itemExchange.confirmExchangeRefund(s.db, input), {
    ok: true,
    troca: view,
    reembolsoId: 1
  });
  assert.deepEqual(
    (
      await s.db
        .prepare(
          "SELECT reembolso_id,pedido_item_troca_id,pagamento_alocacao_id,valor_centavos FROM pedido_item_troca_reembolso_alocacoes"
        )
        .all()
    ).results,
    [{ reembolso_id: 1, pedido_item_troca_id: 1, pagamento_alocacao_id: 1, valor_centavos: 300 }]
  );
  const after = await snapshot(s.db);
  assert.deepEqual(await app.itemExchange.confirmExchangeRefund(s.db, input), {
    ok: true,
    troca: view,
    reembolsoId: 1,
    replay: true
  });
  assert.deepEqual(await snapshot(s.db), after);
  assert.deepEqual(
    await app.itemExchange.confirmExchangeRefund(s.db, {
      ...input,
      operationKey: "harness-new-refund-key"
    }),
    { ok: false, erro: "TROCA_NAO_AGUARDANDO" }
  );
  assert.deepEqual(await snapshot(s.db), after);
});

test("mixed refund preserves independent allocations and only releases stock after all legs", async t => {
  const s = await scenario(t, { price: 800, mixed: true });
  const { result } = await create(s);
  const first = await app.itemExchange.confirmExchangeRefund(s.db, refundInput(result.troca));
  assert.equal(first.troca.status, "AGUARDANDO_REEMBOLSO");
  assert.deepEqual(first.troca.refundsPendentes, [
    {
      pagamentoId: 1,
      pagamentoAlocacaoId: 1,
      metodo: "PIX_MP",
      valorCentavos: 200,
      confirmacaoManualPermitida: false
    }
  ]);
  assert.equal(first.troca.estoqueOrigemEstado, "RESERVADO");
  const posts = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    posts.push(JSON.parse(init.body));
    return Response.json({ id: 7100, payment_id: 9002, amount: 2, status: "approved" });
  });
  const second = await app.itemExchange.confirmExchangeRefund(
    s.db,
    refundInput(first.troca, { operationKey: "harness-refund-pix", mpAccessToken: "TEST_TOKEN" })
  );
  assert.deepEqual(posts, [{ amount: 2 }]);
  assert.deepEqual(
    second.troca,
    expectedView(s, {
      finalized: true,
      confirmed: [
        { id: 1, metodo: "DINHEIRO", valorCentavos: 500, origem: "MANUAL", mpRefundId: null },
        { id: 2, metodo: "PIX_MP", valorCentavos: 200, origem: "MERCADO_PAGO", mpRefundId: "7100" }
      ]
    })
  );
});

for (const remoteStatus of ["approved", "in_process", "timeout"])
  test(`PIX_MP refund: ${remoteStatus}, remote amount and stable key`, async t => {
    const s = await scenario(t, { method: "PIX_MP" });
    const { result } = await create(s);
    const input = refundInput(result.troca, { mpAccessToken: "TEST_TOKEN" });
    assert.deepEqual(
      await app.itemExchange.confirmExchangeRefund(s.db, { ...input, mpAccessToken: undefined }),
      { ok: false, erro: "MERCADO_PAGO_NAO_CONFIGURADO" }
    );
    const calls = [];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      calls.push({
        method: init.method,
        body: init.body && JSON.parse(init.body),
        key: init.headers["X-Idempotency-Key"]
      });
      if (remoteStatus === "timeout") throw new Error("remote response lost");
      return Response.json({ id: 7100, payment_id: 9002, amount: 3, status: remoteStatus });
    });
    const first = await app.itemExchange.confirmExchangeRefund(s.db, input);
    assert.equal(first.ok, true);
    assert.equal(
      first.refundStatus,
      remoteStatus === "approved"
        ? "CONFIRMADO"
        : remoteStatus === "timeout"
          ? "INCONCLUSIVO"
          : "PROCESSANDO"
    );
    assert.deepEqual(calls[0].body, { amount: 3 });
    assert.ok(calls[0].key);
    if (remoteStatus === "approved") {
      assert.deepEqual(
        first.troca,
        expectedView(s, {
          finalized: true,
          confirmed: [
            {
              id: 1,
              metodo: "PIX_MP",
              valorCentavos: 300,
              origem: "MERCADO_PAGO",
              mpRefundId: "7100"
            }
          ]
        })
      );
      const before = await snapshot(s.db);
      const replay = await app.itemExchange.confirmExchangeRefund(s.db, input);
      assert.equal(replay.replay, true);
      assert.deepEqual(replay.troca, first.troca);
      assert.equal(calls.length, 1);
      assert.deepEqual(await snapshot(s.db), before);
    } else {
      assert.equal(first.troca.status, "AGUARDANDO_REEMBOLSO");
      assert.equal(first.troca.estoqueOrigemEstado, "RESERVADO");
      assert.equal(first.troca.estoqueDestinoEstado, "RESERVADO");
      assert.equal(first.troca.refundsPendentes[0].refundRemoto.operationKey, input.operationKey);
      assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM pedido_reembolsos").first()).n, 0);
      t.mock.method(globalThis, "fetch", async (_url, init) => {
        if (init.method === "POST") assert.equal(init.headers["X-Idempotency-Key"], calls[0].key);
        return Response.json({ id: 7100, payment_id: 9002, amount: 3, status: "approved" });
      });
      const recovered = await app.itemExchange.confirmExchangeRefund(s.db, input);
      assert.equal(recovered.refundStatus, "CONFIRMADO");
      assert.equal(recovered.troca.status, "CONCLUIDA");
      assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM pedido_reembolsos").first()).n, 1);
    }
  });

test("manual finalization failure remains recoverable without refund duplication", async t => {
  const s = await scenario(t);
  const { result } = await create(s);
  const batch = s.db.batch.bind(s.db);
  s.db.batch = async statements => {
    if (statements.some(statement => statement.sql.includes("SET status=CASE")))
      throw new Error("finalization interrupted");
    return batch(statements);
  };
  const refunded = await app.itemExchange.confirmExchangeRefund(s.db, refundInput(result.troca));
  assert.equal(refunded.troca.status, "INCONCLUSIVA");
  assert.equal(refunded.troca.reembolsoPendenteCentavos, 0);
  s.db.batch = batch;
  await app.itemExchange.reconcileExchangeFinalizationsForPedido(s.db, 1);
  const confirmed = [
    { id: 1, metodo: "DINHEIRO", valorCentavos: 300, origem: "MANUAL", mpRefundId: null }
  ];
  assert.deepEqual(
    await app.itemExchange.getExchangeView(s.db, 1, 1),
    expectedView(s, { finalized: true, confirmed })
  );
  const before = await snapshot(s.db);
  await app.itemExchange.reconcileExchangeFinalization(s.db, 1);
  await app.itemExchange.reconcileExchangeFinalization(s.db, 999);
  assert.deepEqual(await snapshot(s.db), before);
});

test("charge reconciliation waits for payment, completes once and repairs a legacy reserved destination", async t => {
  const s = await scenario(t, { price: 2000 });
  const { result } = await create(s);
  const before = await snapshot(s.db);
  await app.itemExchange.reconcileExchangeCharges(s.db, 1);
  assert.deepEqual(await snapshot(s.db), before);
  await s.db
    .prepare(
      `INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key)
    VALUES(1,'DINHEIRO','ADMIN',500,'PAGO','charge-complete')`
    )
    .run();
  await app.itemExchange.reconcileExchangeCharges(s.db, 1);
  assert.deepEqual(await app.itemExchange.getExchangeView(s.db, 1, 1), {
    ...result.troca,
    status: "CONCLUIDA",
    estoqueDestinoEstado: "BAIXADO",
    // Charges reconcile physical state, not the stored financial projection.
    financeiro: { status: "PARCIAL", totalCentavos: 2000, liquidoCentavos: 2000, saldoCentavos: 0 }
  });
  const completed = await snapshot(s.db);
  await app.itemExchange.reconcileExchangeCharges(s.db, 1);
  assert.deepEqual(await snapshot(s.db), completed);
  await s.db.batch([
    s.db.prepare("UPDATE pedido_itens SET estoque_estado='RESERVADO' WHERE id=2"),
    s.db.prepare("UPDATE produtos SET estoque=10,estoque_reservado=1 WHERE id=2")
  ]);
  await app.itemExchange.reconcileExchangeCharges(s.db, 1);
  assert.equal(
    (await app.itemExchange.getExchangeView(s.db, 1, 1)).estoqueDestinoEstado,
    "BAIXADO"
  );
  assert.deepEqual(
    await s.db.prepare("SELECT estoque,estoque_reservado FROM produtos WHERE id=2").first(),
    { estoque: 9, estoque_reservado: 0 }
  );
});

// Mutate the real module in memory. Every control first proves its assertion passes
// against production, then demands an AssertionError against the changed implementation.
// The onLoad anchor must occur once: stale mutation controls fail loudly after extraction.
async function mutant(from, to) {
  let replacements = 0;
  const bundle = await build({
    stdin: {
      contents: "export * from './functions/lib/itemExchange';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "exchange-contract-mutation",
        setup(builder) {
          builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
            const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
            if (!source.includes(from)) return undefined;
            assert.equal(source.split(from).length - 1, 1, "mutation anchor must be unique");
            replacements++;
            return { contents: source.replace(from, to), loader: "ts" };
          });
        }
      }
    ]
  });
  assert.equal(replacements, 1, "mutation must reach a production module");
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

for (const [label, from, to, options] of [
  ["difference sign", "diferencaCentavos: difference", "diferencaCentavos: -difference", {}],
  ["difference type", "tipoDiferenca: differenceType", 'tipoDiferenca: "ZERO"', {}],
  [
    "refund order",
    "refundsPropostos: proposedRefunds",
    "refundsPropostos: proposedRefunds.reverse()",
    { price: 800, mixed: true }
  ],
  [
    "allocation identity",
    "pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId),\n        metodo:",
    "pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId) + 100,\n        metodo:",
    {}
  ],
  ["origin stock action", "acaoOrigem: selectedAction", 'acaoOrigem: "NENHUMA"', {}],
  [
    "fingerprint",
    "previewFingerprint: fingerprint(content)",
    'previewFingerprint: "changed-fingerprint"',
    {}
  ]
])
  test(`negative control: ${label}`, async t => {
    const s = await scenario(t, options);
    const check = async api =>
      assert.deepEqual(await api.getItemExchangePreview(s.db, s.input), expectedPreview(s));
    await check(app.itemExchange);
    const api = await mutant(from, to);
    await assert.rejects(check(api), { code: "ERR_ASSERTION" });
  });

test("negative control: initial status violates the pending-item invariant and rolls back", async t => {
  const s = await scenario(t);
  const baseline = await scenario(t);
  assert.deepEqual((await create(baseline)).result.troca, expectedView(baseline));
  const before = await snapshot(s.db);
  const api = await mutant(
    'awaitingRefund ? "AGUARDANDO_REEMBOLSO" : "SOLICITADA"',
    'awaitingRefund ? "INCONCLUSIVA" : "SOLICITADA"'
  );
  await assert.rejects(create(s, api), /troca_pendente_sem_troca/);
  assert.deepEqual(await snapshot(s.db), before);
});

test("negative control: replay marker", async t => {
  const s = await scenario(t);
  const { params, result } = await create(s);
  const check = async api =>
    assert.deepEqual(await api.createItemExchange(s.db, params), {
      ok: true,
      troca: result.troca,
      replay: true
    });
  await check(app.itemExchange);
  await assert.rejects(
    check(
      await mutant(
        "troca: await exchangeView(db, row), replay: true",
        "troca: await exchangeView(db, row), replay: false"
      )
    ),
    { code: "ERR_ASSERTION" }
  );
});

test("negative control: confirmed refund amount", async t => {
  const check = async api => {
    const s = await scenario(t);
    const { result } = await create(s);
    const refunded = await api.confirmExchangeRefund(s.db, refundInput(result.troca));
    assert.deepEqual(await s.db.prepare("SELECT valor_centavos FROM pedido_reembolsos").first(), {
      valor_centavos: 300
    });
    assert.deepEqual(
      refunded.troca,
      expectedView(s, {
        finalized: true,
        confirmed: [
          { id: 1, metodo: "DINHEIRO", valorCentavos: 300, origem: "MANUAL", mpRefundId: null }
        ]
      })
    );
  };
  await check(app.itemExchange);
  await assert.rejects(
    check(
      await mutant(
        "valorCentavos: Number(refund.valor_centavos)",
        "valorCentavos: Number(refund.valor_centavos) + 1"
      )
    ),
    { code: "ERR_ASSERTION" }
  );
});

test("negative control: final status", async t => {
  const s = await scenario(t, { price: 1500 });
  const { result } = await create(s);
  const check = async api => assert.deepEqual(await api.getExchangeView(s.db, 1, 1), result.troca);
  await check(app.itemExchange);
  await assert.rejects(
    check(
      await mutant(
        "status: row.status,\n    reembolsoPendenteCentavos:",
        'status: "AGUARDANDO_COBRANCA",\n    reembolsoPendenteCentavos:'
      )
    ),
    { code: "ERR_ASSERTION" }
  );
});

test("negative control: destination stock state", async t => {
  const s = await scenario(t, { price: 1500 });
  const { result } = await create(s);
  const check = async api => assert.deepEqual(await api.getExchangeView(s.db, 1, 1), result.troca);
  await check(app.itemExchange);
  await assert.rejects(
    check(
      await mutant(
        "estoqueDestinoEstado: destinationStock?.estoque_estado ?? null",
        'estoqueDestinoEstado: "RESERVADO"'
      )
    ),
    { code: "ERR_ASSERTION" }
  );
});
