import { mpResponse } from "./helpers/mp-orders.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { fixture, barrier } from "./helpers/b3.mjs";

async function compile(mutation) {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `export * as alert from './functions/lib/operationalAlert'; export * as context from './functions/lib/requestContext'; export * as root from './functions/_middleware'; export * as sync from './functions/lib/paymentSync'; export * as reconcile from './functions/lib/pedidoReconcile'; export * as push from './functions/lib/pushNotifier'; export * as auth from './functions/lib/auth';`
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: mutation
      ? [
          {
            name: "negative-control",
            setup(api) {
              api.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
                if (
                  !path
                    .replaceAll("\\", "/")
                    .endsWith(mutation.path ?? "functions/lib/operationalAlert.ts")
                )
                  return null;
                let contents = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
                for (const [from, to] of mutation.replacements) {
                  assert.equal(contents.split(from).length - 1, 1, "Unique mutation");
                  contents = contents.replace(from, to);
                }
                return { contents, loader: "ts" };
              });
            }
          }
        ]
      : []
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const production = await compile();
const request = () =>
  new Request("https://local.test/api/probe", {
    headers: { Authorization: "Bearer SECRET_TOKEN", Cookie: "SECRET_COOKIE" }
  });
async function through(module, action) {
  return module.root.onRequest({ request: request(), data: {}, next: action });
}
const input = {
  code: "FINANCIAL_INTEGRITY_MISMATCH",
  pedidoId: 1,
  pagamentoId: 2,
  token: "SECRET_TOKEN",
  error: new Error("https://secret.invalid QR=SECRET_QR"),
  requestId: "SECRET_REQUEST",
  cookie: "SECRET_COOKIE",
  payload: { senha: "SECRET_PASSWORD" }
};

