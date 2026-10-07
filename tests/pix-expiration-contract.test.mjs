import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./helpers/b3.mjs";

// `criado_em` do SQLite não tem fuso e é UTC. Fuso local diferente de UTC faz uma leitura
// sem o "Z" errar por horas; em CI (UTC) isso passaria despercebido sem esta linha.
process.env.TZ = "America/Sao_Paulo";

// Contrato de expiração do Pix Orders: o body enviado ao Mercado Pago leva só
// `expiration_time` (duração). O prazo terminal da recuperação A1 é o `criado_em` da
// operação + essa duração; o formato legado (`date_of_expiration` absoluto no
// `mp_request`) continua valendo e tem precedência.

const MIN = 60_000;
const CRIADO = Date.UTC(2026, 0, 1, 0, 0, 0); // "2026-01-01 00:00:00": SQLite, UTC, sem fuso
const MARGEM = 24 * 60 * MIN;

const operacao = (mpRequest, criadoEm = "2026-01-01 00:00:00") => ({
  criado_em: criadoEm,
  operation_key: "op-expiracao",
  tipo: "CHECKOUT_SITE",
  fase: "ENVIO_INCONCLUSIVO",
  pedido_id: 1,
  pagamento_id: 1,
  mp_request: mpRequest,
  erro: null,
  atualizado_em: criadoEm
});
const mpRequestCom = payment =>
  JSON.stringify({
    type: "online",
    external_reference: "ref",
    transactions: {
      payments: [
        { amount: "10.00", payment_method: { id: "pix", type: "bank_transfer" }, ...payment }
      ]
    }
  });
const prazoDe = op => app.operacoes.dateOfExpirationDaOperacao(op);

test("o body Pix Orders leva expiration_time PT30M, não leva date_of_expiration, e a duração emitida é entendida pelo parser", async () => {
  const body = await app.orderTypes.createPixOrderBody(1001, "ref", {
    email: "cliente@example.invalid"
  });
  const payment = body.transactions.payments[0];
  assert.equal(payment.expiration_time, "PT30M");
  assert.equal("date_of_expiration" in payment, false);
  assert.deepEqual(Object.keys(payment).sort(), ["amount", "expiration_time", "payment_method"]);

  // Se o builder mudar a duração, o parser estrito precisa continuar cobrindo-a.
  assert.equal(prazoDe(operacao(JSON.stringify(body))), CRIADO + 30 * MIN);
});

test("mp_request legado continua calculando a expiração pela data absoluta (aninhada ou na raiz)", () => {
  const absoluto = Date.UTC(2026, 0, 1, 0, 45, 0);
  const iso = new Date(absoluto).toISOString();
  const raiz = JSON.stringify({
    date_of_expiration: iso,
    transactions: { payments: [{ amount: "1.00" }] }
  });
  for (const [nome, mpRequest] of [
    ["aninhada", mpRequestCom({ date_of_expiration: iso })],
    [
      "aninhada com expiration_time",
      mpRequestCom({ date_of_expiration: iso, expiration_time: "PT30M" })
    ],
    ["raiz", raiz]
  ])
    assert.equal(prazoDe(operacao(mpRequest)), absoluto, nome);

  // Presente mas ilegível: null, sem cair para a duração.
  assert.equal(
    prazoDe(operacao(mpRequestCom({ date_of_expiration: "não é data", expiration_time: "PT30M" }))),
    null
  );
});

test("mp_request novo calcula a expiração por criado_em + expiration_time", () => {
  for (const [duracao, esperadoMs] of [
    ["PT30M", 30 * MIN],
    ["PT1H", 60 * MIN],
    ["PT1H30M", 90 * MIN],
    ["PT90S", 90_000],
    ["P1D", 24 * 60 * MIN],
    ["P30D", 30 * 24 * 60 * MIN]
  ])
    assert.equal(
      prazoDe(operacao(mpRequestCom({ expiration_time: duracao }))),
      CRIADO + esperadoMs,
      duracao
    );

  // `criado_em` já em ISO (com T/Z) também é UTC.
  assert.equal(
    prazoDe(operacao(mpRequestCom({ expiration_time: "PT30M" }), "2026-01-01T00:00:00Z")),
    CRIADO + 30 * MIN
  );
});

test("duração inválida ou fora do formato estrito retorna null (fail-safe)", () => {
  const invalidas = [
    ["ausente", undefined],
    ["vazia", ""],
    ["P sozinho", "P"],
    ["PT sozinho", "PT"],
    ["P1DT sem tempo", "P1DT"],
    ["zero", "PT0M"],
    ["negativa", "PT-30M"],
    ["sinal na frente", "-PT30M"],
    ["minúsculas", "pt30m"],
    ["sem designador", "PT30"],
    ["número como texto", "30"],
    ["espaço no fim", "PT30M "],
    ["fração", "PT1.5H"],
    ["meses", "P1M"],
    ["anos", "P1Y"],
    ["semanas", "P1W"],
    ["exemplo da doc com anos e meses", "P3Y6M4DT12H30M5S"],
    ["acima de 30 dias", "P31D"],
    ["acima de 30 dias por segundos", "P30DT1S"],
    ["dígitos estourando", `PT${"9".repeat(40)}M`],
    ["número", 1800],
    ["null", null],
    ["objeto", {}],
    ["array", ["PT30M"]]
  ];
  for (const [nome, duracao] of invalidas) {
    const payment = duracao === undefined ? {} : { expiration_time: duracao };
    assert.equal(prazoDe(operacao(mpRequestCom(payment))), null, nome);
  }
});

test("sem criado_em utilizável, sem mp_request ou com JSON ilegível o prazo é null", () => {
  for (const criadoEm of ["", "ontem", null, 123])
    assert.equal(
      prazoDe({ ...operacao(mpRequestCom({ expiration_time: "PT30M" })), criado_em: criadoEm }),
      null,
      String(criadoEm)
    );
  assert.equal(prazoDe(operacao(null)), null);
  assert.equal(prazoDe(operacao("{ não é json")), null);
});

test("expiracaoDecorrida mantém a margem de 24h depois do prazo (formato atual e legado)", () => {
  assert.equal(app.operacoes.RECUPERACAO_EXPIRACAO_MARGEM_MS, MARGEM);
  const prazo = CRIADO + 30 * MIN;
  for (const [nome, op] of [
    ["atual", operacao(mpRequestCom({ expiration_time: "PT30M" }))],
    ["legado", operacao(mpRequestCom({ date_of_expiration: new Date(prazo).toISOString() }))]
  ]) {
    assert.equal(app.operacoes.expiracaoDecorrida(op, prazo), false, `${nome}: no prazo`);
    assert.equal(
      app.operacoes.expiracaoDecorrida(op, prazo + MARGEM - 1),
      false,
      `${nome}: 1 ms antes`
    );
    assert.equal(
      app.operacoes.expiracaoDecorrida(op, prazo + MARGEM),
      true,
      `${nome}: fim da margem`
    );
  }

  // Sem prazo determinável nada decorre, por mais tempo que passe.
  const semPrazo = operacao(mpRequestCom({ expiration_time: "P1M" }));
  assert.equal(app.operacoes.expiracaoDecorrida(semPrazo, prazo + 365 * MARGEM), false);
});
