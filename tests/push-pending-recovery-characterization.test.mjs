import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { app, barrier, fixture } from "./helpers/b3.mjs";

// Real notifier, retry handler, transport adapter and disposable D1. Only the
// external send boundary is controlled. Interruption scenarios inject a fault
// after the durable claim; they do not emulate termination of workerd itself.
const bridge = Symbol.for("rp-doces.push-pending-characterization");
async function compile(mutation) {
  let replacements = 0;
  const bundle = await build({
    stdin: {
      contents:
        "export * from './functions/lib/pushNotifier'; export { onRequestPost } from './functions/api/admin/push/retry';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "push-boundary",
        setup(api) {
          api.onResolve({ filter: /^@mmmike\/web-push\/send$/ }, () => ({
            path: "send",
            namespace: "push-boundary"
          }));
          api.onLoad({ filter: /.*/, namespace: "push-boundary" }, () => ({
            contents:
              'export const sendPushNotification = (...args) => globalThis[Symbol.for("rp-doces.push-pending-characterization")](...args);'
          }));
          api.onLoad({ filter: /pushNotifier\.ts$/ }, async ({ path }) => {
            let source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
            if (mutation) {
              replacements = source.split(mutation.from).length - 1;
              assert.equal(replacements, mutation.count ?? 1, mutation.name);
              source = source.replaceAll(mutation.from, mutation.to);
              if (mutation.extra) {
                assert.equal(source.split(mutation.extra.from).length - 1, 1);
                source = source.replace(mutation.extra.from, mutation.extra.to);
              }
            }
            source += "\nexport { adquirirClaim, renovarClaim, concluirClaim };";
            return { contents: source, loader: "ts" };
          });
        }
      }
    ]
  });
  if (mutation) assert.ok(replacements);
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}
const production = await compile();
const none = { ok: true, processados: 0, sucessos: 0, falhas: 0 };
const success = { ok: true, processados: 1, sucessos: 1, falhas: 0 };
const failed = { ok: true, processados: 1, sucessos: 0, falhas: 1 };
const sanitized = '{"category":"UNKNOWN","code":"UNKNOWN_ERROR"}';

