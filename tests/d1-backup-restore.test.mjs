import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupLocal, main, restoreInto } from "../scripts/d1-backup.mjs";
import {
  createWorkspace,
  execLocal,
  normalizeDump,
  root,
  runWrangler
} from "../scripts/d1-local.mjs";
import { verifyDump } from "../scripts/d1-verify.mjs";

// Backup e restore do D1 em ambiente LOCAL e descartável (scripts/d1-backup.mjs). Nada aqui acessa a
// Cloudflare: o Wrangler roda sempre com --local, num banco criado pelas migrations reais do repositório.

const SEED = `
INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel) VALUES(1,'Teste','teste','teste@example.invalid','unused','OWNER');
INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(1,'Bolo de cenoura','BOLO',5000,10,2);
INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(2,'Pudim D''Ávila 🍮','PUDIM',3000,5,0);
INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key,reserva_status,mp_payment_id,pix_expira_em) VALUES(1,'token-1','José D''Ávila 🍰
segunda linha; com ponto-e-vírgula','000',10000,'pedido-1','ATIVA','101','2099-01-01T00:00:00Z');
INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,status_item,estoque_estado,estoque_reservado_em) VALUES(1,1,1,'Bolo de cenoura',2,5000,10000,'ATIVO','RESERVADO',CURRENT_TIMESTAMP);
INSERT INTO pedido_pagamentos(id,pedido_id,metodo,origem,valor_centavos,status,mp_payment_id,idempotency_key) VALUES(1,1,'PIX_MP','SITE',10000,'PAGO','101','pagamento-1');
INSERT INTO pedido_pagamento_alocacoes(pagamento_id,pedido_item_id,valor_centavos) VALUES(1,1,10000);
`;

// O histórico (d1_migrations) cresce a cada migration nova: nada abaixo assume quantas existem. O próximo
// id livre sai do próprio dump, nunca de um número fixo.
const LINHA_MIGRATION = /^INSERT INTO "?d1_migrations"? VALUES\((\d+),[^\n]*(?:\n|$)/gim;

function historicoDoDump(dump) {
  const linhas = [...dump.matchAll(LINHA_MIGRATION)];
  assert.ok(linhas.length > 0, "o dump não tem INSERTs de d1_migrations");
  const ultima = linhas.reduce((a, b) => (Number(b[1]) > Number(a[1]) ? b : a));
  return { total: linhas.length, ultimoId: Number(ultima[1]), ultimaLinha: ultima[0] };
}

// Acrescenta uma migration ao dump, com o próximo id livre, logo depois da linha de maior id. Com
// `sequencia`, a linha de d1_migrations em sqlite_sequence acompanha o novo id (como no banco de verdade).
function comMigrationAcrescentada(dump, nome, { sequencia = false } = {}) {
  const { ultimoId, ultimaLinha } = historicoDoDump(dump);
  const id = ultimoId + 1;
  const nova = `INSERT INTO "d1_migrations" VALUES(${id},'${nome}','2026-01-01 00:00:00');\n`;
  const inteira = ultimaLinha.endsWith("\n") ? ultimaLinha : `${ultimaLinha}\n`;
  let out = dump.replace(ultimaLinha, () => inteira + nova);
  if (sequencia) {
    out = out.replace(
      /(INSERT INTO "sqlite_sequence" VALUES\('d1_migrations',)\d+(\);)/,
      (_, antes, depois) => `${antes}${id}${depois}`
    );
  }
  return { dump: out, id };
}

test("normalizeDump sobe os CREATE TABLE para o topo e preserva o resto", () => {
  const dump = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE filha (id INTEGER PRIMARY KEY, pai_id INTEGER REFERENCES pai(id));",
    'INSERT INTO "filha" VALUES(1,1);',
    "CREATE TABLE pai (",
    "  id INTEGER PRIMARY KEY",
    ");",
    'INSERT INTO "pai" VALUES(1);',
    "CREATE INDEX idx_filha ON filha(pai_id);",
    "CREATE TRIGGER gatilho AFTER INSERT ON pai",
    "BEGIN",
    "  INSERT INTO log VALUES(1);",
    "END;",
    ""
  ].join("\n");

  const out = normalizeDump(dump);
  const lines = out.split("\n");
  assert.equal(lines[0], "PRAGMA defer_foreign_keys=TRUE;");
  assert.ok(out.indexOf("CREATE TABLE pai") < out.indexOf('INSERT INTO "filha"'));
  assert.ok(
    out.indexOf("CREATE TABLE filha") < out.indexOf("CREATE TABLE pai"),
    "ordem relativa mantida"
  );
  assert.ok(
    out.includes("BEGIN\n  INSERT INTO log VALUES(1);\nEND;"),
    "corpo do trigger não é partido"
  );
  assert.ok(out.indexOf("CREATE INDEX") < out.indexOf("CREATE TRIGGER"));
  assert.equal(normalizeDump(out), out, "normalizar duas vezes não muda nada");
  assert.deepEqual(
    [...lines].filter(Boolean).sort(),
    dump.split("\n").filter(Boolean).sort(),
    "nenhuma linha perdida ou criada"
  );
  assert.throws(() => normalizeDump("CREATE TABLE incompleta (id INTEGER\n"), /sem ";" final/);
});

