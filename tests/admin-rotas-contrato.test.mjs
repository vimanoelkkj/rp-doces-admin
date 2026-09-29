import test from "node:test";
import assert from "node:assert/strict";
import { carregarRotasAdmin, ambienteIsolado, chamarRota } from "./helpers/adminRotas.mjs";

// Onda 9C · ETAPA 4 — contrato de autenticação das rotas administrativas.
//
// As rotas são enumeradas a partir do sistema de arquivos (helpers/adminRotas.mjs),
// então um arquivo novo em functions/api/admin passa a ser coberto sem que
// ninguém precise lembrar de atualizar este teste. Cada handler é chamado SEM
// cookie e num ambiente sem banco, sem R2 e sem rede: qualquer acesso a dados
// é registrado e lançado. Assim o contrato prova duas coisas ao mesmo tempo —
// a resposta é uma recusa de autenticação/origem/método, e ela aconteceu ANTES
// de qualquer leitura ou escrita.
//
// O invariante é global (função `recusaValida`): sem sessão válida nenhuma rota
// pode responder 2xx/3xx, ainda que não consulte o banco nem faça chamada
// externa. Só 401, 403 e o 404/405 legítimo de um dispatcher explícito passam.
//
// Grep por `requireUser` não é aceito como prova aqui: ele diz que o texto
// existe, não que roda primeiro.

const rotas = await carregarRotasAdmin();
const ORIGEM_LOCAL = "https://local.test";
const ORIGEM_CRUZADA = "https://evil.test";

const CORPO_SESSAO = { error: "Não autenticado" };
const CORPO_ORIGEM = { error: "Origem inválida" };
// Um dispatcher explícito (`export const onRequest`) pode recusar o método que
// não implementa antes de chegar à autenticação. É recusa segura: sem dados.
const ehDispatcher = handler => handler.nome.startsWith("onRequest(");
const STATUS_METODO = new Set([404, 405]);
const STATUS_SESSAO = new Set([401, 403]);

const rotulo = (rota, handler) =>
  `${handler.method} ${rota.url.replace(ORIGEM_LOCAL, "")} · ${rota.arquivo} · ${handler.nome}`;

/**
 * Invariante global do contrato, independente do que cada passe exigir a mais:
 * sem sessão válida nenhuma rota administrativa pode responder sucesso (2xx),
 * redirecionamento (3xx) ou qualquer status fora do vocabulário de recusa —
 * mesmo que ela não consulte o banco nem faça chamada externa. As únicas saídas
 * legítimas são 401 (sessão), 403 (origem) e o 404/405 de um dispatcher
 * explícito pelo método que não implementa.
 */
function recusaValida(status, handler) {
  if (status >= 200 && status < 400) return false;
  if (STATUS_SESSAO.has(status)) return true;
  return ehDispatcher(handler) && STATUS_METODO.has(status);
}

/**
 * Chama um handler sem sessão e exige recusa segura. Retorna `{ status, body }`
 * e lança AssertionError se a rota responder sucesso, um status fora do
 * vocabulário de recusa, ou tocar em dados. `aceitos` só pode APERTAR o
 * contrato de um passe; nunca afrouxar o invariante global.
 */
async function exigirRecusa({ rota, handler, origin, toques, env, aceitos = recusaValida }) {
  let response;
  try {
    response = await chamarRota(handler.handler, rota, {
      env,
      method: handler.method,
      origin
    });
  } catch (erro) {
    assert.fail(`${rotulo(rota, handler)} executou lógica sem sessão: ${erro.message}`);
  }
  const body = await response.json().catch(() => null);
  assert.ok(
    recusaValida(response.status, handler),
    `${rotulo(rota, handler)} respondeu ${response.status} sem sessão válida — sucesso ou status fora do vocabulário de recusa; corpo: ${JSON.stringify(body)}`
  );
  assert.ok(
    aceitos(response.status, handler),
    `${rotulo(rota, handler)} respondeu ${response.status} sem sessão válida; corpo: ${JSON.stringify(body)}`
  );
  if (response.status === 401) assert.deepEqual(body, CORPO_SESSAO, rotulo(rota, handler));
  if (response.status === 403) assert.deepEqual(body, CORPO_ORIGEM, rotulo(rota, handler));
  assert.deepEqual(
    toques,
    [],
    `${rotulo(rota, handler)} tocou em dados sem sessão: ${toques.join(", ")}`
  );
  return { status: response.status, body };
}

// Rede proibida durante toda a suíte: uma rota que chamar o Mercado Pago, o
// push ou qualquer serviço externo sem sessão falha aqui.
let toquesRede = [];
function proibirRede(t) {
  toquesRede = [];
  t.mock.method(globalThis, "fetch", async url => {
    toquesRede.push(`fetch ${url}`);
    throw new Error("rede externa proibida sem sessão válida");
  });
}

