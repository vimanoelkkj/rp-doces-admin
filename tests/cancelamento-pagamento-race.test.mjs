import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture, state, refund, barrier } from "./helpers/b3.mjs";

// Testes determinísticos para as duas condições de corrida entre cancelamento operacional
// e registro de pagamentos manuais.
//
// 1. Guard de saldo líquido diretamente no UPDATE atômico do cancelamento.
// 2. Elegibilidade operacional no INSERT financeiro do pagamento manual.
// 3. Replay A1, estorno integral, Pix pendente, entrega legítima e rollback transacional.

const KEY_PAGAMENTO = "11111111-2222-4333-8444-555555555555";
const KEY_RETRY = "22222222-3333-4444-8555-666666666666";
const silenciarLogs = t => t.mock.method(console, "error", () => {});

async function patchStatus(db, session, id = "1", statusPedido = "CANCELADO") {
  const response = await app.adminOrder.onRequestPatch({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: String(id) },
    request: new Request(`https://local.test/api/admin/pedidos/${id}`, {
      method: "PATCH",
      headers: {
        Cookie: session.cookie.split(";")[0],
        Origin: "https://local.test",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ statusPedido })
    })
  });
  return { response, body: await response.json() };
}

async function postPagamentoManual(db, session, id = "1", extra = {}) {
  const response = await app.adminPayment.onRequestPost({
    env: { DB: db, MP_ACCESS_TOKEN: "fake" },
    params: { id: String(id) },
    request: new Request(`https://local.test/api/admin/pedidos/${id}/pagamentos`, {
      method: "POST",
      headers: {
        Cookie: session.cookie.split(";")[0],
        Origin: "https://local.test",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metodo: "DINHEIRO",
        valorCentavos: 10000,
        operationKey: KEY_PAGAMENTO,
        ...extra
      })
    })
  });
  return { response, body: await response.json() };
}

/* ─────────────────────────── ORDEM 1 DA CORRIDA ─────────────────────────── */

test("Ordem 1: pagamento manual confirma antes do UPDATE do cancelamento => cancelamento rejeitado com 409", async t => {
  silenciarLogs(t);
  // Pedido sem Pix pendente inicial, pronto para ser cancelado se nada mudar
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let pagamentoConfirmado = false;
  // Intercepta o momento exato em que o cancelamento vai executar o UPDATE do status_pedido
  db.hook = async (s, op) => {
    if (op === "run" && s[0]?.sql?.includes("SET status_pedido = ?") && !pagamentoConfirmado) {
      pagamentoConfirmado = true;
      const pag = await postPagamentoManual(db, session, "1", {
        operationKey: KEY_PAGAMENTO,
        valorCentavos: 10000
      });
      assert.equal(pag.response.status, 201, "pagamento manual deve ter sido aceito");
      assert.equal(pag.body.ok, true);
    }
  };

  const cancel = await patchStatus(db, session, "1", "CANCELADO");
  db.hook = null;

  assert.equal(pagamentoConfirmado, true, "corrida foi acionada");
  assert.equal(
    cancel.response.status,
    409,
    "cancelamento deve falhar com 409 devido ao saldo retido"
  );
  assert.match(cancel.body.error, /estorno antes de cancelar/i);

  const s = await state(db);
  assert.notEqual(s.pedido.status_pedido, "CANCELADO", "pedido não pode ter virado CANCELADO");
  assert.equal(s.pagamentos.length, 1, "pagamento registrado");
  assert.equal(s.pagamentos[0].status, "PAGO", "pagamento permanece PAGO");
  assert.equal(s.produtos[0].estoque, 8, "estoque baixado pelo pagamento confirmado");
  assert.equal(s.pedido.reserva_status, "CONVERTIDA", "reserva convertida, não liberada");
});

/* ─────────────────────────── ORDEM 2 DA CORRIDA ─────────────────────────── */