test("operational alert safe contract and integration", async t => {
  const logs = [];
  for (const level of ["error", "warn", "info"])
    t.mock.method(console, level, (...args) => logs.push(args));
  const alerts = () => logs.filter(row => row[0] === "OPERATIONAL_ALERT").map(row => row[1]);
  const contracts = {};
  contracts.safe = async module => {
    logs.length = 0;
    const response = await through(module, async () => {
      module.alert.operationalAlert(input);
      return new Response("original", { status: 202 });
    });
    assert.deepEqual(alerts(), [
      {
        kind: "OPERATIONAL_ALERT",
        severity: "CRITICAL",
        code: "FINANCIAL_INTEGRITY_MISMATCH",
        requestId: response.headers.get("X-Request-Id"),
        pedidoId: 1,
        pagamentoId: 2
      }
    ]);
    assert.ok(!JSON.stringify(alerts()).includes("SECRET"));
    assert.ok(!JSON.stringify(alerts()).includes("secret.invalid"));
  };
  contracts.expected = async module => {
    for (const status of [400, 401, 403]) {
      logs.length = 0;
      const response = await through(module, async () => {
        module.alert.operationalAlert({ code: `HTTP_${status}` });
        return mpResponse({ error: "expected" }, { status });
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: "expected" });
      assert.deepEqual(alerts(), []);
    }
  };
  contracts.http = async module => {
    const response = await through(module, async () => {
      module.alert.operationalAlert({ code: "PUSH_RETRY_EXHAUSTED", pedidoId: 1, tentativas: 3 });
      return mpResponse(
        { ok: false, code: "unchanged" },
        { status: 409, headers: { "Cache-Control": "no-store", "X-Functional": "original" } }
      );
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, code: "unchanged" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Functional"), "original");
  };
  for (const [name, contract] of Object.entries(contracts))
    await t.test(name, () => contract(production));
  await t.test("policy severity cannot be supplied by caller", async () => {
    logs.length = 0;
    production.alert.operationalAlert({
      code: "PUSH_RETRY_RECOVERED",
      severity: "CRITICAL",
      pedidoId: "SECRET",
      pagamentoId: -1,
      tentativas: 2
    });
    assert.deepEqual(alerts(), [
      { kind: "OPERATIONAL_ALERT", severity: "INFO", code: "PUSH_RETRY_RECOVERED", tentativas: 2 }
    ]);
  });
  await t.test("concurrent requests retain their own alert ID", async () => {
    logs.length = 0;
    const gate = barrier(2);
    const responses = await Promise.all(
      [1, 2].map(pedidoId =>
        through(production, async () => {
          await gate();
          production.alert.operationalAlert({ code: "FINANCIAL_INTEGRITY_MISMATCH", pedidoId });
          return new Response(null);
        })
      )
    );
    assert.notEqual(
      responses[0].headers.get("X-Request-Id"),
      responses[1].headers.get("X-Request-Id")
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        alerts().find(row => row.pedidoId === i + 1).requestId,
        responses[i].headers.get("X-Request-Id")
      );
  });
  await t.test("telemetry sink failure cannot change business response", async () => {
    const throwing = t.mock.method(console, "warn", () => {
      throw new Error("sink unavailable");
    });
    try {
      await contracts.http(production);
    } finally {
      throwing.mock.restore();
    }
  });
  await t.test("actual financial mismatch, resolution and paid-stock invariant", async () => {
    const db = await fixture(t);
    const mp = {
      id: 101,
      status: "approved",
      transaction_amount: 0.01,
      payment_method_id: "pix",
      external_reference: "token",
      currency_id: "BRL"
    };
    t.mock.method(globalThis, "fetch", async () => mpResponse(mp));
    async function sync() {
      const payment = await production.sync.fetchMpPayment("SECRET_TOKEN", "ORD101");
      return production.sync.syncPaymentFromMp(db, 1, payment);
    }
    logs.length = 0;
    const response = await through(production, async () => mpResponse(await sync()));
    assert.deepEqual(await response.json(), { ok: true, status: "PENDENTE", transicionou: false });
    assert.deepEqual(alerts(), [
      {
        kind: "OPERATIONAL_ALERT",
        severity: "CRITICAL",
        code: "FINANCIAL_INTEGRITY_MISMATCH",
        requestId: response.headers.get("X-Request-Id"),
        pedidoId: 1,
        pagamentoId: 1
      }
    ]);
    logs.length = 0;
    await through(production, async () => mpResponse(await sync()));
    assert.deepEqual(alerts(), [], "Repeated identical observation does not flood alerts");
    mp.transaction_amount = 100;
    logs.length = 0;
    await through(production, async () => mpResponse(await sync()));
    assert.ok(
      alerts().some(row => row.code === "FINANCIAL_INTEGRITY_RESOLVED" && row.severity === "INFO")
    );
    await db.prepare("UPDATE produtos SET estoque=0,estoque_reservado=0 WHERE id=1").run();
    await db.prepare("UPDATE pedido_itens SET estoque_estado='LIBERADO' WHERE pedido_id=1").run();
    logs.length = 0;
    const stock = await through(production, async () =>
      mpResponse(await production.reconcile.reconcilePedidoAfterFinancialChange(db, 1))
    );
    assert.deepEqual((await stock.json()).estoque, {
      ok: false,
      baixado: false,
      erro: "ESTOQUE_INSUFICIENTE"
    });
    assert.ok(
      alerts().some(
        row => row.code === "PAID_ORDER_STOCK_INCONSISTENT" && row.severity === "CRITICAL"
      )
    );
  });
  await t.test(
    "push transient failure quiet, exhausted retry WARNING, successful recovery INFO",
    async () => {
      const db = await fixture(t);
      await db
        .prepare(
          "INSERT INTO push_inscricoes(usuario_id,endpoint,p256dh,auth) VALUES(1,'https://push.invalid','invalid','invalid')"
        )
        .run();
      const env = { DB: db, VAPID_PUBLIC_KEY: "invalid", VAPID_PRIVATE_KEY: "invalid" };
      logs.length = 0;
      await through(production, async () =>
        mpResponse(await production.push.notificarNovoPedidoPago(db, env, 1))
      );
      assert.deepEqual(alerts(), [], "First transport failure is recoverable, not an alert");
      await db
        .prepare("UPDATE push_eventos SET tentativas=2,atualizado_em='2000-01-01 00:00:00'")
        .run();
      logs.length = 0;
      const response = await through(production, async () =>
        mpResponse(await production.push.reconciliarPushEventosFalhos(db, env))
      );
      assert.deepEqual(alerts(), [
        {
          kind: "OPERATIONAL_ALERT",
          severity: "WARNING",
          code: "PUSH_RETRY_EXHAUSTED",
          requestId: response.headers.get("X-Request-Id"),
          pedidoId: 1,
          tentativas: 3
        }
      ]);
      logs.length = 0;
      await through(production, async () =>
        mpResponse(await production.push.reconciliarPushEventosFalhos(db, env))
      );
      assert.deepEqual(alerts(), []);
      await db
        .prepare("UPDATE push_eventos SET tentativas=1,atualizado_em='2000-01-01 00:00:00'")
        .run();
      await db.prepare("DELETE FROM push_inscricoes").run();
      logs.length = 0;
      await through(production, async () =>
        mpResponse(await production.push.reconciliarPushEventosFalhos(db, env))
      );
      assert.ok(
        alerts().some(row => row.code === "PUSH_RETRY_RECOVERED" && row.severity === "INFO")
      );
    }
  );
  await t.test("real unauthenticated route still only returns 401", async () => {
    logs.length = 0;
    const response = await through(production, async () => {
      const result = await production.auth.requireUser({}, request());
      return result.error;
    });
    assert.equal(response.status, 401);
    assert.deepEqual(alerts(), []);
  });
  const controls = [
    {
      name: "raw external error logged",
      contract: "safe",
      replacements: [["code: input.code,", "code: input.code, error: input.error,"]]
    },
    {
      name: "token leaked",
      contract: "safe",
      replacements: [["code: input.code,", "code: input.code, token: input.token,"]]
    },
    {
      name: "expected error promoted to CRITICAL",
      contract: "expected",
      replacements: [
        ["if (!Object.hasOwn(SEVERITY, input.code)) return;", ""],
        [
          "const severity = SEVERITY[input.code];",
          'const severity = SEVERITY[input.code] ?? "CRITICAL";'
        ]
      ]
    },
    {
      name: "requestId lost",
      contract: "safe",
      replacements: [
        ["const requestId = getRequestContext()?.requestId;", "const requestId = undefined;"]
      ]
    },
    {
      name: "HTTP response changed",
      contract: "http",
      path: "functions/_middleware.ts",
      replacements: [
        ["new Response(response.body, response)", 'new Response("changed", {status:200})']
      ]
    }
  ];
  for (const control of controls)
    await t.test(`negative control: ${control.name}`, async () => {
      const module = await compile(control);
      await assert.rejects(contracts[control.contract](module), { code: "ERR_ASSERTION" });
    });
});