test("9C: enumeração cobre todas as rotas administrativas do repositório", async () => {
  // Piso de segurança: se o glob quebrar, a suíte não pode passar em silêncio.
  assert.ok(rotas.length >= 30, `esperava ao menos 30 rotas, vieram ${rotas.length}`);
  for (const rota of rotas) {
    assert.ok(rota.handlers.length >= 1, `${rota.arquivo} não exporta nenhum handler`);
    assert.match(rota.url, /^https:\/\/local\.test\/api\/admin\//, rota.arquivo);
    assert.ok(
      !rota.arquivo.endsWith("_middleware.ts"),
      "middleware não é rota e não deve entrar no contrato"
    );
  }
  const metodos = new Set(rotas.flatMap(rota => rota.handlers.map(h => h.method)));
  for (const esperado of ["GET", "POST", "PUT", "PATCH", "DELETE"])
    assert.ok(metodos.has(esperado), `nenhuma rota exporta ${esperado}`);
});

test("9C: sem cookie, toda rota admin recusa com 401 antes de tocar em dados", async t => {
  proibirRede(t);
  const vistos = new Map();
  for (const rota of rotas) {
    const toques = [];
    const env = ambienteIsolado(toques);
    for (const handler of rota.handlers) {
      const { status } = await exigirRecusa({
        rota,
        handler,
        origin: ORIGEM_LOCAL,
        toques,
        env,
        // Mesmo com origem válida, um dispatcher pode responder 404/405 pelo
        // método que não implementa; tudo o mais tem de ser 401 explícito.
        aceitos: (codigo, h) => codigo === 401 || (ehDispatcher(h) && STATUS_METODO.has(codigo))
      });
      vistos.set(status, (vistos.get(status) ?? 0) + 1);
    }
  }
  assert.deepEqual(toquesRede, [], "nenhuma chamada externa sem sessão");
  const invocacoes = rotas.reduce((n, rota) => n + rota.handlers.length, 0);
  assert.ok(
    (vistos.get(401) ?? 0) >= invocacoes * 0.9,
    `401 deveria ser a recusa dominante: ${vistos.get(401) ?? 0} de ${invocacoes}`
  );
});

test("9C: sem cookie e com origem cruzada, mutações param no 403 do sameOrigin", async t => {
  proibirRede(t);
  const vistos = new Map();
  for (const rota of rotas) {
    const toques = [];
    const env = ambienteIsolado(toques);
    for (const handler of rota.handlers) {
      const { status } = await exigirRecusa({
        rota,
        handler,
        origin: ORIGEM_CRUZADA,
        toques,
        env
        // `aceitos` omitido: vale o invariante global (401/403 + 404/405 de
        // dispatcher), que é exatamente o contrato deste passe.
      });
      vistos.set(status, (vistos.get(status) ?? 0) + 1);
      // GET é imune ao sameOrigin por contrato: sem cookie, só 401 ou o 404 do
      // dispatcher que não implementa o método.
      if (handler.method === "GET")
        assert.ok(
          status === 401 || (ehDispatcher(handler) && STATUS_METODO.has(status)),
          `${rotulo(rota, handler)} respondeu ${status} para GET sem cookie`
        );
    }
  }
  assert.deepEqual(toquesRede, [], "nenhuma chamada externa sem sessão");
  assert.ok(
    (vistos.get(403) ?? 0) >= 20,
    `mutações de origem cruzada deveriam parar no 403 do sameOrigin: ${vistos.get(403) ?? 0}`
  );
});

test("9C: auto-verificação — o contrato reprova uma rota admin sem proteção", async t => {
  // Prova de que este teste não passa por vacuidade. Três formatos de rota nova
  // criada SEM `requireUser` são reprovados pela mesma função `exigirRecusa`
  // usada nos passes reais; no fim, o controle mostra que uma rota protegida é
  // aprovada — ou seja, o verificador não reprova tudo por construction.
  proibirRede(t);
  const rotaDesprotegida = {
    arquivo: "functions/api/admin/exemplo-sem-guard.ts",
    url: "https://local.test/api/admin/exemplo-sem-guard",
    params: {}
  };
  const get = handler => ({ nome: "onRequestGet", method: "GET", handler });
  const vaza = () => Response.json({ segredo: "vazou" });

  // Caso 1: lê o banco — o ambiente isolado lança e o verificador reprova.
  const toquesLeitura = [];
  await assert.rejects(
    exigirRecusa({
      rota: rotaDesprotegida,
      handler: get(async ({ env }) => {
        await env.DB.prepare("SELECT 1").first();
        return vaza();
      }),
      origin: ORIGEM_LOCAL,
      toques: toquesLeitura,
      env: ambienteIsolado(toquesLeitura)
    }),
    /executou lógica sem sessão/
  );

  // Caso 2 — a lacuna fechada: responde 200 sem tocar em banco, R2 ou rede.
  // Nenhum `aceitos` é fornecido; quem reprova é somente o invariante global.
  const toquesSilenciosos = [];
  await assert.rejects(
    exigirRecusa({
      rota: rotaDesprotegida,
      handler: get(async () => vaza()),
      origin: ORIGEM_LOCAL,
      toques: toquesSilenciosos,
      env: ambienteIsolado(toquesSilenciosos)
    }),
    /respondeu 200 sem sessão válida — sucesso ou status fora do vocabulário de recusa/
  );
  assert.deepEqual(toquesSilenciosos, [], "a rota silenciosa de fato não tocou em dados");
  assert.deepEqual(toquesRede, [], "e não fez nenhuma chamada externa");

  // Caso 3: o mesmo 200 indevido com origem cruzada — o invariante global vale
  // nos dois passes, não apenas no de mesma origem.
  const toquesCruzada = [];
  await assert.rejects(
    exigirRecusa({
      rota: rotaDesprotegida,
      handler: get(async () => vaza()),
      origin: ORIGEM_CRUZADA,
      toques: toquesCruzada,
      env: ambienteIsolado(toquesCruzada)
    }),
    /respondeu 200 sem sessão válida/
  );
  assert.deepEqual(toquesCruzada, []);

  // Controle: formato idêntico, resposta correta -> aprovado.
  const toquesProtegida = [];
  const protegida = await exigirRecusa({
    rota: rotaDesprotegida,
    handler: get(async () => Response.json(CORPO_SESSAO, { status: 401 })),
    origin: ORIGEM_LOCAL,
    toques: toquesProtegida,
    env: ambienteIsolado(toquesProtegida)
  });
  assert.deepEqual(protegida, { status: 401, body: CORPO_SESSAO });
  assert.deepEqual(toquesProtegida, []);
});