test("Ordem 2: cancelamento confirma antes do batch do pagamento manual => pagamento rejeitado com 409 e rollback total", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let cancelado = false;
  // Intercepta a escrita do pagamento antes do batch atômico
  db.hook = async (s, op) => {
    if (
      op === "batch" &&
      s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos")) &&
      !cancelado
    ) {
      cancelado = true;
      const cancel = await patchStatus(db, session, "1", "CANCELADO");
      assert.equal(cancel.response.status, 200, "cancelamento foi aceito");
      assert.equal(cancel.body.ok, true);
    }
  };

  const pag = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  db.hook = null;

  assert.equal(cancelado, true, "corrida foi acionada");
  assert.equal(pag.response.status, 409, "pagamento manual deve falhar com 409");
  assert.equal(pag.body.code, "COMANDA_ENCERRADA");
  assert.match(pag.body.error, /comanda já foi encerrada/i);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "CANCELADO", "pedido permanece cancelado");
  assert.equal(s.pedido.reserva_status, "LIBERADA", "reserva foi liberada");
  assert.equal(s.produtos[0].estoque_reservado, 0, "estoque reservado zerado");
  assert.equal(s.produtos[0].estoque, 10, "nenhum estoque deduzido");

  // Rollback total: nenhum registro financeiro ou de claim criado
  assert.equal(s.pagamentos.length, 0, "nenhum pagamento inserido");
  assert.equal(s.alocacoes.length, 0, "nenhuma alocação inserida");
  assert.equal(s.operacoes.length, 0, "nenhuma operação A1 inserida");
});

/* ─────────────────────────── REPLAY A1 ─────────────────────────── */

test("Replay A1: retentativa idempotente do mesmo pagamento manual mantém o fato e resultado", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  const primeiro = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_RETRY,
    valorCentavos: 5000
  });
  assert.equal(primeiro.response.status, 201);
  assert.equal(primeiro.body.ok, true);
  const pagamentoId = primeiro.body.pagamentoId;

  // Replay da mesma intenção com mesmo payload
  const retry = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_RETRY,
    valorCentavos: 5000
  });
  assert.equal(retry.response.status, 201);
  assert.equal(retry.body.ok, true);
  assert.equal(retry.body.replay, true);
  assert.equal(retry.body.pagamentoId, pagamentoId);

  const s = await state(db);
  assert.equal(s.pagamentos.length, 1, "exatamente 1 pagamento");
  assert.equal(s.alocacoes.length, 1, "exatamente 1 alocação");
  assert.equal(s.operacoes.length, 1, "exatamente 1 registro A1");
});

test("Replay A1 com conflito de payload rejeita com 409", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  const primeiro = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_RETRY,
    valorCentavos: 5000
  });
  assert.equal(primeiro.response.status, 201);

  // Tentativa com mesmo operationKey mas valor diferente
  const conflito = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_RETRY,
    valorCentavos: 6000
  });
  assert.equal(conflito.response.status, 409);
  assert.equal(conflito.body.code, "OPERACAO_CONFLITO_PAYLOAD");
});

/* ─────────────────────────── ESTORNO INTEGRAL ─────────────────────────── */

test("Estorno integral destrava o cancelamento atômico", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { paid: true });
  const session = await app.auth.createSession(db, 1);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);

  // Antes do estorno: bloqueado por saldo líquido > 0
  const bloqueado = await patchStatus(db, session, "1", "CANCELADO");
  assert.equal(bloqueado.response.status, 409);
  assert.match(bloqueado.body.error, /estorno antes de cancelar/i);

  // Executa estorno integral (10000 centavos)
  await refund(db, 10000);
  await app.reconcile.reconcilePedidoAfterFinancialChange(db, 1);

  // Saldo líquido agora é 0: cancelamento deve ter sucesso
  const cancel = await patchStatus(db, session, "1", "CANCELADO");
  assert.equal(cancel.response.status, 200);
  assert.equal(cancel.body.ok, true);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "CANCELADO");
  assert.equal(s.refunds.length, 1);
  assert.equal(s.refunds[0].status, "REEMBOLSADO");
});

/* ─────────────────────────── PIX PENDENTE ─────────────────────────── */

test("Pix pendente ativo continua bloqueando o cancelamento atômico", async t => {
  silenciarLogs(t);
  const db = await fixture(t); // cria pedido com Pix pendente
  const session = await app.auth.createSession(db, 1);

  const cancel = await patchStatus(db, session, "1", "CANCELADO");
  assert.equal(cancel.response.status, 409);
  assert.equal(cancel.body.code, "PEDIDO_COM_PIX_PENDENTE");
  assert.match(cancel.body.error, /Pix pendente/i);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "NOVO");
  assert.equal(s.pedido.reserva_status, "ATIVA");
});

/* ─────────────────────────── PAGAMENTO APÓS ENTREGA ─────────────────────────── */

