// Verificação de um dump SQL do D1: restaura num D1 LOCAL descartável e confere o resultado.
// Usado por d1-backup.mjs (backup, verify) e pelos testes. Nunca acessa o banco remoto.
//
// Conferências (a ordem do relatório é a da execução):
//   arquivo        não vazio e, se houver <dump>.sha256, com o mesmo hash
//   restauração    o dump importa limpo no D1 local (inclui o cheque de chave estrangeira no commit)
//   migrations     d1_migrations legível e reconhecida pelo repositório (mesma análise do Migration Guard)
//   integridade    PRAGMA quick_check e foreign_key_check (o D1 não autoriza integrity_check)
//   schema         tabelas, índices, triggers e colunas das migrations aplicadas existem
//   autoincrement  sqlite_sequence não ficou atrás do maior id (ids reutilizáveis colidiriam com o Mercado Pago)
//   constraints    CHECK, FOREIGN KEY, UNIQUE e trigger críticos continuam rejeitando dado inválido

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analyze, listLocalMigrations, schemaMarkers } from "./check-d1-migrations.mjs";
import {
  UsageError,
  createWorkspace,
  execLocal,
  removeWorkspace,
  restoreDump,
  root,
  sha256File
} from "./d1-local.mjs";

// Cada sonda é uma chamada atômica: se o banco rejeita, nada é gravado; se aceita, a regra se perdeu na
// restauração. Dependem das colunas obrigatórias dessas tabelas: se uma migration mudar isso, o teste
// acusa e a sonda é ajustada.
const PROBES = [
  {
    regra: "estoque reservado <= estoque (CHECK)",
    sql: "INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(900000001,'probe','X',100,1,2)",
    erro: /CHECK constraint failed: estoque_reservado/
  },
  {
    regra: "valor de pagamento > 0 (CHECK)",
    sql: "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(900000001,'PIX_MP','SITE',-1,'PENDENTE','probe-valor')",
    erro: /CHECK constraint failed: valor_centavos > 0/
  },
  {
    regra: "pagamento exige pedido existente (FOREIGN KEY)",
    sql: "INSERT INTO pedido_pagamentos(pedido_id,metodo,origem,valor_centavos,status,idempotency_key) VALUES(987654321,'PIX_MP','SITE',100,'PENDENTE','probe-fk')",
    erro: /FOREIGN KEY constraint failed/
  },
  {
    regra: "username de admin único (UNIQUE INDEX)",
    sql: [
      "INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel) VALUES(900000001,'p','probe_d1_backup','p1@example.invalid','x','ADMIN')",
      "INSERT INTO usuarios_admin(id,nome,username,email,senha_hash,papel) VALUES(900000002,'p','probe_d1_backup','p2@example.invalid','x','ADMIN')"
    ].join(";\n"),
    erro: /UNIQUE constraint failed: usuarios_admin\.username/
  },
  {
    regra: "item de pedido exige estoque_estado (trigger)",
    sql: [
      "INSERT INTO produtos(id,nome,categoria,preco_centavos,estoque,estoque_reservado) VALUES(900000001,'probe','X',100,5,0)",
      "INSERT INTO pedidos(id,token_publico,cliente_nome,cliente_whatsapp,valor_total_centavos,idempotency_key) VALUES(900000001,'probe-token','probe','000',100,'probe-key')",
      "INSERT INTO pedido_itens(id,pedido_id,produto_id,produto_nome,quantidade,valor_unitario_centavos,valor_total_centavos,status_item) VALUES(900000001,900000001,900000001,'probe',1,100,100,'ATIVO')"
    ].join(";\n"),
    erro: /pedido_itens\.estoque_estado obrigatorio/
  }
];

const MAX_LISTED = 8;
const list = items =>
  items.length > MAX_LISTED
    ? `${items.slice(0, MAX_LISTED).join(", ")} (+${items.length - MAX_LISTED})`
    : items.join(", ");

