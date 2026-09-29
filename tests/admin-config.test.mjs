import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

const cookieDe = session => session.cookie.split(";")[0];

function putConfig(db, session, body) {
  return app.config.onRequestPut({
    env: { DB: db },
    request: new Request("https://local.test/api/config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://local.test",
        ...(session ? { Cookie: cookieDe(session) } : {})
      },
      body: JSON.stringify(body)
    })
  });
}

// Valores diferentes dos semeados pela migration 0025 para provar a escrita.
const CONFIG_VALIDA = {
  days: [
    { label: "Seg", active: true },
    { label: "Ter", active: false },
    { label: "Qua", active: true },
    { label: "Qui", active: false },
    { label: "Sex", active: true },
    { label: "Sáb", active: false },
    { label: "Dom", active: false }
  ],
  openTime: "10:30",
  closeTime: "19:45",
  localName: "Temponi Concept",
  address: "Rua Lais Bertoni Pereira 182 Cambuí Sala 07",
  mapsLink: "https://maps.google.com/?q=Temponi+Concept",
  deliveryStatus: "available",
  whatsapp: "(11) 98765-4321",
  defaultMessage: "Olá! Gostaria de fazer um pedido."
};

const tabela = async db =>
  (await db.prepare("SELECT chave, valor FROM configuracoes_loja ORDER BY chave").all()).results;

test("PUT válido persiste a configuração e responde 200", async t => {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const session = await app.auth.createSession(db, 1);

  const res = await putConfig(db, session, CONFIG_VALIDA);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.config.openTime, "10:30");
  assert.equal(json.config.closeTime, "19:45");
  assert.equal(json.config.deliveryStatus, "available");
  assert.equal(json.config.whatsapp, "(11) 98765-4321");
  assert.deepEqual(
    json.config.days.map(day => day.active),
    [true, false, true, false, true, false, false]
  );

  const rows = Object.fromEntries((await tabela(db)).map(row => [row.chave, row.valor]));
  assert.equal(rows.horario_abre, "10:30");
  assert.equal(rows.horario_fecha, "19:45");
  assert.equal(rows.whatsapp, "5511987654321");
  assert.equal(rows.entregas_status, "DISPONIVEL");
  assert.equal(rows.horario_atendimento, "Seg, Qua, Sex: 10:30 às 19:45");
  assert.equal(rows.dia_seg, "1");
  assert.equal(rows.dia_ter, "0");
  assert.equal(rows.dia_dom, "0");
});

test("PUT inválido preserva o 400 e a mensagem original sem gravar", async t => {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const session = await app.auth.createSession(db, 1);

  const antes = await tabela(db);
  const res = await putConfig(db, session, { ...CONFIG_VALIDA, openTime: "25:00" });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, "Horário de abertura inválido");
  assert.deepEqual(await tabela(db), antes);
});
