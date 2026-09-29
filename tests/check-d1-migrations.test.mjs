import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyze,
  schemaMarkers,
  listLocalMigrations,
  assertReadOnly
} from "../scripts/check-d1-migrations.mjs";

// Guarda de migrations do deploy: roda o script REAL contra uma API Cloudflare
// simulada (D1 REST). Nada aqui toca a Cloudflare de verdade.

const script = new URL("../scripts/check-d1-migrations.mjs", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);
const realDir = new URL("../migrations/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const localNames = listLocalMigrations(realDir);
const latest = localNames[localNames.length - 1];
const markers = schemaMarkers(readFileSync(path.join(realDir, latest), "utf8"));

// Histórico de produção: nomes legados de 3 dígitos + todos os atuais.
const legacy = ["002_admin.sql", "003_username.sql", "036_reembolsos_parciais.sql"];
const rowsFor = names =>
  names.map((name, i) => ({ id: i + 1, name, applied_at: "2026-09-01 00:00:00" }));
const fullHistory = () => rowsFor([...legacy, ...localNames]);

function fullSchema() {
  return {
    objects: markers.objects.map(o => ({ type: o.type, name: o.name })),
    columns: Object.fromEntries(markers.columns.map(c => [c.table, c.columns]))
  };
}

// Servidor: cada cenário define {rows, schema, behavior}.
async function withServer(state, fn) {
  const seen = { methods: [], sqls: [], auth: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      seen.methods.push(req.method);
      seen.auth.push(req.headers.authorization);
      const send = (status, json) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(typeof json === "string" ? json : JSON.stringify(json));
      };
      const fail = state.fail?.();
      if (fail === "drop") return req.socket.destroy();
      if (fail === "hang") return; // nunca responde
      if (fail)
        return send(
          fail.status,
          fail.body ?? { success: false, errors: [{ code: 1, message: "x" }], result: null }
        );
      const payload = JSON.parse(body);
      const answer = stmt => {
        seen.sqls.push(stmt.sql);
        if (/FROM d1_migrations/.test(stmt.sql)) {
          if (state.noTable) return null;
          return { success: true, results: state.rows };
        }
        if (/FROM sqlite_master/.test(stmt.sql)) {
          return {
            success: true,
            results: state.schema.objects.filter(o => stmt.params.includes(o.name))
          };
        }
        if (/pragma_table_info/.test(stmt.sql)) {
          return {
            success: true,
            results: (state.schema.columns[stmt.params[0]] ?? []).map(name => ({ name }))
          };
        }
        throw new Error(`SQL inesperado no mock: ${stmt.sql}`);
      };
      const list = payload.batch ?? [payload];
      const out = list.map(answer);
      if (out.includes(null))
        return send(400, {
          success: false,
          errors: [{ code: 7500, message: "no such table: d1_migrations: SQLITE_ERROR" }],
          result: []
        });
      send(200, { success: true, errors: [], result: out });
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/client/v4`, seen);
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }
}

function runCli(base, extra = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: "token-do-deploy-nao-deve-ser-usado",
        CLOUDFLARE_D1_READ_TOKEN: "token-segredo-de-teste",
        CLOUDFLARE_ACCOUNT_ID: "acct",
        D1_DATABASE_ID: "db-id",
        CF_API_BASE: base,
        MIGRATION_CHECK_RETRIES: "2",
        MIGRATION_CHECK_DELAY_MS: "20",
        MIGRATION_CHECK_TIMEOUT_MS: "400",
        GITHUB_STEP_SUMMARY: "",
        ...extra
      }
    });
    let out = "";
    child.stdout.on("data", c => (out += c));
    child.stderr.on("data", c => (out += c));
    child.on("close", code => resolve({ code, out }));
  });
}

const baseState = () => ({ rows: fullHistory(), schema: fullSchema() });

test("banco atualizado: sai 0, só faz SELECT e confere o schema da última migration", async () => {
  await withServer(baseState(), async (base, seen) => {
    const r = await runCli(base);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /em dia/);
    assert.match(r.out, new RegExp(`Schema conferido.*${latest}`));
    assert.ok(seen.sqls.length >= 2 && seen.sqls.every(s => /^SELECT\b/i.test(s)), "apenas SELECT");
    assert.ok(seen.methods.every(m => m === "POST"));
    assert.ok(
      seen.auth.every(a => a === "Bearer token-segredo-de-teste"),
      "usa só o token de leitura do D1"
    );
    assert.ok(!r.out.includes("token-segredo-de-teste"), "o token nunca aparece na saída");
  });
});

test("migration pendente: bloqueia (1) e lista o arquivo, sem sugerir execução automática", async () => {
  const state = baseState();
  state.rows = rowsFor([...legacy, ...localNames.slice(0, -1)]);
  await withServer(state, async base => {
    const r = await runCli(base);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /BLOQUEADO/);
    assert.ok(r.out.includes(latest), "nome do arquivo pendente");
    assert.match(r.out, /PENDENTES/);
  });
});

test("lacuna: migration do meio pendente com posteriores aplicadas", async () => {
  const gap = localNames[5];
  const state = baseState();
  state.rows = rowsFor([...legacy, ...localNames.filter(n => n !== gap)]);
  await withServer(state, async base => {
    const r = await runCli(base);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(gap));
    assert.match(r.out, /lacuna/);
  });
});

test("histórico inconsistente: migration atual desconhecida, duplicada e fora do padrão", async () => {
  for (const [rows, pattern] of [
    [[...fullHistory(), { id: 900, name: "0999_futura.sql", applied_at: "x" }], /0999_futura\.sql/],
    [[...fullHistory(), { id: 901, name: localNames[0], applied_at: "x" }], /mais de uma vez/],
    [[...fullHistory(), { id: 902, name: "qualquer-coisa.sql", applied_at: "x" }], /fora do padrão/]
  ]) {
    await withServer({ ...baseState(), rows }, async base => {
      const r = await runCli(base);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, pattern);
    });
  }
});

test("migration registrada mas schema ausente: bloqueia mesmo com nomes em dia", async () => {
  const state = baseState();
  state.schema = { objects: [], columns: {} };
  await withServer(state, async base => {
    const r = await runCli(base);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /schema remoto não tem/);
    assert.ok(r.out.includes(latest));
  });
});

test("tabela d1_migrations inexistente: bloqueia (1)", async () => {
  await withServer({ ...baseState(), noTable: true }, async base => {
    const r = await runCli(base);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /d1_migrations não existe/);
  });
});

test("erro de autenticação (401/403/404): bloqueia com 2 e sem repetir tentativas", async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    await withServer(
      {
        ...baseState(),
        fail: () => {
          calls++;
          return { status };
        }
      },
      async base => {
        const r = await runCli(base);
        assert.equal(r.code, 2, `${status}: ${r.out}`);
        assert.match(r.out, /BLOQUEADO/);
        assert.equal(calls, 1, "erro de credencial não é repetido");
        assert.ok(!r.out.includes("token-segredo-de-teste"));
      }
    );
  }
});

test("secret CLOUDFLARE_D1_READ_TOKEN ausente: bloqueia (2) com mensagem clara, sem chamar a API nem usar o token do deploy", async () => {
  for (const missing of ["", undefined]) {
    await withServer(baseState(), async (base, seen) => {
      const r = await runCli(base, { CLOUDFLARE_D1_READ_TOKEN: missing });
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /BLOQUEADO/);
      assert.match(r.out, /CLOUDFLARE_D1_READ_TOKEN ausente/);
      assert.equal(seen.sqls.length, 0, "não há fallback para o CLOUDFLARE_API_TOKEN");
      assert.ok(
        !r.out.includes("token-do-deploy-nao-deve-ser-usado") &&
          !r.out.includes("token-segredo-de-teste")
      );
    });
  }
  await withServer(baseState(), async (base, seen) => {
    const r = await runCli(base, { CLOUDFLARE_ACCOUNT_ID: "" });
    assert.equal(r.code, 2, r.out);
    assert.equal(seen.sqls.length, 0);
  });
});

test("Cloudflare indisponível (5xx, 429, conexão derrubada, timeout): bloqueia com 3", async () => {
  for (const fail of [
    () => ({ status: 503 }),
    () => ({ status: 429 }),
    () => "drop",
    () => "hang"
  ]) {
    await withServer({ ...baseState(), fail }, async base => {
      const r = await runCli(base);
      assert.equal(r.code, 3, r.out);
      assert.match(r.out, /indisponível/);
      assert.match(r.out, /BLOQUEADO/);
    });
  }
  // Recupera se a segunda tentativa funcionar.
  let n = 0;
  await withServer(
    { ...baseState(), fail: () => (n++ === 0 ? { status: 502 } : null) },
    async base => {
      assert.equal((await runCli(base)).code, 0);
    }
  );
  // API totalmente fora do ar (porta fechada).
  const r = await runCli("http://127.0.0.1:9/client/v4");
  assert.equal(r.code, 3, r.out);
});

test("resposta inesperada (JSON inválido, success=false): bloqueia com 4", async () => {
  for (const fail of [
    () => ({ status: 200, body: "isto não é json" }),
    () => ({
      status: 200,
      body: { success: false, errors: [{ code: 1, message: "x" }], result: [] }
    }),
    () => ({ status: 200, body: { success: true, result: "x" } })
  ]) {
    await withServer({ ...baseState(), fail }, async base => {
      const r = await runCli(base);
      assert.equal(r.code, 4, r.out);
    });
  }
});

test("analyze: legadas de 3 dígitos são toleradas; .gitkeep e não-SQL são ignorados", () => {
  const ok = analyze({
    localNames: ["0001_a.sql", "0002_b.sql"],
    remoteRows: rowsFor(["001_old.sql", "0001_a.sql", "0002_b.sql"])
  });
  assert.deepEqual(
    [ok.pending, ok.unknownCurrent, ok.gaps, ok.duplicates, ok.outOfOrder],
    [[], [], [], [], []]
  );
  assert.deepEqual(ok.legacy, ["001_old.sql"]);
  const dir = mkdtempSync(path.join(tmpdir(), "mig-"));
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of ["0001_a.sql", ".gitkeep", "README.md"]) writeFileSync(path.join(dir, f), "");
    assert.deepEqual(listLocalMigrations(dir), ["0001_a.sql"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const order = analyze({
    localNames: ["0001_a.sql", "0002_b.sql"],
    remoteRows: [
      { id: 1, name: "0002_b.sql" },
      { id: 2, name: "0001_a.sql" }
    ]
  });
  assert.equal(order.outOfOrder.length, 1);
});

test("schemaMarkers: extrai o estado final (DROP/RENAME/ADD COLUMN) e cobre a migration mais recente real", () => {
  const m = schemaMarkers(`
    -- CREATE TABLE comentada;
    CREATE TABLE IF NOT EXISTS a (id INTEGER);
    CREATE TABLE tmp (id INTEGER);
    DROP TABLE a;
    ALTER TABLE tmp RENAME TO a;
    CREATE INDEX idx_a ON a(id);
    DROP TRIGGER IF EXISTS t1;
    CREATE TRIGGER t1 BEFORE INSERT ON a BEGIN SELECT 1; END;
    ALTER TABLE a ADD COLUMN extra TEXT;
  `);
  assert.deepEqual(m.objects.map(o => `${o.type}:${o.name}`).sort(), [
    "index:idx_a",
    "table:a",
    "trigger:t1"
  ]);
  assert.deepEqual(m.columns, [{ table: "a", columns: ["extra"] }]);
  assert.ok(
    markers.objects.length + markers.columns.length > 0,
    `${latest} precisa ter ao menos um marcador verificável`
  );
});

test("assertReadOnly recusa qualquer coisa que não seja um único SELECT", () => {
  assertReadOnly("SELECT 1");
  for (const bad of [
    "DELETE FROM d1_migrations",
    "INSERT INTO x VALUES (1)",
    "SELECT 1; DROP TABLE x",
    "UPDATE x SET a=1"
  ]) {
    assert.throws(() => assertReadOnly(bad), /só SELECT/);
  }
});
