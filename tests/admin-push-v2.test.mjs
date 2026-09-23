import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { app, fixture } from "./helpers/b3.mjs";
import { generateVapidKeys } from "@mmmike/web-push/vapid";

// Testes direcionados para PWA Admin V2: Web Push para novos pedidos

const TEST_VAPID = await generateVapidKeys();
const VAPID_SUBJECT = "mailto:admin@example.invalid";

function gerarChavesClient() {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const rawPub = publicKey.export({ type: "spki", format: "der" });
  const p256dh = rawPub.slice(-65).toString("base64url");
  const auth = crypto.randomBytes(16).toString("base64url");
  return { p256dh, auth };
}

const cookieDe = (session) => session.cookie.split(";")[0];

async function bancada(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM pedidos WHERE id = 1").run();
  await db.prepare("DELETE FROM push_inscricoes").run();
  await db.prepare("DELETE FROM push_eventos").run();

  const session = await app.auth.createSession(db, 1);
  return { db, session };
}

/* ──────────────────── 1. Auth e Endpoints de VAPID ──────────────────── */

test("GET /api/admin/push/vapid-key: exige sessão de admin", async (t) => {
  const { db } = await bancada(t);

  const resSemAuth = await app.adminPushVapidKey.onRequestGet({
    env: { DB: db, VAPID_PUBLIC_KEY: TEST_VAPID.publicKey },
    request: new Request("https://local.test/api/admin/push/vapid-key"),
  });
  assert.equal(resSemAuth.status, 401);
});

test("GET /api/admin/push/vapid-key: retorna apenas chave pública para usuário autenticado", async (t) => {
  const { db, session } = await bancada(t);

  const res = await app.adminPushVapidKey.onRequestGet({
    env: {
      DB: db,
      VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
      VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    },
    request: new Request("https://local.test/api/admin/push/vapid-key", {
      headers: { Cookie: cookieDe(session) },
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.publicKey, TEST_VAPID.publicKey);
  assert.equal(data.privateKey, undefined, "Nunca deve expor chave privada");
});

/* ──────────────────── 2. Inscrição (Subscribe) e CSRF ──────────────────── */

test("POST /api/admin/push/subscribe: bloqueia CSRF e requisição sem sessão", async (t) => {
  const { db, session } = await bancada(t);

  // Sem Origin válida (CSRF)
  const resCsrf = await app.adminPushSubscribe.onRequestPost({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/push/subscribe", {
      method: "POST",
      headers: { Origin: "https://evil.attacker.com", Cookie: cookieDe(session) },
      body: JSON.stringify({ endpoint: "https://push.example/1" }),
    }),
  });
  assert.equal(resCsrf.status, 403);

  // Sem sessão
  const resNoAuth = await app.adminPushSubscribe.onRequestPost({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/push/subscribe", {
      method: "POST",
      headers: { Origin: "https://local.test" },
      body: JSON.stringify({ endpoint: "https://push.example/1" }),
    }),
  });
  assert.equal(resNoAuth.status, 401);
});