test("Pagamento legítimo após entrega (ENTREGUE) é preservado e aceito", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  // Entrega o pedido (trigger encerra comanda para ENTREGUE)
  const entrega = await patchStatus(db, session, "1", "ENTREGUE");
  assert.equal(entrega.response.status, 200);

  const sEntrega = await state(db);
  assert.equal(sEntrega.pedido.status_pedido, "ENTREGUE");
  assert.equal(sEntrega.pedido.status_comanda, "ENCERRADA");

  // Pagamento manual após a entrega deve ter sucesso
  const pag = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  assert.equal(pag.response.status, 201);
  assert.equal(pag.body.ok, true);

  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "ENTREGUE");
  assert.equal(s.pedido.status_pagamento, "PAGO");
  assert.equal(s.pagamentos.length, 1);
  assert.equal(s.pagamentos[0].status, "PAGO");
});

/* ─────────────────────────── CONCORRÊNCIA COM BARREIRA ─────────────────────────── */

test("Concorrência determinística com barreira: exatamente uma operação vence", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  const gate = barrier(2);
  let passouCancel = false;
  let passouPag = false;

  db.hook = async (s, op) => {
    if (op === "run" && s[0]?.sql?.includes("SET status_pedido = ?") && !passouCancel) {
      passouCancel = true;
      await gate();
    }
    if (
      op === "batch" &&
      s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos")) &&
      !passouPag
    ) {
      passouPag = true;
      await gate();
    }
  };

  const [resCancel, resPag] = await Promise.all([
    patchStatus(db, session, "1", "CANCELADO"),
    postPagamentoManual(db, session, "1", { operationKey: KEY_PAGAMENTO, valorCentavos: 10000 })
  ]);
  db.hook = null;

  assert.equal(passouCancel, true);
  assert.equal(passouPag, true);

  // Exatamente um foi aceito (200 para cancelamento ou 201 para pagamento) e o outro rejeitado com 409
  const s = await state(db);
  if (resCancel.response.status === 200) {
    // Cancelamento venceu
    assert.equal(resPag.response.status, 409);
    assert.equal(s.pedido.status_pedido, "CANCELADO");
    assert.equal(s.pagamentos.length, 0);
  } else {
    // Pagamento venceu
    assert.equal(resCancel.response.status, 409);
    assert.equal(resPag.response.status, 201);
    assert.notEqual(s.pedido.status_pedido, "CANCELADO");
    assert.equal(s.pagamentos.length, 1);
    assert.equal(s.pagamentos[0].status, "PAGO");
  }
});

/* ─────────────────────────── TESTES NEGATIVOS: FALHA DE INFRAESTRUTURA ─────────────────────────── */

test("Negativo: falha de infraestrutura no batch de pagamento manual resulta em 500 (não 409) com rollback e sem órfãos", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let hookDisparado = false;
  db.hook = async (s, op) => {
    if (op === "batch" && s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos"))) {
      hookDisparado = true;
      throw new Error("D1_SIMULATED_INFRASTRUCTURE_FAILURE");
    }
  };

  const res = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  db.hook = null;

  assert.equal(hookDisparado, true, "falha simulada no batch foi injetada");
  assert.equal(
    res.response.status,
    500,
    "deve retornar 500 e não mascarar erro de infraestrutura como 409"
  );
  assert.match(res.body.error, /erro interno/i);

  // Confirmação de rollback e ausência total de registros órfãos
  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "NOVO", "pedido permanece intacto");
  assert.equal(s.pedido.status_pagamento, "PENDENTE");
  assert.equal(s.pagamentos.length, 0, "nenhum pagamento persistido");
  assert.equal(s.alocacoes.length, 0, "nenhuma alocação órfã");
  assert.equal(s.operacoes.length, 0, "nenhum claim A1 órfão");
  assert.equal(s.produtos[0].estoque, 10, "estoque não alterado");
  assert.equal(s.produtos[0].estoque_reservado, 2, "reserva preservada");

  // Recuperação: após a infraestrutura restabelecida, retry com a mesma chave sucede
  const retry = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  assert.equal(retry.response.status, 201, "retry legítimo pós-falha deve ser aceito");
  assert.equal(retry.body.ok, true);

  const s2 = await state(db);
  assert.equal(s2.pagamentos.length, 1, "exatamente 1 pagamento");
  assert.equal(s2.alocacoes.length, 1, "exatamente 1 alocação");
  assert.equal(s2.operacoes.length, 1, "exatamente 1 claim");
});

