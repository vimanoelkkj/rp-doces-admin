import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

// A tela não deve prometer uma exclusão que o servidor vai recusar. O servidor informa
// `anulacaoBloqueio`; enquanto houver dinheiro Pix a devolver o modal continua útil (o estorno é
// um clique separado), então a ação segue oferecida.

const detalhe = (db, session) =>
  app.adminOrder.onRequestGet({
    env: { DB: db },
    params: { id: "1" },
    request: new Request("https://local.test/api/admin/pedidos/1", {
      headers: { Cookie: session.cookie.split(";")[0] }
    })
  });
const lerBloqueio = async (db, session) => {
  const response = await detalhe(db, session);
  assert.equal(response.status, 200);
  return (await response.json()).anulacaoBloqueio;
};
const reembolso = (db, valor) =>
  db
    .prepare(
      `INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,mp_refund_id,idempotency_key)
       VALUES(1,1,'MERCADO_PAGO','PIX_MP',?,'REEMBOLSADO',?,?)`
    )
    .bind(valor, `ref-${valor}-${Math.random()}`, `idem-${valor}-${Math.random()}`)
    .run();

async function cenario(t) {
  const db = await fixture(t, { paid: true, reserve: "CONVERTIDA" });
  return { db, session: await app.auth.createSession(db, 1) };
}

test("servidor: pago e ainda não estornado => modal continua oferecido (estorno é clique separado)", async t => {
  const { db, session } = await cenario(t);
  assert.equal(await lerBloqueio(db, session), null);
  await reembolso(db, 6000);
  assert.equal(await lerBloqueio(db, session), null, "estorno parcial: ainda há o que devolver");
});

test("servidor: estorno integral confirmado => exclusão oferecida", async t => {
  const { db, session } = await cenario(t);
  await reembolso(db, 10000);
  assert.equal(await lerBloqueio(db, session), null);
});

test("servidor: quitado mas com outra cobrança Pix não resolvida => bloqueio visível com a mesma regra do servidor", async t => {
  const { db, session } = await cenario(t);
  await reembolso(db, 10000);
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key)
       VALUES(2,1,'PIX_MP','ADMIN',500,'CANCELADO','pix-cancelado')`
    )
    .run();
  const bloqueio = await lerBloqueio(db, session);
  assert.equal(bloqueio.codigo, "ANULACAO_EXPOSICAO_PIX_REMOTA");
  assert.match(bloqueio.mensagem, /suspensa por segurança/);
});

test("servidor: captura Pix não conciliada => bloqueio visível", async t => {
  const { db, session } = await cenario(t);
  await reembolso(db, 10000);
  await db
    .prepare(
      `INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_status,idempotency_key)
       VALUES(2,1,'PIX_MP','ADMIN',500,'EXPIRADO','approved','pix-tardio')`
    )
    .run();
  assert.equal((await lerBloqueio(db, session)).codigo, "CAPTURA_MP_NAO_CONCILIADA");
});