test("POST /api/admin/push/subscribe: validação estrita de payload e limites", async (t) => {
  const { db, session } = await bancada(t);

  const req = (body) =>
    app.adminPushSubscribe.onRequestPost({
      env: { DB: db },
      request: new Request("https://local.test/api/admin/push/subscribe", {
        method: "POST",
        headers: {
          Origin: "https://local.test",
          Cookie: cookieDe(session),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    });

  // Endpoint inválido (não HTTPS)
  const resHttp = await req({
    endpoint: "http://insecure.example.com",
    keys: { p256dh: "key-1234567890", auth: "auth-12345" },
  });
  assert.equal(resHttp.status, 400);

  // Chaves ausentes
  const resSemChaves = await req({ endpoint: "https://push.example/1" });
  assert.equal(resSemChaves.status, 400);
});

test("POST /api/admin/push/subscribe: registra inscrição e suporta UPSERT", async (t) => {
  const { db, session } = await bancada(t);

  const payload = {
    endpoint: "https://push.example.com/device-1",
    keys: {
      p256dh: "p256dh-sample-token-valid-length",
      auth: "auth-secret-12345",
    },
    userAgent: "Admin PWA Browser",
  };

  const res = await app.adminPushSubscribe.onRequestPost({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/push/subscribe", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: cookieDe(session),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  });
  assert.equal(res.status, 201);

  const gravado = await db
    .prepare("SELECT * FROM push_inscricoes WHERE endpoint = ?")
    .bind(payload.endpoint)
    .first();
  assert.equal(gravado.usuario_id, 1);
  assert.equal(gravado.p256dh, payload.keys.p256dh);
  assert.equal(gravado.auth, payload.keys.auth);

  // UPSERT com chaves renovadas
  const payloadAtualizado = {
    endpoint: payload.endpoint,
    keys: {
      p256dh: "p256dh-renewed-token-length",
      auth: "auth-renewed-12345",
    },
  };
  const res2 = await app.adminPushSubscribe.onRequestPost({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/push/subscribe", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: cookieDe(session),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadAtualizado),
    }),
  });
  assert.equal(res2.status, 201);

  const atualizado = await db
    .prepare("SELECT * FROM push_inscricoes WHERE endpoint = ?")
    .bind(payload.endpoint)
    .first();
  assert.equal(atualizado.p256dh, payloadAtualizado.keys.p256dh);
  assert.equal(atualizado.auth, payloadAtualizado.keys.auth);
});

/* ──────────────────── 3. Cancelamento (Unsubscribe) ──────────────────── */

test("POST /api/admin/push/unsubscribe: remove inscrição do usuário", async (t) => {
  const { db, session } = await bancada(t);

  await db
    .prepare(
      "INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/sub1', 'k1', 'a1')",
    )
    .run();

  const res = await app.adminPushUnsubscribe.onRequestPost({
    env: { DB: db },
    request: new Request("https://local.test/api/admin/push/unsubscribe", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: cookieDe(session),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint: "https://push.example/sub1" }),
    }),
  });
  assert.equal(res.status, 200);

  const count = await db
    .prepare("SELECT COUNT(*) as total FROM push_inscricoes WHERE endpoint = 'https://push.example/sub1'")
    .first();
  assert.equal(count.total, 0);
});

/* ──────────────────── 4. Deduplicação e Despacho de Eventos ──────────────────── */

