import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./helpers/b3.mjs";

// Busca de pagamentos no Mercado Pago por external_reference (B-3): o prazo vale para
// a consulta INTEIRA, headers e corpo, como em fetchMpPayment. Antes o timer era
// desarmado assim que os headers chegavam, e um corpo que nunca terminava prendia a
// chamada sem limite, junto com a reconciliação e a anulação de pedido que a aguardam.

const { buscarPagamentosPorReferenciaExterna: buscar, MP_PAYMENT_SEARCH_TIMEOUT_MS: PRAZO } =
  app.mpSearch;
const INDISPONIVEL = motivo => ({ resultado: "INDISPONIVEL", motivo });

// Rejeita quando o prazo aborta o fetch, como o runtime faz com uma leitura em curso.
const pendenteAteAbortar = signal =>
  new Promise((_, rejeitar) =>
    signal.addEventListener("abort", () => rejeitar(signal.reason), { once: true })
  );

// Deixa a busca assentar; se não assentar devolve "PENDENTE" em vez de travar o teste.
async function assentar(busca) {
  await new Promise(setImmediate);
  return Promise.race([busca, new Promise(resolver => setImmediate(() => resolver("PENDENTE")))]);
}

test("corpo pendente além do prazo: o abort ainda vale e a busca termina como TIMEOUT", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const chamadas = [];
  t.mock.method(globalThis, "fetch", async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    // Headers chegam; o corpo nunca termina.
    return { ok: true, status: 200, json: () => pendenteAteAbortar(opcoes.signal) };
  });

  const busca = buscar("fake", "ref-1");
  await new Promise(setImmediate); // fetch resolveu, json() segue pendente
  t.mock.timers.tick(PRAZO);

  assert.deepEqual(
    await assentar(busca),
    INDISPONIVEL("TIMEOUT"),
    "o timer precisa continuar armado durante a leitura do corpo"
  );
  assert.equal(chamadas.length, 1);
  assert.notEqual(chamadas[0].opcoes.method, "POST", "a busca é leitura: nunca POST");
});

test("headers pendentes além do prazo: TIMEOUT (comportamento preservado)", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url, opcoes) => pendenteAteAbortar(opcoes.signal));

  const busca = buscar("fake", "ref-1");
  t.mock.timers.tick(PRAZO);

  assert.deepEqual(await assentar(busca), INDISPONIVEL("TIMEOUT"));
});

for (const [nome, resposta, motivo] of [
  ["HTTP 503", () => new Response("indisponível", { status: 503 }), "HTTP_503"],
  [
    "JSON inválido",
    () => new Response("<html>não é json</html>", { status: 200 }),
    "RESPOSTA_ILEGIVEL"
  ],
  ["JSON sem results", () => Response.json({ paging: {} }), "RESPOSTA_ILEGIVEL"],
  [
    "falha de leitura do corpo que não é abort",
    () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new TypeError("terminated");
      }
    }),
    "RESPOSTA_ILEGIVEL"
  ]
]) {
  test(`${nome}: ${motivo}, nunca TIMEOUT, e o prazo é desarmado`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let sinal;
    t.mock.method(globalThis, "fetch", async (_url, opcoes) => {
      sinal = opcoes.signal;
      return resposta();
    });

    assert.deepEqual(await buscar("fake", "ref-1"), INDISPONIVEL(motivo));
    t.mock.timers.tick(PRAZO);
    assert.equal(sinal.aborted, false, "o timer não pode sobrar armado depois de concluir");
  });
}

test("corpo completo dentro do prazo: resultado normal e prazo desarmado", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let sinal;
  t.mock.method(globalThis, "fetch", async (_url, opcoes) => {
    sinal = opcoes.signal;
    return Response.json({ results: [{ id: 9001, external_reference: "ref-1" }] });
  });

  assert.deepEqual(await buscar("fake", "ref-1"), { resultado: "UNICO", mpPaymentId: "9001" });
  t.mock.timers.tick(PRAZO);
  assert.equal(sinal.aborted, false, "o timer não pode sobrar armado depois de concluir");
});