export const formatBytes = bytes =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function checkHistory(ws, migrationsDir, add) {
  let rows;
  try {
    [rows] = execLocal(ws, {
      command: "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
    });
  } catch (error) {
    add("migrations", "falha", `d1_migrations ausente ou ilegível: ${error.message}`);
    return null;
  }
  if (rows.length === 0) {
    add("migrations", "falha", "d1_migrations está vazia: nenhuma migration registrada no backup");
    return null;
  }
  const report = analyze({ localNames: listLocalMigrations(migrationsDir), remoteRows: rows });
  const problems = [
    report.gaps.length && `lacuna no histórico: ${list(report.gaps)}`,
    report.unknownCurrent.length && `desconhecidas neste commit: ${list(report.unknownCurrent)}`,
    report.unrecognized.length && `nomes fora do padrão: ${list(report.unrecognized)}`,
    report.duplicates.length && `registradas mais de uma vez: ${list(report.duplicates)}`,
    report.outOfOrder.length && `fora de ordem: ${list(report.outOfOrder)}`
  ].filter(Boolean);
  if (problems.length) add("migrations", "falha", problems.join("; "));
  else {
    const legadas = `${report.legacy.length} legadas ignoradas`;
    add("migrations", "ok", `${report.applied.length} aplicadas e reconhecidas (${legadas})`);
  }
  if (report.pending.length) {
    add(
      "migrations",
      "aviso",
      `${report.pending.length} migration(s) do repositório ainda não aplicadas neste backup (${list(report.pending)}): aplique depois de restaurar`
    );
  }
  return report.applied;
}

function checkStructure(ws, markers, add) {
  let objects;
  let quick;
  let foreignKeys;
  let sequences;
  let columns;
  try {
    [objects, quick, foreignKeys, sequences, ...columns] = execLocal(ws, {
      command: [
        // _cf_* são tabelas internas do D1 local (Wrangler 4): negam leitura (SQLITE_AUTH) e o export as omite.
        "SELECT type, name FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_'",
        "PRAGMA quick_check",
        "PRAGMA foreign_key_check",
        "SELECT name, seq FROM sqlite_sequence",
        ...(markers?.columns ?? []).map(c => `SELECT name FROM pragma_table_info('${c.table}')`)
      ].join(";\n")
    });
  } catch (error) {
    add("estrutura", "falha", error.message);
    return null;
  }

  const quickOk = quick.length === 1 && quick[0].quick_check === "ok";
  if (quickOk && foreignKeys.length === 0) {
    add("integridade", "ok", "quick_check ok; foreign_key_check sem violações");
  } else {
    const examples = foreignKeys.slice(0, 3).map(r => `${r.table}#${r.rowid} -> ${r.parent}`);
    const problems = [
      !quickOk && `quick_check: ${quick.map(r => r.quick_check).join("; ")}`,
      foreignKeys.length > 0 &&
        `${foreignKeys.length} violação(ões) de chave estrangeira (ex.: ${examples.join(", ")})`
    ].filter(Boolean);
    add("integridade", "falha", problems.join("; "));
  }

  if (!markers) {
    add("schema", "aviso", "não conferido: histórico de migrations indisponível");
    return { objects, sequences };
  }
  const key = o => `${o.type}:${o.name}`;
  const have = new Set(objects.map(key));
  const missing = markers.objects.filter(o => !have.has(key(o))).map(o => `${o.type} ${o.name}`);
  markers.columns.forEach((entry, i) => {
    const present = new Set(columns[i].map(r => r.name));
    for (const column of entry.columns) {
      if (!present.has(column)) missing.push(`coluna ${entry.table}.${column}`);
    }
  });
  if (missing.length) add("schema", "falha", `faltam ${missing.length}: ${list(missing)}`);
  else {
    const objetos = `${markers.objects.length} objetos (tabelas, índices, triggers)`;
    add("schema", "ok", `${objetos} e colunas adicionadas das migrations aplicadas presentes`);
  }
  const expected = new Set(markers.objects.map(key));
  const extras = objects
    .filter(o => !expected.has(key(o)) && o.name !== "d1_migrations")
    .map(o => `${o.type} ${o.name}`);
  if (extras.length) add("schema", "aviso", `objetos fora das migrations atuais: ${list(extras)}`);
  return { objects, sequences };
}