test("pushNotifier: deduplica PEDIDO_PAGO e impede múltiplos disparos para o mesmo pedido", async (t) => {
  const { db } = await bancada(t);

  // Cria pedido de teste
  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (101, 'tok-101', 'Cliente Teste', '11999999999', 4200, 'idemp-101', 'SITE', 'PAGO', 'NOVO')`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // Sem inscrições: marca como ENVIADO (sem trabalho pendente)
  const r1 = await app.pushNotifier.notificarNovoPedidoPago(db, env, 101);
  assert.equal(r1.ok, true);
  assert.equal(r1.destinatarios, 0);

  // Segundo disparo para o mesmo pedido: deduplicado imediatamente!
  const r2 = await app.pushNotifier.notificarNovoPedidoPago(db, env, 101);
  assert.equal(r2.ok, true);
  assert.equal(r2.enviado, false);
  assert.equal(r2.motivo, "JA_ENVIADO");

  const evento = await db
    .prepare("SELECT * FROM push_eventos WHERE pedido_id = 101 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(evento.status, "ENVIADO");
});

test("pushNotifier: não bloqueia confirmação de pagamento em caso de falha de push", async (t) => {
  const { db } = await bancada(t);

  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (102, 'tok-102', 'Cliente Teste', '11999999999', 5000, 'idemp-102', 'SITE', 'PAGO', 'NOVO')`,
    )
    .run();

  // Inscrição com endpoint inalcançável / porta fechada para forçar erro de rede
  await db
    .prepare(
      `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth)
       VALUES (1, 'https://127.0.0.1:59999/push-unreachable', 'BFyW_invalid_key_for_test_123456789012345678901234567890', 'auth_secret_12345')`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // safe call NUNCA lança exceção
  await assert.doesNotReject(async () => {
    await app.pushNotifier.notificarNovoPedidoPagoSafe(db, env, 102);
  });

  // O evento grava FALHA e tentativas=1, permitindo retry posterior
  const evento = await db
    .prepare("SELECT * FROM push_eventos WHERE pedido_id = 102 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(evento.status, "FALHA");
  assert.equal(evento.tentativas, 1);
  assert.ok(evento.ultimo_erro);

  // O pedido continua PAGO no D1!
  const pedido = await db.prepare("SELECT status_pagamento FROM pedidos WHERE id = 102").first();
  assert.equal(pedido.status_pagamento, "PAGO");
});

test("pushNotifier: pedido manual born PAGO exclui o próprio autor", async (t) => {
  const { db } = await bancada(t);

  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (103, 'tok-103', 'Balcão', '11999999999', 3000, 'idemp-103', 'MANUAL', 'PAGO', 'NOVO')`,
    )
    .run();

  // Inscrição do usuário 1 (autor)
  await db
    .prepare(
      `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth)
       VALUES (1, 'https://push.example/autor-device', 'k1', 'a1')`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // Excluindo usuário 1: encontra 0 destinatários (autor não recebe push do que acabou de criar)
  const res = await app.pushNotifier.notificarNovoPedidoPago(db, env, 103, { excludeUsuarioId: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.destinatarios, 0);
});

/* ──────────────────── 5. Integração com paymentSync e Webhooks ──────────────────── */

test("syncPaymentFromMp: transição para PAGO dispara pushNotifier desacoplado", async (t) => {
  const db = await fixture(t, { ledger: true, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM push_eventos").run();
  await db.prepare("DELETE FROM push_inscricoes").run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  const payment = await app.sync.fetchMpPayment("fake", "101");
  const result = await app.sync.syncPaymentFromMp(db, 1, payment, env);

  assert.equal(result.ok, true);
  assert.equal(result.status, "PAGO");
  assert.equal(result.transicionou, true);

  // push_eventos registrado
  const evento = await db
    .prepare("SELECT * FROM push_eventos WHERE pedido_id = 1 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.ok(evento, "Deve registrar evento PEDIDO_PAGO");
  assert.equal(evento.status, "ENVIADO");
});

test("webhook duplicado: retentativa não gera segundo push", async (t) => {
  const db = await fixture(t, { ledger: true, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM push_eventos").run();
  await db.prepare("DELETE FROM push_inscricoes").run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  const payment = await app.sync.fetchMpPayment("fake", "101");

  // Primeiro webhook
  const r1 = await app.sync.syncPaymentFromMp(db, 1, payment, env);
  assert.equal(r1.transicionou, true);

  // Segundo webhook (replay)
  const r2 = await app.sync.syncPaymentFromMp(db, 1, payment, env);
  assert.equal(r2.transicionou, false);

  const eventos = await db
    .prepare("SELECT COUNT(*) as total FROM push_eventos WHERE pedido_id = 1 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(eventos.total, 1, "Exatamente um registro de evento push");
});

test("concorrência simultânea (webhook + polling): exatamente um transiciona e despacha push", async (t) => {
  const db = await fixture(t, { ledger: true, reserve: "SEM_RESERVA" });
  await db.prepare("DELETE FROM push_eventos").run();
  await db.prepare("DELETE FROM push_inscricoes").run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  const payment = await app.sync.fetchMpPayment("fake", "101");

  // Disparo simultâneo
  const [res1, res2] = await Promise.all([
    app.sync.syncPaymentFromMp(db, 1, payment, env),
    app.sync.syncPaymentFromMp(db, 1, payment, env),
  ]);

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  // Exatamente um transicionou
  const transicoes = [res1.transicionou, res2.transicionou].filter(Boolean).length;
  assert.equal(transicoes, 1, "Apenas uma das chamadas concorrentes deve reportar transição");

  const eventos = await db
    .prepare("SELECT COUNT(*) as total FROM push_eventos WHERE pedido_id = 1 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(eventos.total, 1);
});

/* ──────────────────── 6. Reconciliação e Retry Real ──────────────────── */

test("retry: evento em FALHA é reprocessado e transiciona para ENVIADO", async (t) => {
  const { db } = await bancada(t);

  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (201, 'tok-201', 'Cliente Retry', '11999999999', 4500, 'idemp-201', 'SITE', 'PAGO', 'NOVO')`,
    )
    .run();

  // Simula evento que falhou há 40 segundos com 1 tentativa
  await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status, tentativas, ultimo_erro, criado_em, atualizado_em)
       VALUES (201, 'PEDIDO_PAGO', 'FALHA', 1, 'Network timeout', datetime('now', '-50 seconds'), datetime('now', '-40 seconds'))`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // Sem inscrições, a entrega é concluída com sucesso (sem destinatários pendentes)
  const res = await app.pushNotifier.reconciliarPushEventosFalhos(db, env, { backoffSeconds: 30 });
  assert.equal(res.ok, true);
  assert.equal(res.processados, 1);
  assert.equal(res.sucessos, 1);

  const evento = await db
    .prepare("SELECT status, tentativas, ultimo_erro FROM push_eventos WHERE pedido_id = 201 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(evento.status, "ENVIADO");
  assert.equal(evento.tentativas, 2);
});

test("retry: falha consecutiva incrementa tentativas e para no teto de 3", async (t) => {
  const { db } = await bancada(t);

  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (202, 'tok-202', 'Cliente Retry Limite', '11999999999', 4500, 'idemp-202', 'SITE', 'PAGO', 'NOVO')`,
    )
    .run();

  // Inscrição com chave inválida para forçar erro de envio
  await db
    .prepare(
      `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth)
       VALUES (1, 'https://127.0.0.1:59998/push-fail', 'BFyW_invalid_key_for_test_123456789012345678901234567890', 'auth_secret_12345')`,
    )
    .run();

  // Evento em FALHA com 2 tentativas
  await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status, tentativas, ultimo_erro, criado_em, atualizado_em)
       VALUES (202, 'PEDIDO_PAGO', 'FALHA', 2, 'Previous error', datetime('now', '-50 seconds'), datetime('now', '-40 seconds'))`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // 1ª reconciliação: tenta pela 3ª vez e falha -> tentativas vira 3
  const res1 = await app.pushNotifier.reconciliarPushEventosFalhos(db, env, { backoffSeconds: 30 });
  assert.equal(res1.ok, true);
  assert.equal(res1.processados, 1);
  assert.equal(res1.falhas, 1);

  const ev1 = await db
    .prepare("SELECT status, tentativas FROM push_eventos WHERE pedido_id = 202 AND evento = 'PEDIDO_PAGO'")
    .first();
  assert.equal(ev1.status, "FALHA");
  assert.equal(ev1.tentativas, 3);

  // 2ª reconciliação: tentativas >= 3 -> NÃO processa novamente (evita retry infinito)
  await db
    .prepare("UPDATE push_eventos SET atualizado_em = datetime('now', '-40 seconds') WHERE pedido_id = 202")
    .run();
  const res2 = await app.pushNotifier.reconciliarPushEventosFalhos(db, env, { backoffSeconds: 30 });
  assert.equal(res2.ok, true);
  assert.equal(res2.processados, 0, "Não deve reprocessar quando tentativas >= 3");
});

test("retry: CAS atômico impede dois workers concorrentes de reenviarem o mesmo evento", async (t) => {
  const { db } = await bancada(t);

  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (203, 'tok-203', 'Cliente Concorrência', '11999999999', 5000, 'idemp-203', 'SITE', 'PAGO', 'NOVO')`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status, tentativas, ultimo_erro, criado_em, atualizado_em)
       VALUES (203, 'PEDIDO_PAGO', 'FALHA', 1, 'Temporary glitch', datetime('now', '-50 seconds'), datetime('now', '-40 seconds'))`,
    )
    .run();

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // Dois reconciliadores chamados simultaneamente para o mesmo evento
  const [r1, r2] = await Promise.all([
    app.pushNotifier.reconciliarPushEventosFalhos(db, env, { backoffSeconds: 30 }),
    app.pushNotifier.reconciliarPushEventosFalhos(db, env, { backoffSeconds: 30 }),
  ]);

  // Apenas um conseguiu o CAS de UPDATE push_eventos SET status='PENDENTE' WHERE status='FALHA'
  const sucessosTotal = r1.sucessos + r2.sucessos;
  assert.equal(sucessosTotal, 1, "Exatamente um worker deve ter executado a reconciliação");
});

test("POST /api/admin/push/retry: endpoint autenticado dispara reconciliação", async (t) => {
  const { db, session } = await bancada(t);

  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
    VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
    VAPID_SUBJECT,
  };

  // Sem sessão -> 401
  const rSemAuth = await app.adminPushRetry.onRequestPost({
    env,
    request: new Request("https://local.test/api/admin/push/retry", {
      method: "POST",
      headers: { Origin: "https://local.test" },
    }),
  });
  assert.equal(rSemAuth.status, 401);

  // Sem Origin válida -> 403
  const rCsrf = await app.adminPushRetry.onRequestPost({
    env,
    request: new Request("https://local.test/api/admin/push/retry", {
      method: "POST",
      headers: { Origin: "https://evil.test", Cookie: cookieDe(session) },
    }),
  });
  assert.equal(rCsrf.status, 403);

  // Autenticado -> 200 com resultado
  const rOk = await app.adminPushRetry.onRequestPost({
    env,
    request: new Request("https://local.test/api/admin/push/retry", {
      method: "POST",
      headers: { Origin: "https://local.test", Cookie: cookieDe(session) },
    }),
  });
  assert.equal(rOk.status, 200);
  const data = await rOk.json();
  assert.equal(data.ok, true);
});

/* ──────────────────── 7. Validação de Convergência da Migration Legada ──────────────────── */

test("migration 0030: converge banco com schema legado sem perder registros e cria PK composta", async (t) => {
  const { db } = await bancada(t);

  // 1. Simula estado legado remoto: remove tabelas e recria push_eventos no formato legado de produção
  await db.prepare("DROP TABLE IF EXISTS push_eventos").run();
  await db.prepare("DROP TABLE IF EXISTS push_eventos__v2").run();
  await db.prepare("DROP TABLE IF EXISTS push_inscricoes").run();

  await db.prepare(`
    CREATE TABLE push_eventos (
      pedido_id INTEGER PRIMARY KEY,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  // Insere um registro legado
  await db.prepare("INSERT INTO push_eventos (pedido_id, criado_em) VALUES (999, '2026-01-01 10:00:00')").run();

  // 2. Executa os comandos exatos da migration 0030
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_inscricoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_push_inscricoes_usuario ON push_inscricoes(usuario_id);").run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_eventos (
      pedido_id INTEGER PRIMARY KEY,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_eventos__v2 (
      pedido_id INTEGER NOT NULL,
      evento TEXT NOT NULL DEFAULT 'PEDIDO_PAGO',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      tentativas INTEGER NOT NULL DEFAULT 0,
      ultimo_erro TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (pedido_id, evento)
    );
  `).run();

  await db.prepare(`
    INSERT OR IGNORE INTO push_eventos__v2 (pedido_id, evento, status, criado_em)
    SELECT pedido_id, 'PEDIDO_PAGO', 'ENVIADO', criado_em FROM push_eventos;
  `).run();

  await db.prepare("DROP TABLE push_eventos;").run();
  await db.prepare("ALTER TABLE push_eventos__v2 RENAME TO push_eventos;").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_push_eventos_status ON push_eventos(status, criado_em);").run();

  // 3. Verifica o schema resultante via PRAGMA
  const colunas = (await db.prepare("PRAGMA table_info(push_eventos)").all()).results;
  const nomesColunas = colunas.map((c) => c.name);
  assert.deepEqual(
    nomesColunas.sort(),
    ["atualizado_em", "criado_em", "evento", "pedido_id", "status", "tentativas", "ultimo_erro"].sort(),
    "Todas as colunas novas devem existir no schema final",
  );

  const pkColunas = colunas.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pkColunas, ["pedido_id", "evento"], "A chave primária final deve ser composta (pedido_id, evento)");

  // 4. Verifica se o registro legado foi preservado
  const registroLegado = await db.prepare("SELECT * FROM push_eventos WHERE pedido_id = 999").first();
  assert.ok(registroLegado, "Registro legado deve ser preservado");
  assert.equal(registroLegado.evento, "PEDIDO_PAGO");
  assert.equal(registroLegado.status, "ENVIADO");
  assert.equal(registroLegado.criado_em, "2026-01-01 10:00:00");
});

/* ──────────────────── 8. Teste de Notificação Web Push (POST /api/admin/push/test) ──────────────────── */

test("POST /api/admin/push/test: exige sessão de admin", async (t) => {
  const { db } = await bancada(t);
  const res = await app.adminPushTest.onRequestPost({
    env: { DB: db, VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, VAPID_PRIVATE_KEY: TEST_VAPID.privateKey },
    request: new Request("https://local.test/api/admin/push/test", {
      method: "POST",
      headers: { Origin: "https://local.test" },
      body: JSON.stringify({ endpoint: "https://push.example/1" }),
    }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/admin/push/test: bloqueia same-origin/CSRF inválido", async (t) => {
  const { db, session } = await bancada(t);
  const res = await app.adminPushTest.onRequestPost({
    env: { DB: db, VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, VAPID_PRIVATE_KEY: TEST_VAPID.privateKey },
    request: new Request("https://local.test/api/admin/push/test", {
      method: "POST",
      headers: { Origin: "https://attacker.invalid", Cookie: cookieDe(session) },
      body: JSON.stringify({ endpoint: "https://push.example/1" }),
    }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/admin/push/test: rejeita payload inválido ou endpoint malformado", async (t) => {
  const { db, session } = await bancada(t);
  const env = { DB: db, VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, VAPID_PRIVATE_KEY: TEST_VAPID.privateKey };

  const testEndpoint = async (body, expectedStatus = 400) => {
    const res = await app.adminPushTest.onRequestPost({
      env,
      request: new Request("https://local.test/api/admin/push/test", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: cookieDe(session), "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    });
    assert.equal(res.status, expectedStatus);
  };

  await testEndpoint("not-a-json", 400);
  await testEndpoint({}, 400);
  await testEndpoint({ endpoint: "" }, 400);
  await testEndpoint({ endpoint: "http://insecure.test/1" }, 400);
  await testEndpoint({ endpoint: "https://" + "a".repeat(1050) }, 400);
  await testEndpoint({ endpoint: 12345 }, 400);
});

test("POST /api/admin/push/test: não permite usar subscription pertencente a outro usuario_id", async (t) => {
  const { db, session } = await bancada(t);
  const keys = gerarChavesClient();

  // Insere um segundo admin no banco
  await db
    .prepare("INSERT INTO usuarios_admin (id, nome, username, email, senha_hash) VALUES (2, 'Outro Admin', 'outro_admin', 'outro@example.com', 'hash_teste')")
    .run();

  // Insere subscription associada ao usuario_id 2 (outro usuário)
  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(2, "https://push.example/sub-user-2", keys.p256dh, keys.auth)
    .run();

  const res = await app.adminPushTest.onRequestPost({
    env: { DB: db, VAPID_PUBLIC_KEY: TEST_VAPID.publicKey, VAPID_PRIVATE_KEY: TEST_VAPID.privateKey },
    request: new Request("https://local.test/api/admin/push/test", {
      method: "POST",
      headers: { Origin: "https://local.test", Cookie: cookieDe(session), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/sub-user-2" }),
    }),
  });

  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /não encontrada/i);
});

test("POST /api/admin/push/test: busca p256dh/auth no banco, envia para somente uma subscription, não cria push_eventos nem altera pedidos", async (t) => {
  const { db, session } = await bancada(t);
  const keys1 = gerarChavesClient();
  const keys2 = gerarChavesClient();

  // Insere duas inscrições do mesmo usuário
  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(1, "https://push.mock.test/sub-1", keys1.p256dh, keys1.auth)
    .run();

  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(1, "https://push.mock.test/sub-2", keys2.p256dh, keys2.auth)
    .run();

  // Cria um pedido existente para certificar que nenhum pedido é tocado
  await db
    .prepare(
      `INSERT INTO pedidos(id, token_publico, cliente_nome, cliente_whatsapp, valor_total_centavos, idempotency_key, origem_pedido, status_pagamento, status_pedido)
       VALUES (900, 'tok-900', 'Cliente Intacto', '11999999999', 5000, 'idemp-900', 'SITE', 'PENDENTE', 'NOVO')`,
    )
    .run();

  const dispatchedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://push.mock.test/")) {
      dispatchedUrls.push(String(url));
      return new Response(null, { status: 201 });
    }
    return originalFetch(url, options);
  };

  try {
    // Cliente envia APENAS o endpoint no body (sem chaves)
    const res = await app.adminPushTest.onRequestPost({
      env: {
        DB: db,
        VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
        VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
        VAPID_SUBJECT,
      },
      request: new Request("https://local.test/api/admin/push/test", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: cookieDe(session), "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.mock.test/sub-1" }),
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);

    // Envio direcionado a EXATAMENTE a subscription solicitada
    assert.deepEqual(dispatchedUrls, ["https://push.mock.test/sub-1"]);

    // Zero registros em push_eventos
    const totalEventos = await db.prepare("SELECT COUNT(*) as total FROM push_eventos").first();
    assert.equal(totalEventos.total, 0, "Notificação de teste NÃO deve inserir em push_eventos");

    // Pedido não foi alterado
    const pedido = await db.prepare("SELECT status_pagamento, status_pedido FROM pedidos WHERE id = 900").first();
    assert.equal(pedido.status_pagamento, "PENDENTE");
    assert.equal(pedido.status_pedido, "NOVO");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/admin/push/test: subscription stale (410) remove somente ela e retorna aviso", async (t) => {
  const { db, session } = await bancada(t);
  const keys1 = gerarChavesClient();
  const keys2 = gerarChavesClient();

  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(1, "https://push.mock.test/stale-sub", keys1.p256dh, keys1.auth)
    .run();

  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(1, "https://push.mock.test/active-sub", keys2.p256dh, keys2.auth)
    .run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://push.mock.test/stale-sub") {
      // Simula 410 Gone do push service (FCM / Mozilla)
      return new Response(null, { status: 410 });
    }
    return originalFetch(url, options);
  };

  try {
    const res = await app.adminPushTest.onRequestPost({
      env: {
        DB: db,
        VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
        VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
        VAPID_SUBJECT,
      },
      request: new Request("https://local.test/api/admin/push/test", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: cookieDe(session), "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.mock.test/stale-sub" }),
      }),
    });

    assert.equal(res.status, 410);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.stale, true);

    // Confirma que SOMENTE a inscrição stale foi removida
    const subStale = await db.prepare("SELECT * FROM push_inscricoes WHERE endpoint = 'https://push.mock.test/stale-sub'").first();
    assert.equal(subStale, null);

    const subActive = await db.prepare("SELECT * FROM push_inscricoes WHERE endpoint = 'https://push.mock.test/active-sub'").first();
    assert.ok(subActive, "Inscrição ativa do usuário deve ser preservada");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/admin/push/test: erro no push service retorna 502 e não quebra o sistema", async (t) => {
  const { db, session } = await bancada(t);
  const keys = gerarChavesClient();

  await db
    .prepare("INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)")
    .bind(1, "https://push.mock.test/error-sub", keys.p256dh, keys.auth)
    .run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://push.mock.test/error-sub") {
      return new Response("Internal Push Service Error", { status: 500 });
    }
    return originalFetch(url, options);
  };

  try {
    const res = await app.adminPushTest.onRequestPost({
      env: {
        DB: db,
        VAPID_PUBLIC_KEY: TEST_VAPID.publicKey,
        VAPID_PRIVATE_KEY: TEST_VAPID.privateKey,
        VAPID_SUBJECT,
      },
      request: new Request("https://local.test/api/admin/push/test", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: cookieDe(session), "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.mock.test/error-sub" }),
      }),
    });

    assert.equal(res.status, 502);
    const data = await res.json();
    assert.match(data.error, /Falha ao despachar/i);

    // Subscription permanece intacta para retry futuro
    const sub = await db.prepare("SELECT * FROM push_inscricoes WHERE endpoint = 'https://push.mock.test/error-sub'").first();
    assert.ok(sub);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