test("a migration acrescentada ao dump usa o próximo id livre, com qualquer tamanho de histórico", () => {
  const sintetico = total =>
    [
      "PRAGMA defer_foreign_keys=TRUE;",
      "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);",
      ...Array.from(
        { length: total },
        (_, i) =>
          `INSERT INTO "d1_migrations" VALUES(${i + 1},'${String(i + 1).padStart(4, "0")}_m.sql','2026-01-01 00:00:00');`
      ),
      "DELETE FROM sqlite_sequence;",
      `INSERT INTO "sqlite_sequence" VALUES('d1_migrations',${total});`,
      ""
    ].join("\n");
  const ids = dump => [...dump.matchAll(LINHA_MIGRATION)].map(m => Number(m[1]));

  // Hoje (35), a primeira migration seguinte (36) e históricos bem maiores.
  for (const total of [1, 35, 36, 120]) {
    const { dump, id } = comMigrationAcrescentada(sintetico(total), "0099_inexistente.sql");
    const todos = ids(dump);
    assert.equal(id, total + 1, `total=${total}: próximo id`);
    assert.equal(new Set(todos).size, todos.length, `total=${total}: id duplicado`);
    assert.equal(todos.at(-1), total + 1, `total=${total}: a linha nova vem depois da última`);
  }

  // Linhas fora de ordem: vale o MAIOR id, não o último nem o primeiro.
  const fora = sintetico(3).replace(
    /(INSERT INTO "d1_migrations" VALUES\(1,[^\n]*\n)([\s\S]*?VALUES\(3,[^\n]*\n)/,
    "$2$1"
  );
  assert.notEqual(fora, sintetico(3));
  assert.equal(comMigrationAcrescentada(fora, "0099_inexistente.sql").id, 4);

  const comSequencia = comMigrationAcrescentada(sintetico(36), "0037_nova.sql", {
    sequencia: true
  });
  assert.match(
    comSequencia.dump,
    /VALUES\('d1_migrations',37\);/,
    "sqlite_sequence acompanha o id"
  );
  assert.throws(
    () => comMigrationAcrescentada("CREATE TABLE x (a);\n", "x.sql"),
    /não tem INSERTs de d1_migrations/
  );
});

test("o script só opera em D1 local: --remote, --preview e d1 sem --local são recusados", () => {
  // Com --local junto, só a recusa de --remote/--preview pode barrar (não a de "d1 sem --local").
  const remoto = /--remote e --preview/;
  assert.throws(
    () => runWrangler(["d1", "export", "x", "--local", "--remote", "--output", "y"], { cwd: root }),
    remoto
  );
  assert.throws(
    () => runWrangler(["d1", "execute", "x", "--local", "--preview"], { cwd: root }),
    remoto
  );
  assert.throws(
    () => runWrangler(["d1", "export", "x", "--output", "y"], { cwd: root }),
    /sem --local/
  );
  assert.throws(() => main(["verify", "dump.sql", "--remote"]), /Opção desconhecida: --remote/);
});

test(
  "ciclo completo: backup, verify, restore idêntico e detecção de dumps ruins",
  { timeout: 300_000 },
  async t => {
    const work = mkdtempSync(path.join(tmpdir(), "rp-doces-d1test-"));
    t.after(() => rmSync(work, { recursive: true, force: true, maxRetries: 3 }));
    const checkNames = result => result.checks.map(check => check.name);
    const failing = result =>
      result.checks.filter(check => check.status === "falha").map(check => check.name);

    // Origem: D1 local com as migrations reais (como `npm run db:migrate:local`) mais dados difíceis.
    mkdirSync(path.join(work, "origem"));
    const source = createWorkspace({
      dir: path.join(work, "origem"),
      migrationsDir: path.join(root, "migrations")
    });
    const applied = runWrangler(
      [
        "d1",
        "migrations",
        "apply",
        source.name,
        "--local",
        "--persist-to",
        source.state,
        "-c",
        source.config
      ],
      { cwd: source.dir }
    );
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    writeFileSync(path.join(work, "seed.sql"), SEED);
    execLocal(source, { file: path.join(work, "seed.sql") });

    const dump = path.join(work, "backup", "d1.sql");
    await t.test("backup gera o dump e o .sha256", () => {
      assert.equal(backupLocal({ dir: source.dir, out: dump }), dump);
      assert.ok(statSync(dump).size > 0, "dump não pode ter 0 bytes");
      assert.match(readFileSync(`${dump}.sha256`, "utf8"), /^[0-9a-f]{64} {2}d1\.sql\n$/);
      assert.throws(
        () => backupLocal({ dir: source.dir, out: dump }),
        /Já existe/,
        "não sobrescreve backup"
      );
    });

    await t.test(
      "verify aprova o dump: restore, migrations, schema, integridade e constraints",
      () => {
        const result = verifyDump(dump);
        assert.deepEqual(failing(result), [], JSON.stringify(result.checks, null, 1));
        assert.deepEqual(
          result.checks.filter(check => check.status === "aviso"),
          []
        );
        for (const name of [
          "arquivo",
          "restauração",
          "migrations",
          "integridade",
          "schema",
          "autoincrement",
          "constraints"
        ]) {
          assert.ok(checkNames(result).includes(name), `falta a conferência "${name}"`);
        }
        assert.equal(result.ok, true);
      }
    );

    await t.test(
      "restore reproduz o banco: tabelas, schema, sequências e novo export idêntico",
      () => {
        const restored = restoreInto({ dump, dir: path.join(work, "restaurado") });
        const read = (ws, sql) => execLocal(ws, { command: sql });
        const tables = read(
          source,
          "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7)<>'sqlite_' ORDER BY name"
        )[0].map(row => row.name);
        assert.ok(tables.length >= 20, "origem deveria ter todas as tabelas das migrations");
        const rows = ws =>
          read(ws, tables.map(name => `SELECT * FROM "${name}" ORDER BY rowid`).join(";\n"));
        assert.deepEqual(rows(restored), rows(source), "linhas idênticas em todas as tabelas");
        const schema = "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name";
        assert.deepEqual(
          read(restored, schema),
          read(source, schema),
          "schema idêntico (inclui triggers e índices)"
        );
        const sequences = "SELECT name, seq FROM sqlite_sequence ORDER BY name";
        assert.deepEqual(
          read(restored, sequences),
          read(source, sequences),
          "sqlite_sequence idêntica"
        );

        const again = backupLocal({
          dir: restored.dir,
          out: path.join(work, "backup", "d1-again.sql")
        });
        assert.equal(
          readFileSync(again, "utf8"),
          readFileSync(dump, "utf8"),
          "export(restore(export(db))) == export(db)"
        );
        assert.throws(
          () => restoreInto({ dump, dir: restored.dir }),
          /Já existe D1 local/,
          "recusa pasta com D1"
        );
      }
    );

    await t.test("dump alterado depois do backup é reprovado pelo .sha256", () => {
      const bad = path.join(work, "backup", "alterado.sql");
      copyFileSync(dump, bad);
      copyFileSync(`${dump}.sha256`, `${bad}.sha256`);
      writeFileSync(bad, `${readFileSync(bad, "utf8")}\n-- adulterado\n`);
      const result = verifyDump(bad);
      assert.equal(result.ok, false);
      assert.deepEqual(failing(result), ["arquivo"]);
    });

    await t.test("dump vazio (0 bytes) é reprovado", () => {
      const empty = path.join(work, "backup", "vazio.sql");
      writeFileSync(empty, "");
      const result = verifyDump(empty);
      assert.equal(result.ok, false);
      assert.match(result.checks[0].detail, /0 bytes/);
    });

    await t.test("dump com linha órfã (chave estrangeira) é reprovado na restauração", () => {
      const orphan = `INSERT INTO "pedido_pagamentos"(id,pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(99,999,'PIX_MP','SITE',100,'PENDENTE','orfao');\n`;
      const bad = path.join(work, "backup", "orfao.sql");
      writeFileSync(
        bad,
        readFileSync(dump, "utf8").replace(/^PRAGMA[^\n]*\n/, m => m + orphan)
      );
      const result = verifyDump(bad);
      assert.deepEqual(failing(result), ["restauração"]);
      assert.match(result.checks.at(-1).detail, /FOREIGN KEY/);
    });

    await t.test("dump que falha por outro motivo não é rotulado como chave estrangeira", () => {
      const repetida = `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'repetida.sql','2026-01-01 00:00:00');\n`;
      const bad = path.join(work, "backup", "id-repetido.sql");
      writeFileSync(
        bad,
        readFileSync(dump, "utf8").replace(/^PRAGMA[^\n]*\n/, m => m + repetida)
      );
      const result = verifyDump(bad);
      assert.deepEqual(failing(result), ["restauração"]);
      assert.match(result.checks.at(-1).detail, /UNIQUE constraint failed/);
      assert.doesNotMatch(result.checks.at(-1).detail, /FOREIGN KEY/);
    });

    await t.test(
      "dump sem triggers e com migration desconhecida é reprovado em vários pontos",
      () => {
        const original = readFileSync(dump, "utf8");
        const { dump: broken, id } = comMigrationAcrescentada(
          original.replace(/^CREATE TRIGGER[\s\S]*?^END;$/gm, ""),
          "0099_inexistente.sql"
        );
        assert.notEqual(broken, original);
        assert.equal(id, historicoDoDump(original).ultimoId + 1);
        const bad = path.join(work, "backup", "sem-triggers.sql");
        writeFileSync(bad, broken);
        const result = verifyDump(bad);
        assert.equal(result.ok, false);
        const names = failing(result);
        assert.ok(
          !names.includes("restauração"),
          `colisão de id na restauração: ${JSON.stringify(result.checks)}`
        );
        for (const expected of ["migrations", "schema", "constraints"]) {
          assert.ok(names.includes(expected), `"${expected}" deveria reprovar; falhas: ${names}`);
        }
      }
    );

    await t.test("histórico com migrations a mais continua sem colisão de id", () => {
      const original = readFileSync(dump, "utf8");
      const { ultimoId } = historicoDoDump(original);
      // Como se o banco já tivesse a migration seguinte (a sequência acompanha) e mais uma desconhecida.
      const crescido = comMigrationAcrescentada(
        original,
        `${String(ultimoId + 1).padStart(4, "0")}_simulada.sql`,
        { sequencia: true }
      );
      const { dump: broken, id } = comMigrationAcrescentada(crescido.dump, "0099_inexistente.sql", {
        sequencia: true
      });
      assert.equal(crescido.id, ultimoId + 1);
      assert.equal(id, ultimoId + 2);
      const bad = path.join(work, "backup", "historico-maior.sql");
      writeFileSync(bad, broken);
      const result = verifyDump(bad);
      assert.deepEqual(failing(result), ["migrations"], JSON.stringify(result.checks, null, 1));
    });
  }
);
