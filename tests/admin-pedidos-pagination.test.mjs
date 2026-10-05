import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build } from "esbuild";
import { app, fixture } from "./helpers/b3.mjs";

const normalization = `const page =
      Number.isInteger(requestedPage) &&
      requestedPage >= 1 &&
      (requestedPage - 1) * ITEMS_PER_PAGE < 2 ** 63
        ? requestedPage
        : 1;`;
const offset = "const offset = (page - 1) * ITEMS_PER_PAGE;";
const mutations = {
  oldNormalization: [
    normalization,
    'const page = Math.max(1, Number(url.searchParams.get("page")) || 1);'
  ],
  float: ["Number.isInteger(requestedPage)", "Number.isFinite(requestedPage)"],
  infinity: ["const page =\n", "const page = requestedPage === Infinity ? requestedPage :\n"],
  fractionalOffset: [offset, "const offset = (page - 1) * ITEMS_PER_PAGE + 0.5;"],
  pageOne: [offset, "const offset = page * ITEMS_PER_PAGE;"],
  pageTwo: [offset, "const offset = page === 2 ? 0 : (page - 1) * ITEMS_PER_PAGE;"],
  overflow: ["(requestedPage - 1) * ITEMS_PER_PAGE < 2 ** 63", "true"]
};
let list = app.adminCreate.onRequestGet;
if (process.env.PAGINATION_MUTATION) {
  const original = (await readFile("functions/lib/adminPedidos/list.ts", "utf8")).replaceAll(
    "\r\n",
    "\n"
  );
  const [before, after] = mutations[process.env.PAGINATION_MUTATION];
  assert.ok(original.includes(before), "Mutation anchor must exist");
  const bundle = await build({
    entryPoints: ["functions/api/admin/pedidos.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "pagination-mutant",
        setup(b) {
          b.onLoad({ filter: /[/\\]adminPedidos[/\\]list\.ts$/ }, args => ({
            contents: original.replace(before, after),
            loader: "ts",
            resolveDir: args.path.replace(/[/\\][^/\\]+$/, "")
          }));
        }
      }
    ]
  });
  const source = `${bundle.outputFiles[0].text}\n//# sourceURL=rp-pagination-mutant.mjs`;
  list = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`))
    .onRequestGet;
}

async function harness(t) {
  const db = await fixture(t, { ledger: false, reserve: "SEM_RESERVA" });
  const session = await app.auth.createSession(db, 1);
  await db
    .prepare(
      "UPDATE pedidos SET origem_pedido='MANUAL', cliente_nome='Other', criado_em='2026-01-01T00:01:00Z' WHERE id=1"
    )
    .run();
  await db.batch(
    Array.from({ length: 17 }, (_, index) => {
      const id = index + 2;
      return db
        .prepare(
          `INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,
      valor_total_centavos,idempotency_key,origem_pedido,status_pagamento,status_pedido,criado_em)
      VALUES(?,?,?,'',1000,?,'MANUAL','PENDENTE','NOVO',?)`
        )
        .bind(
          id,
          `pagination-token-${id}`,
          id >= 6 ? "Selected" : "Other",
          `pagination-key-${id}`,
          `2026-01-01T00:${String(id).padStart(2, "0")}:00Z`
        );
    })
  );
  const statements = [];
  db.hook = batch => {
    statements.push(...batch);
    return batch;
  };
  t.mock.method(console, "error", () => {});
  return async (page, filters = {}) => {
    statements.length = 0;
    const url = new URL("https://local.test/api/admin/pedidos");
    if (page !== undefined) url.searchParams.set("page", String(page));
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    const response = await list({
      env: { DB: db },
      request: new Request(url, {
        headers: { Cookie: session.cookie.split(";")[0] }
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const query = statements.find(statement => /LIMIT \? OFFSET \?/.test(statement.sql));
    assert.ok(query, "Expected real paginated query");
    const [limit, actualOffset] = query.args.slice(-2);
    assert.equal(limit, 8);
    assert.ok(Number.isInteger(actualOffset) && Number.isFinite(actualOffset) && actualOffset >= 0);
    assert.ok(actualOffset < 2 ** 63);
    assert.ok(Number.isInteger(body.page) && Number.isFinite(body.page) && body.page >= 1);
    assert.match(query.sql, /ORDER BY criado_em DESC/);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(
      statements.some(statement => /^(INSERT|UPDATE|DELETE)\b/i.test(statement.sql.trim())),
      false
    );
    return { body, query, actualOffset };
  };
}

test("pagination: valid pages preserve rows, count, LIMIT and OFFSET", async t => {
  const request = await harness(t);
  for (const [page, expectedPage, expectedOffset, ids] of [
    [undefined, 1, 0, [18, 17, 16, 15, 14, 13, 12, 11]],
    [1, 1, 0, [18, 17, 16, 15, 14, 13, 12, 11]],
    ["1", 1, 0, [18, 17, 16, 15, 14, 13, 12, 11]],
    [2, 2, 8, [10, 9, 8, 7, 6, 5, 4, 3]],
    ["2", 2, 8, [10, 9, 8, 7, 6, 5, 4, 3]],
    [3, 3, 16, [2, 1]],
    [" 2 ", 2, 8, [10, 9, 8, 7, 6, 5, 4, 3]],
    ["2.0", 2, 8, [10, 9, 8, 7, 6, 5, 4, 3]],
    ["2e0", 2, 8, [10, 9, 8, 7, 6, 5, 4, 3]]
  ])
    await t.test(`${typeof page}/${String(page)}`, async () => {
      const { body, actualOffset } = await request(page);
      assert.equal(body.page, expectedPage);
      assert.equal(actualOffset, expectedOffset);
      assert.equal(body.total, 18);
      assert.equal(body.totalPages, 3);
      assert.equal(body.counts.todos, 18);
      assert.deepEqual(
        body.pedidos.map(pedido => pedido.id),
        ids
      );
    });
});

test("pagination: invalid inputs normalize to page one before SQL", async t => {
  const request = await harness(t);
  for (const page of [
    null,
    "",
    " ",
    0,
    "0",
    -1,
    "-1",
    1.1,
    "1.1",
    1.5,
    "1.5",
    Infinity,
    "Infinity",
    -Infinity,
    NaN,
    "NaN",
    "invalid",
    1e19,
    "1e19",
    1e308,
    "1e308",
    Number.MAX_VALUE,
    2 ** 60
  ])
    await t.test(`${typeof page}/${String(page)}`, async () => {
      const { body, actualOffset } = await request(page);
      assert.equal(body.page, 1);
      assert.equal(actualOffset, 0);
      assert.deepEqual(
        body.pedidos.map(pedido => pedido.id),
        [18, 17, 16, 15, 14, 13, 12, 11]
      );
    });
});

test("pagination: supported large pages remain large and return empty results", async t => {
  const request = await harness(t);
  for (const [page, expectedOffset] of [
    [1000000000000, 7999999999992],
    [Number.MAX_SAFE_INTEGER, 72057594037927920],
    [1000000000000000000, 8000000000000000000]
  ])
    await t.test(String(page), async () => {
      const { body, actualOffset } = await request(page);
      assert.equal(body.page, page);
      assert.equal(actualOffset, expectedOffset);
      assert.equal(body.total, 18);
      assert.equal(body.totalPages, 3);
      assert.deepEqual(body.pedidos, []);
    });
});

test("pagination: search and status filters preserve binds and page boundaries", async t => {
  const request = await harness(t);
  for (const [page, expectedPage, expectedOffset, ids] of [
    [1, 1, 0, [18, 17, 16, 15, 14, 13, 12, 11]],
    [2, 2, 8, [10, 9, 8, 7, 6]],
    ["1.1", 1, 0, [18, 17, 16, 15, 14, 13, 12, 11]]
  ]) {
    const { body, query, actualOffset } = await request(page, {
      status: "novos",
      search: "Selected"
    });
    assert.equal(body.page, expectedPage);
    assert.equal(actualOffset, expectedOffset);
    assert.equal(body.total, 13);
    assert.equal(body.totalPages, 2);
    assert.equal(body.counts.todos, 18);
    assert.deepEqual(
      body.pedidos.map(pedido => pedido.id),
      ids
    );
    assert.deepEqual(query.args, ["%Selected%", "%Selected%", 8, expectedOffset]);
    assert.match(query.sql, /AND status_pedido = 'NOVO'/);
  }
});

if (!process.env.PAGINATION_MUTATION)
  test("negative controls: mutations must fail behavioral assertions", async t => {
    const run = promisify(execFile),
      env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    for (const [mutation, pattern] of Object.entries({
      oldNormalization: "^pagination: invalid",
      float: "^pagination: invalid",
      infinity: "^pagination: invalid",
      fractionalOffset: "^pagination: valid",
      pageOne: "^pagination: valid",
      pageTwo: "^pagination: valid",
      overflow: "^pagination: invalid"
    }))
      await t.test(mutation, async () => {
        let failure;
        try {
          await run(
            process.execPath,
            ["--test", `--test-name-pattern=${pattern}`, "tests/admin-pedidos-pagination.test.mjs"],
            {
              env: { ...env, PAGINATION_MUTATION: mutation },
              timeout: 30000,
              maxBuffer: 2_000_000
            }
          );
        } catch (error) {
          failure = error;
        }
        assert.ok(failure, `${mutation} survived`);
        assert.equal(failure.code, 1);
        assert.match(failure.stdout, /ERR_ASSERTION/);
        assert.doesNotMatch(failure.stdout, /Mutation anchor must exist/);
      });
  });