test("Negativo: falha de infraestrutura no UPDATE de cancelamento resulta em 500 (não 409) com rollback e sem órfãos", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let hookDisparado = false;
  db.hook = async (s, op) => {
    if (op === "run" && s[0]?.sql?.includes("SET status_pedido = ?")) {
      hookDisparado = true;
      throw new Error("D1_SIMULATED_INFRASTRUCTURE_FAILURE");
    }
  };

  const res = await patchStatus(db, session, "1", "CANCELADO");
  db.hook = null;

  assert.equal(hookDisparado, true, "falha simulada no UPDATE foi injetada");
  assert.equal(
    res.response.status,
    500,
    "deve retornar 500 e não mascarar erro de infraestrutura como 409"
  );
  assert.match(res.body.error, /erro interno/i);

  // Confirmação de rollback
  const s = await state(db);
  assert.equal(s.pedido.status_pedido, "NOVO", "pedido permanece NOVO");
  assert.equal(s.pedido.reserva_status, "ATIVA", "reserva permanece ATIVA");
  assert.equal(s.produtos[0].estoque_reservado, 2, "estoque reservado permanece intacto");

  // Recuperação: após a infraestrutura restabelecida, cancelamento procede normalmente
  const retry = await patchStatus(db, session, "1", "CANCELADO");
  assert.equal(retry.response.status, 200, "cancelamento após restabelecimento deve suceder");
  assert.equal(retry.body.ok, true);

  const s2 = await state(db);
  assert.equal(s2.pedido.status_pedido, "CANCELADO");
  assert.equal(s2.pedido.reserva_status, "LIBERADA");
});

/* ─────────────────────────── OS 3 CENÁRIOS DO CODEX ─────────────────────────── */

test("Codex 1: falha de infraestrutura no batch onde o pedido é cancelado concorrentemente retorna 500 (não 409)", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let hookDisparado = false;
  db.hook = async (s, op) => {
    if (op === "batch" && s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos"))) {
      hookDisparado = true;
      // Cancela o pedido no banco simulando modificação concorrente no momento da falha
      await db
        .prepare(
          "UPDATE pedidos SET status_pedido = 'CANCELADO', status_comanda = 'ENCERRADA' WHERE id = 1"
        )
        .run();
      throw new Error("D1_INFRASTRUCTURE_FAILURE_DURING_WRITE");
    }
  };

  const res = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  db.hook = null;

  assert.equal(hookDisparado, true);
  assert.equal(res.response.status, 500, "deve retornar 500 e não 409 COMANDA_ENCERRADA");
  assert.match(res.body.error, /erro interno/i);
});

test("Codex 2: falha de infraestrutura no batch onde surge captura Pix não conciliada retorna 500 (não 409)", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let hookDisparado = false;
  db.hook = async (s, op) => {
    if (op === "batch" && s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos"))) {
      hookDisparado = true;
      // Insere captura Pix remota não conciliada concorrente
      await db
        .prepare(
          `INSERT INTO pedido_pagamentos(pedido_id, metodo, origem, valor_centavos, status, mp_status, idempotency_key)
         VALUES(1, 'PIX_MP', 'ADMIN', 10000, 'PENDENTE', 'approved', 'pix-captura-concorrente')`
        )
        .run();
      throw new Error("D1_INFRASTRUCTURE_FAILURE_DURING_WRITE");
    }
  };

  const res = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  db.hook = null;

  assert.equal(hookDisparado, true);
  assert.equal(res.response.status, 500, "deve retornar 500 e não 409 CAPTURA_MP_NAO_CONCILIADA");
  assert.match(res.body.error, /erro interno/i);
});

test("Codex 3: falha de infraestrutura no batch onde outro pagamento consome a capacidade retorna 500 (não 409)", async t => {
  silenciarLogs(t);
  const db = await fixture(t, { ledger: false });
  const session = await app.auth.createSession(db, 1);

  let hookDisparado = false;
  db.hook = async (s, op) => {
    if (op === "batch" && s.some(x => x.sql?.includes("INSERT INTO pedido_pagamentos"))) {
      hookDisparado = true;
      // Outro pagamento consome a capacidade concorrentemente
      await db
        .prepare(
          `INSERT INTO pedido_pagamentos(pedido_id, metodo, origem, valor_centavos, status, idempotency_key)
         VALUES(1, 'DINHEIRO', 'ADMIN', 10000, 'PAGO', 'outro-pagamento-concorrente')`
        )
        .run();
      throw new Error("D1_INFRASTRUCTURE_FAILURE_DURING_WRITE");
    }
  };

  const res = await postPagamentoManual(db, session, "1", {
    operationKey: KEY_PAGAMENTO,
    valorCentavos: 10000
  });
  db.hook = null;

  assert.equal(hookDisparado, true);
  assert.equal(
    res.response.status,
    500,
    "deve retornar 500 e não 409 SALDO_INSUFICIENTE_CONCORRENCIA"
  );
  assert.match(res.body.error, /erro interno/i);
});
