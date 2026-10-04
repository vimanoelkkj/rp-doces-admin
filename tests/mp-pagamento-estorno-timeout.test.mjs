import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./helpers/b3.mjs";

// Helpers HTTP do Mercado Pago que movem dinheiro: criar cobrança (POST), cancelar
// cobrança (PUT), criar estorno (POST) e consultar estorno (GET). O prazo de 20 s
// vale para a operação HTTP INTEIRA, headers e corpo (como em fetchMpPayment e em
// mpSearch). Antes, o timer era desarmado assim que os headers chegavam e um corpo
// que nunca terminava pendurava a chamada sem limite, quebrando a premissa de que
// o POST termina em 20 s (o corte de recuperação e o lease de estorno são de 60 s).
//
// Classificação financeira preservada (nenhuma muda com este prazo):
//   headers ou corpo 2xx que não terminam .. AMBIGUO/TIMEOUT (nunca SUCESSO nem RECUSA)
//   4xx ................................... RECUSA_DEFINITIVA, decidida pelo STATUS;
//                                              o corpo só traz mensagem (null se travar)
//   5xx, 408, 429 ......................... AMBIGUO/HTTP_INDISPONIVEL
//   2xx com corpo inválido ................ AMBIGUO/RESPOSTA_ILEGIVEL
//   o timeout nunca dispara um novo envio (exatamente 1 chamada ao fetch)

const { MP_PAYMENT_POST_TIMEOUT_MS } = app.mpPost;
const { MP_REFUND_TIMEOUT_MS } = app.mpRefund;

const HELPERS = [
  {
    nome: "postPagamentoMp",
    indeterminado: true, // status <400 não-ok: AMBIGUO/HTTP_INDETERMINADO
    prazo: MP_PAYMENT_POST_TIMEOUT_MS,
    metodo: "POST",
    statusOk: 201,
    chamar: () => app.mpPost.postPagamentoMp("fake", "key-1", { transaction_amount: 10 }),
    respostaValida: () =>
      Response.json({ id: 9001, status: "pending", date_of_expiration: null }, { status: 201 }),
    ehSucesso: r => r.resultado === "SUCESSO" && r.payment.id === 9001
  },
  {
    nome: "cancelarPagamentoMp",
    indeterminado: true,
    prazo: MP_PAYMENT_POST_TIMEOUT_MS,
    metodo: "PUT",
    statusOk: 200,
    chamar: () => app.mpPost.cancelarPagamentoMp("fake", 9001, "key-1"),
    respostaValida: () => Response.json({ status: "cancelled", status_detail: "by_collector" }),
    ehSucesso: r => r.resultado === "SUCESSO" && r.status === "cancelled"
  },
  {
    nome: "postRefundMp",
    indeterminado: true,
    prazo: MP_REFUND_TIMEOUT_MS,
    metodo: "POST",
    statusOk: 201,
    chamar: () => app.mpRefund.postRefundMp("fake", "9001", "key-1", { amountCentavos: 1500 }),
    respostaValida: () =>
      Response.json({ id: 555, payment_id: 9001, amount: 15, status: "approved" }, { status: 201 }),
    ehSucesso: r => r.resultado === "SUCESSO" && r.refund.id === 555
  },
  {
    nome: "getRefundMp", // sem ramo para status <400 (comportamento preexistente, sem efeito financeiro)
    prazo: MP_REFUND_TIMEOUT_MS,
    metodo: undefined, // GET: sem `method` explícito
    statusOk: 200,
    chamar: () => app.mpRefund.getRefundMp("fake", "9001", "555", 1500),
    respostaValida: () =>
      Response.json({ id: 555, payment_id: 9001, amount: 15, status: "approved" }),
    ehSucesso: r => r.resultado === "SUCESSO" && r.refund.id === 555
  }
];

// Rejeita quando o prazo aborta o fetch, como o runtime faz com uma leitura em curso.
const pendenteAteAbortar = signal =>
  new Promise((_, rejeitar) =>
    signal.addEventListener("abort", () => rejeitar(signal.reason), { once: true })
  );

// Deixa a chamada assentar; se não assentar devolve "PENDENTE" em vez de travar o teste.
async function assentar(promessa) {
  await new Promise(setImmediate);
  return Promise.race([promessa, new Promise(r => setImmediate(() => r("PENDENTE")))]);
}

// Roda `helper` contra uma resposta simulada, avança o relógio até o prazo e devolve
// o resultado, o sinal capturado e as chamadas feitas ao fetch.
async function executar(t, helper, resposta, { avancar = true } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const chamadas = [];
  let sinal = null;
  const mock = t.mock.method(globalThis, "fetch", (_url, opcoes) => {
    chamadas.push(opcoes);
    sinal = opcoes.signal;
    return resposta(opcoes.signal);
  });
  const promessa = helper.chamar();
  await new Promise(setImmediate); // o fetch resolveu e a leitura do corpo começou
  if (avancar) t.mock.timers.tick(helper.prazo);
  const resultado = await assentar(promessa);
  const limpar = () => {
    mock.mock.restore();
    t.mock.timers.reset();
  };
  return { resultado, sinal, chamadas, limpar };
}

test("os prazos dos helpers continuam em 20 s (o corte de recuperação de 60 s depende disso)", () => {
  assert.equal(MP_PAYMENT_POST_TIMEOUT_MS, 20_000);
  assert.equal(MP_REFUND_TIMEOUT_MS, 20_000);
});