test("push lease recovery: at-least-once and fenced ownership", async t => {
  const db = await fixture(t);
  const env = { DB: db, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" };
  const session = await app.auth.createSession(db, 1);
  let calls;
  const row = () =>
    db
      .prepare(
        "SELECT status,tentativas,ultimo_erro,claim_token,claim_expires_at FROM push_eventos WHERE pedido_id=1"
      )
      .first();
  const expected = (status, tentativas, ultimo_erro = "old") => ({
    status,
    tentativas,
    ultimo_erro,
    claim_token: null,
    claim_expires_at: null
  });
  async function reset(status = "FALHA", attempts = 1, expires = "2000-01-01 00:00:00", count = 1) {
    db.hook = null;
    calls = [];
    await db.prepare("DELETE FROM push_eventos").run();
    await db.prepare("DELETE FROM push_inscricoes").run();
    if (status)
      await db
        .prepare(
          "INSERT INTO push_eventos(pedido_id,evento,status,tentativas,ultimo_erro,atualizado_em,claim_token,claim_expires_at) VALUES(1,'PEDIDO_PAGO',?,?,'old','2000-01-01 00:00:00',?,?)"
        )
        .bind(status, attempts, status === "PENDENTE" ? "previous-owner" : null, expires)
        .run();
    for (let id = 1; id <= count; id++)
      await db
        .prepare(
          "INSERT INTO push_inscricoes(id,usuario_id,endpoint,p256dh,auth) VALUES(?,1,?,'key','auth')"
        )
        .bind(id, `https://push.example.invalid/${id}`)
        .run();
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      return true;
    };
  }
  t.after(() => {
    db.hook = null;
    delete globalThis[bridge];
  });
  const retry = module => module.reconciliarPushEventosFalhos(db, env);
  const contracts = {};
  contracts.normal = async module => {
    await reset();
    assert.deepEqual(await retry(module), success);
    assert.deepEqual(await row(), expected("ENVIADO", 2));
    assert.equal(calls.length, 1);
  };
  contracts.active = async module => {
    await reset("PENDENTE", 1, "2099-01-01 00:00:00");
    const before = await row();
    assert.deepEqual(await retry(module), none);
    assert.deepEqual(await row(), before);
    assert.equal(calls.length, 0);
    const result = await module.notificarNovoPedidoPago(db, env, 1);
    assert.equal(result.enviado, false);
    assert.equal(calls.length, 0);
  };
  contracts.expired = async module => {
    await reset("PENDENTE", 1);
    assert.deepEqual(await retry(module), success);
    assert.deepEqual(await row(), expected("ENVIADO", 2));
  };
  contracts.sent = async module => {
    await reset("ENVIADO", 1, null);
    assert.deepEqual(await retry(module), none);
    assert.deepEqual(await module.notificarNovoPedidoPago(db, env, 1), {
      ok: true,
      enviado: false,
      motivo: "JA_ENVIADO"
    });
    assert.equal(calls.length, 0);
  };
  contracts.backoff = async module => {
    await reset();
    await db.prepare("UPDATE push_eventos SET atualizado_em=CURRENT_TIMESTAMP").run();
    assert.deepEqual(await retry(module), none);
    await module.notificarNovoPedidoPago(db, env, 1);
    assert.equal(calls.length, 0);
  };
  contracts.limit = async module => {
    await reset("FALHA", 3);
    assert.deepEqual(await retry(module), none);
    assert.equal(
      (await module.notificarNovoPedidoPago(db, env, 1)).motivo,
      "LIMITE_TENTATIVAS_EXCEDIDO"
    );
    assert.equal(calls.length, 0);
  };
  async function race(module, initial) {
    await reset(initial ? "PENDENTE" : "FALHA", initial ? 0 : 1);
    const gate = barrier(2);
    db.hook = async statements => {
      if (statements.some(s => s.sql.includes("SET status = 'PENDENTE', claim_token")))
        await gate();
    };
    const invoke = () => (initial ? module.notificarNovoPedidoPago(db, env, 1) : retry(module));
    await Promise.all([invoke(), invoke()]);
    db.hook = null;
    assert.equal(calls.length, 1);
    assert.deepEqual(await row(), expected("ENVIADO", initial ? 1 : 2));
  }
  contracts.initialRace = module => race(module, true);
  contracts.retryRace = module => race(module, false);
  async function takeover() {
    await reset("PENDENTE", 0);
    const owner = await production.adquirirClaim(db, 1, 0, 30);
    assert.ok(owner);
    await db.prepare("UPDATE push_eventos SET claim_expires_at='2000-01-01 00:00:00'").run();
    const next = await production.adquirirClaim(db, 1, 0, 30);
    assert.ok(next);
    assert.notEqual(next.token, owner.token);
    return { owner, next };
  }
  contracts.oldFinish = async module => {
    const { owner, next } = await takeover();
    const before = await row();
    assert.equal(await module.concluirClaim(db, 1, owner, "ENVIADO"), false);
    assert.deepEqual(await row(), before);
    assert.equal(await production.concluirClaim(db, 1, next, "ENVIADO"), true);
  };
  contracts.oldRenew = async module => {
    const { owner } = await takeover();
    const before = await row();
    assert.equal(await module.renovarClaim(db, 1, owner), false);
    assert.deepEqual(await row(), before);
  };
  contracts.longBatch = async module => {
    await reset("PENDENTE", 0, "2000-01-01 00:00:00", 3);
    let time = Date.parse("2026-10-05T10:00:00Z");
    const clock = () => new Date(time).toISOString().slice(0, 19).replace("T", " ");
    db.hook = statements =>
      statements.map(s => ({
        ...s,
        sql: s.sql
          .replaceAll("'now'", `'${clock()}'`)
          .replaceAll("CURRENT_TIMESTAMP", `'${clock()}'`)
      }));
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      time += 90000;
      if (calls.length <= 3)
        assert.deepEqual(
          await retry(production),
          none,
          "Renewed claim remains active after elapsed batch time"
        );
      return true;
    };
    const result = await module.notificarNovoPedidoPago(db, env, 1);
    db.hook = null;
    assert.equal(result.ok, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(await row(), expected("ENVIADO", 1));
  };
  contracts.claimCas = async module => {
    await reset("PENDENTE", 0);
    const owner = await module.adquirirClaim(db, 1, 0, 30);
    assert.ok(owner);
    assert.equal(await module.adquirirClaim(db, 1, 0, 30), null);
    assert.equal((await row()).claim_token, owner.token);
  };
  for (const [name, contract] of Object.entries(contracts))
    await t.test(name, () => contract(production));
  await t.test("first registration and no recipients", async () => {
    await reset(null, 0, null, 0);
    assert.deepEqual(await production.notificarNovoPedidoPago(db, env, 1), {
      ok: true,
      enviado: false,
      destinatarios: 0
    });
    assert.deepEqual(await row(), expected("ENVIADO", 1, null));
  });
  await t.test("404/410 recipients removed under ownership", async () => {
    await reset();
    globalThis[bridge] = async () => false;
    assert.deepEqual(await retry(production), success);
    assert.deepEqual(await row(), expected("ENVIADO", 2));
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").first("n"), 0);
  });
  await t.test("transport errors and timeouts preserve sanitized failure", async () => {
    for (const error of [
      new Error("private URL secret"),
      new DOMException("secret", "TimeoutError")
    ]) {
      await reset();
      globalThis[bridge] = async () => {
        throw error;
      };
      assert.deepEqual(await retry(production), failed);
      const state = await row();
      assert.equal(state.status, "FALHA");
      assert.equal(state.tentativas, 2);
      assert.equal(state.claim_token, null);
      assert.ok(!state.ultimo_erro.includes("secret"));
      assert.deepEqual(await retry(production), none);
    }
  });
  await t.test("failure before transport releases claim as FALHA", async () => {
    await reset();
    db.hook = statements => {
      if (statements.some(s => s.sql.includes("FROM push_inscricoes pi")))
        throw new Error("secret");
    };
    assert.deepEqual(await retry(production), failed);
    db.hook = null;
    assert.deepEqual(await row(), expected("FALHA", 2, sanitized));
    assert.equal(calls.length, 0);
  });
  await t.test("missing VAPID releases claim and counts attempt", async () => {
    await reset();
    assert.deepEqual(await production.reconciliarPushEventosFalhos(db, { DB: db }), failed);
    const state = await row();
    assert.equal(state.status, "FALHA");
    assert.equal(state.tentativas, 2);
    assert.equal(state.claim_token, null);
  });
  await t.test("crash after durable claim is recoverable only after expiry", async () => {
    await reset("PENDENTE", 0);
    const claim = await production.adquirirClaim(db, 1, 0, 30);
    assert.ok(claim);
    assert.deepEqual(await retry(production), none);
    await db.prepare("UPDATE push_eventos SET claim_expires_at='2000-01-01 00:00:00'").run();
    assert.deepEqual(await retry(production), success);
    assert.deepEqual(await row(), expected("ENVIADO", 1));
  });
  await t.test(
    "accepted remote push plus failed success write becomes retryable FALHA",
    async () => {
      await reset();
      db.hook = statements => {
        if (
          statements.some(
            s => s.sql.includes("SET status = ?, tentativas") && s.args[0] === "ENVIADO"
          )
        )
          throw new Error("secret");
      };
      assert.deepEqual(await retry(production), failed);
      db.hook = null;
      assert.equal(calls.length, 1);
      assert.deepEqual(await row(), expected("FALHA", 2, sanitized));
      await db.prepare("UPDATE push_eventos SET atualizado_em='2000-01-01 00:00:00'").run();
      assert.deepEqual(await retry(production), success);
      assert.equal(
        calls.length,
        2,
        "At-least-once replays ambiguous acceptance within retry budget"
      );
      assert.deepEqual(await row(), expected("ENVIADO", 3, sanitized));
    }
  );
  await t.test(
    "database unavailable after remote acceptance retains recoverable lease",
    async () => {
      await reset();
      db.hook = statements => {
        if (statements.some(s => s.sql.includes("SET status = ?, tentativas")))
          throw new Error("secret");
      };
      assert.deepEqual(await retry(production), failed);
      db.hook = null;
      const state = await row();
      assert.equal(state.status, "PENDENTE");
      assert.equal(state.tentativas, 1);
      assert.ok(state.claim_token);
      assert.deepEqual(await retry(production), none);
      await db.prepare("UPDATE push_eventos SET claim_expires_at='2000-01-01 00:00:00'").run();
      assert.deepEqual(await retry(production), success);
      assert.equal(calls.length, 2);
    }
  );
  await t.test("lost owner stops subsequent sends and cannot delete subscription", async () => {
    await reset("PENDENTE", 0, "2000-01-01 00:00:00", 2);
    globalThis[bridge] = async (...args) => {
      calls.push(args);
      await db
        .prepare(
          "UPDATE push_eventos SET claim_token='next-owner',claim_expires_at='2099-01-01 00:00:00'"
        )
        .run();
      return false;
    };
    assert.equal((await production.notificarNovoPedidoPago(db, env, 1)).motivo, "CLAIM_PERDIDO");
    assert.equal(calls.length, 1);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").first("n"), 2);
    assert.equal((await row()).claim_token, "next-owner");
  });
  await t.test("old owner cannot persist FALHA or empty recipient completion", async () => {
    const { owner } = await takeover();
    const before = await row();
    assert.equal(await production.concluirClaim(db, 1, owner, "FALHA", sanitized), false);
    assert.deepEqual(await row(), before);
    await reset("PENDENTE", 0, "2000-01-01 00:00:00", 0);
    let replaced = false;
    db.hook = async statements => {
      if (!replaced && statements.some(s => s.sql.includes("FROM push_inscricoes pi"))) {
        replaced = true;
        db.hook = null;
        await db
          .prepare(
            "UPDATE push_eventos SET claim_token='next-owner',claim_expires_at='2099-01-01 00:00:00'"
          )
          .run();
      }
    };
    assert.equal((await production.notificarNovoPedidoPago(db, env, 1)).motivo, "CLAIM_PERDIDO");
    db.hook = null;
    assert.equal((await row()).claim_token, "next-owner");
  });
  await t.test("manual retry HTTP contract recovers expired pending", async () => {
    await reset("PENDENTE", 1);
    const response = await production.onRequestPost({
      env,
      request: new Request("https://local.test/api/admin/push/retry", {
        method: "POST",
        headers: { Origin: "https://local.test", Cookie: session.cookie.split(";")[0] }
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), success);
  });
  await t.test("migration adds metadata and gives legacy pending a grace lease", async () => {
    const sql = await readFile("migrations/0035_push_event_claim_lease.sql", "utf8");
    await db
      .prepare(
        "CREATE TABLE lease_migration_probe(pedido_id INTEGER,status TEXT,atualizado_em TEXT,tentativas INTEGER)"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO lease_migration_probe VALUES(1,'PENDENTE','2000-01-01 00:00:00',2),(2,'ENVIADO','2000-01-01 00:00:00',1)"
      )
      .run();
    for (const statement of sql
      .replace(/^--.*$/gm, "")
      .split(";")
      .map(s => s.trim())
      .filter(Boolean))
      await db.prepare(statement.replaceAll("push_eventos", "lease_migration_probe")).run();
    const pending = await db
      .prepare(
        "SELECT *,datetime(claim_expires_at)>datetime('now') AS active FROM lease_migration_probe WHERE pedido_id=1"
      )
      .first();
    assert.equal(pending.active, 1);
    assert.equal(pending.tentativas, 2);
    assert.equal(pending.atualizado_em, "2000-01-01 00:00:00");
    assert.equal(pending.claim_token, null);
    assert.equal(
      await db
        .prepare("SELECT claim_expires_at FROM lease_migration_probe WHERE pedido_id=2")
        .first("claim_expires_at"),
      null
    );
  });
  const controls = [
    {
      name: "pending selected without lease",
      from: "status = 'PENDENTE' AND claim_expires_at IS NOT NULL",
      to: "status = 'PENDENTE' OR claim_expires_at IS NOT NULL",
      contract: "active"
    },
    {
      name: "claim without eligibility CAS",
      from: "AND " + "$" + "{CLAIM_ELIGIBILITY}`\n    )",
      to: "AND (? IS NOT NULL AND ? IS NOT NULL)`\n    )",
      contract: "claimCas"
    },
    {
      name: "completion token removed",
      from: "AND claim_token = ? AND datetime(claim_expires_at) > datetime('now')",
      to: "AND ? IS NOT NULL AND datetime(claim_expires_at) > datetime('now')",
      count: 2,
      contract: "oldFinish"
    },
    {
      name: "batch renewal removed",
      from: "for (const sub of inscricoes) {\n    if (!(await renovarClaim(db, pedido.id, claim))) return claimPerdido();",
      to: "for (const sub of inscricoes) {",
      contract: "longBatch"
    },
    {
      name: "old token renews",
      from: "AND claim_token = ? AND datetime(claim_expires_at) > datetime('now')",
      to: "AND ? IS NOT NULL AND datetime(claim_expires_at) > datetime('now')",
      count: 2,
      contract: "oldRenew"
    },
    {
      name: "active pending stolen",
      from: "AND datetime(claim_expires_at) <= datetime('now'))",
      to: "AND datetime(claim_expires_at) >= datetime('now'))",
      contract: "active"
    },
    {
      name: "ENVIADO replayed",
      from: "OR (status = 'PENDENTE' AND claim_expires_at IS NOT NULL",
      to: "OR (status = 'ENVIADO') OR (status = 'PENDENTE' AND claim_expires_at IS NOT NULL",
      extra: { from: 'eventoRow.status === "ENVIADO"', to: 'eventoRow.status === "NEVER"' },
      contract: "sent"
    },
    {
      name: "backoff removed",
      from: "RETRY_BACKOFF_SECONDS = 30",
      to: "RETRY_BACKOFF_SECONDS = 0",
      contract: "backoff"
    },
    {
      name: "attempt limit increased",
      from: "RETRY_MAX_ATTEMPTS = 3",
      to: "RETRY_MAX_ATTEMPTS = 4",
      contract: "limit"
    }
  ];
  for (const control of controls)
    await t.test(`negative control: ${control.name}`, async () => {
      const module = await compile(control);
      await assert.rejects(contracts[control.contract](module), { code: "ERR_ASSERTION" });
      db.hook = null;
    });
});