function checkTables(ws, { objects, sequences }, add) {
  const tables = objects.filter(o => o.type === "table" && /^\w+$/.test(o.name)).map(o => o.name);
  const auto = sequences.filter(s => tables.includes(s.name));
  if (tables.length === 0) {
    add("contagem", "falha", "nenhuma tabela no banco restaurado");
    return;
  }
  // Uma instrução por tabela: o D1 limita os termos de um SELECT composto (UNION ALL).
  let results;
  try {
    results = execLocal(ws, {
      command: [
        ...tables.map(t => `SELECT COUNT(*) AS n FROM "${t}"`),
        ...auto.map(s => `SELECT MAX(rowid) AS m FROM "${s.name}"`)
      ].join(";\n")
    });
  } catch (error) {
    add("contagem", "falha", error.message);
    return;
  }
  const behind = auto.filter((s, i) => {
    const max = results[tables.length + i][0].m;
    return max != null && s.seq < max;
  });
  if (behind.length) {
    const names = list(behind.map(s => s.name));
    add(
      "autoincrement",
      "falha",
      `sqlite_sequence atrás do maior id em ${names}: ids poderiam ser reutilizados`
    );
  } else {
    add("autoincrement", "ok", `${auto.length} sequências consistentes com o maior id`);
  }
  const counts = tables.map((name, i) => ({ name, n: results[i][0].n }));
  const filled = counts.filter(c => c.n > 0).map(c => `${c.name}=${c.n}`);
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  add(
    "contagem",
    "info",
    `${tables.length} tabelas, ${total} linhas${filled.length ? `: ${filled.join(", ")}` : ""}`
  );
}

function checkConstraints(ws, add) {
  const failures = [];
  for (const probe of PROBES) {
    try {
      execLocal(ws, { command: probe.sql });
      failures.push(`${probe.regra}: o banco aceitou o dado inválido`);
    } catch (error) {
      if (!probe.erro.test(error.message)) {
        failures.push(`${probe.regra}: rejeitou por outro motivo (${error.message.slice(0, 120)})`);
      }
    }
  }
  if (failures.length) add("constraints", "falha", failures.join("; "));
  else {
    const n = PROBES.length;
    add("constraints", "ok", `${n}/${n} regras críticas continuam rejeitando dado inválido`);
  }
}

export function verifyDump(
  dumpPath,
  { keep = false, migrationsDir = path.join(root, "migrations") } = {}
) {
  const dump = path.resolve(dumpPath);
  if (!existsSync(dump)) throw new UsageError(`Arquivo não encontrado: ${dump}`);
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const result = () => ({ ok: !checks.some(check => check.status === "falha"), checks });

  const size = statSync(dump).size;
  if (size === 0) {
    add("arquivo", "falha", "dump vazio (0 bytes)");
    return result();
  }
  const sidecar = `${dump}.sha256`;
  if (existsSync(sidecar)) {
    if (readFileSync(sidecar, "utf8").trim().split(/\s+/)[0] !== sha256File(dump)) {
      add(
        "arquivo",
        "falha",
        "sha256 diferente do registrado em .sha256 (arquivo alterado ou corrompido)"
      );
      return result();
    }
    add("arquivo", "ok", `${formatBytes(size)}, sha256 confere`);
  } else {
    const nome = path.basename(sidecar);
    add(
      "arquivo",
      "aviso",
      `${formatBytes(size)}; sem ${nome}: integridade do arquivo em repouso não conferida`
    );
  }

  const ws = createWorkspace();
  try {
    try {
      restoreDump(ws, dump);
    } catch (error) {
      add("restauração", "falha", error.message);
      return result();
    }
    add("restauração", "ok", "restaurado em D1 local descartável");
    const applied = checkHistory(ws, migrationsDir, add);
    const sql = applied?.map(name => readFileSync(path.join(migrationsDir, name), "utf8"));
    const structure = checkStructure(ws, sql ? schemaMarkers(sql.join("\n")) : null, add);
    if (structure) checkTables(ws, structure, add);
    checkConstraints(ws, add);
  } finally {
    if (keep) console.log(`D1 restaurado mantido em ${ws.dir}`);
    else removeWorkspace(ws);
  }
  return result();
}