for (const helper of HELPERS) {
  const verificaChamadaUnica = chamadas => {
    assert.equal(chamadas.length, 1, "o timeout não pode disparar novo envio");
    assert.equal(chamadas[0].method, helper.metodo);
  };

  test(`${helper.nome}: headers pendentes além do prazo terminam AMBIGUO/TIMEOUT`, async t => {
    const { resultado, chamadas } = await executar(t, helper, signal => pendenteAteAbortar(signal));
    assert.deepEqual(resultado, { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: null });
    verificaChamadaUnica(chamadas);
  });

  test(`${helper.nome}: 2xx com corpo travado termina AMBIGUO/TIMEOUT, nunca SUCESSO`, async t => {
    const { resultado, chamadas } = await executar(t, helper, signal => ({
      ok: true,
      status: helper.statusOk,
      json: () => pendenteAteAbortar(signal),
      text: () => pendenteAteAbortar(signal)
    }));
    assert.deepEqual(
      resultado,
      { resultado: "AMBIGUO", motivo: "TIMEOUT", httpStatus: helper.statusOk },
      "o prazo precisa continuar armado durante a leitura do corpo"
    );
    verificaChamadaUnica(chamadas);
  });

  test(`${helper.nome}: 4xx com corpo travado segue o STATUS (RECUSA_DEFINITIVA), nunca SUCESSO`, async t => {
    const { resultado, chamadas } = await executar(t, helper, signal => ({
      ok: false,
      status: 422,
      text: () => pendenteAteAbortar(signal)
    }));
    assert.deepEqual(resultado, {
      resultado: "RECUSA_DEFINITIVA",
      httpStatus: 422,
      mensagem: null,
      detalhe: null
    });
    verificaChamadaUnica(chamadas);
  });

  test(`${helper.nome}: 4xx legível mantém a mensagem do provedor`, async t => {
    const { resultado, sinal } = await executar(
      t,
      helper,
      () => Response.json({ message: "dado inválido", cause: [{ code: 1 }] }, { status: 422 }),
      { avancar: false }
    );
    assert.equal(resultado.resultado, "RECUSA_DEFINITIVA");
    assert.equal(resultado.httpStatus, 422);
    assert.equal(resultado.mensagem, "dado inválido");
    t.mock.timers.tick(helper.prazo);
    assert.equal(sinal.aborted, false, "o prazo é desarmado ao concluir");
  });

  test(`${helper.nome}: 2xx com corpo inválido segue AMBIGUO/RESPOSTA_ILEGIVEL, nunca TIMEOUT`, async t => {
    const { resultado, sinal } = await executar(
      t,
      helper,
      () => new Response("<html>não é json</html>", { status: helper.statusOk }),
      { avancar: false }
    );
    assert.deepEqual(resultado, {
      resultado: "AMBIGUO",
      motivo: "RESPOSTA_ILEGIVEL",
      httpStatus: helper.statusOk
    });
    t.mock.timers.tick(helper.prazo);
    assert.equal(sinal.aborted, false, "o prazo é desarmado ao concluir");
  });

  test(`${helper.nome}: falha de leitura do corpo que não é abort segue AMBIGUO/RESPOSTA_ILEGIVEL`, async t => {
    const { resultado } = await executar(
      t,
      helper,
      () => ({
        ok: true,
        status: helper.statusOk,
        json: async () => {
          throw new TypeError("terminated");
        }
      }),
      { avancar: false }
    );
    assert.deepEqual(resultado, {
      resultado: "AMBIGUO",
      motivo: "RESPOSTA_ILEGIVEL",
      httpStatus: helper.statusOk
    });
  });

  test(`${helper.nome}: 5xx, 408 e 429 seguem AMBIGUO/HTTP_INDISPONIVEL`, async t => {
    for (const status of [500, 503, 408, 429]) {
      const { resultado, sinal, limpar } = await executar(
        t,
        helper,
        () => new Response("indisponível", { status }),
        { avancar: false }
      );
      assert.deepEqual(resultado, {
        resultado: "AMBIGUO",
        motivo: "HTTP_INDISPONIVEL",
        httpStatus: status
      });
      t.mock.timers.tick(helper.prazo);
      assert.equal(sinal.aborted, false, `HTTP ${status}: o prazo é desarmado ao concluir`);
      limpar();
    }
  });

  if (helper.indeterminado) {
    test(`${helper.nome}: status <400 não-ok segue AMBIGUO/HTTP_INDETERMINADO`, async t => {
      const { resultado, sinal, chamadas } = await executar(
        t,
        helper,
        () => new Response(null, { status: 304 }),
        { avancar: false }
      );
      assert.deepEqual(resultado, {
        resultado: "AMBIGUO",
        motivo: "HTTP_INDETERMINADO",
        httpStatus: 304
      });
      t.mock.timers.tick(helper.prazo);
      assert.equal(sinal.aborted, false, "o prazo é desarmado ao concluir");
      verificaChamadaUnica(chamadas);
    });
  }

  test(`${helper.nome}: resposta válida segue SUCESSO e o prazo é desarmado`, async t => {
    const { resultado, sinal, chamadas } = await executar(t, helper, helper.respostaValida, {
      avancar: false
    });
    assert.ok(helper.ehSucesso(resultado), JSON.stringify(resultado));
    t.mock.timers.tick(helper.prazo);
    assert.equal(sinal.aborted, false, "o prazo é desarmado ao concluir");
    verificaChamadaUnica(chamadas);
  });
}
