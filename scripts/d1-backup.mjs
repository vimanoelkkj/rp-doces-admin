// Backup e restore do D1 em ambiente LOCAL e descartável. Nunca toca o banco remoto de produção.
//
//   node scripts/d1-backup.mjs backup    [--dir <pasta>] [--out <arquivo.sql>] [--no-verify]
//   node scripts/d1-backup.mjs verify    <dump.sql> [--keep]
//   node scripts/d1-backup.mjs restore   <dump.sql> --dir <pasta>
//   node scripts/d1-backup.mjs normalize <dump.sql> --out <arquivo.sql>
//
// backup:    exporta o D1 LOCAL (padrão: o do repositório, o mesmo de `wrangler pages dev`), grava
//            <arquivo>.sha256 e roda `verify`, a menos que --no-verify.
// verify:    restaura o dump num D1 local descartável e confere integridade, migrations, schema,
//            sequências e constraints críticas (d1-verify.mjs). Também serve para dumps exportados do
//            D1 remoto (o export remoto é manual: ver docs/BACKUP-RESTORE.md).
// restore:   restaura o dump numa pasta sem D1 local (banco persistente, para inspeção).
// normalize: grava o SQL já normalizado (CREATE TABLE no topo) para importação manual em outro banco.
//
// Códigos de saída: 0 ok; 1 verificação ou operação falhou; 2 uso ou ambiente inválido.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  UsageError,
  createWorkspace,
  exportLocal,
  hasLocalDatabase,
  normalizeDump,
  restoreDump,
  root,
  sha256File,
  workspaceAt
} from "./d1-local.mjs";
import { formatBytes, verifyDump } from "./d1-verify.mjs";

const timestamp = () =>
  new Date().toISOString().replace(/\..*$/, "").replace(/[-:]/g, "").replace("T", "-");

export function backupLocal({ dir, out } = {}) {
  const ws = workspaceAt(path.resolve(dir ?? root));
  if (!hasLocalDatabase(ws)) {
    throw new UsageError(
      `Não há D1 local em ${ws.state}. Rode "npm run db:migrate:local" (ou aponte --dir para uma pasta com .wrangler/state).`
    );
  }
  const target = path.resolve(out ?? path.join(root, "backups", `d1-local-${timestamp()}.sql`));
  if (existsSync(target)) throw new UsageError(`Já existe: ${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  exportLocal(ws, target);
  if (statSync(target).size === 0) throw new Error("O export gerou um arquivo vazio (0 bytes).");
  writeFileSync(`${target}.sha256`, `${sha256File(target)}  ${path.basename(target)}\n`);
  return target;
}

export function restoreInto({ dump, dir }) {
  if (!dump || !existsSync(dump)) {
    throw new UsageError(`Dump não encontrado: ${dump ?? "(não informado)"}`);
  }
  if (!dir) throw new UsageError("Informe --dir <pasta>: ela recebe o D1 local restaurado.");
  const target = path.resolve(dir);
  mkdirSync(target, { recursive: true });
  const configured = existsSync(path.join(target, "wrangler.toml"));
  const ws = configured ? workspaceAt(target) : createWorkspace({ dir: target });
  restoreDump(ws, path.resolve(dump));
  return ws;
}

const TAG = { ok: "OK   ", falha: "FALHA", aviso: "AVISO", info: "INFO " };

function report(file, { ok, checks }, started) {
  console.log(`\nVerificação de ${file}`);
  for (const check of checks)
    console.log(`  ${TAG[check.status]} ${check.name.padEnd(13)} ${check.detail}`);
  console.log(
    `\nResultado: ${ok ? "OK" : "FALHOU"} (${((Date.now() - started) / 1000).toFixed(1)} s)`
  );
  return ok ? 0 : 1;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep" || arg === "--no-verify") flags[arg.slice(2)] = true;
    else if (arg === "--dir" || arg === "--out") flags[arg.slice(2)] = argv[++i];
    else if (arg.startsWith("--")) {
      throw new UsageError(`Opção desconhecida: ${arg} (este script só opera em D1 local).`);
    } else positional.push(arg);
  }
  return { flags, positional };
}

export function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const started = Date.now();
  switch (command) {
    case "backup": {
      const target = backupLocal({ dir: flags.dir, out: flags.out });
      console.log(`Backup criado: ${target} (${formatBytes(statSync(target).size)})`);
      console.log(`Checksum:      ${target}.sha256`);
      return flags["no-verify"] ? 0 : report(target, verifyDump(target), started);
    }
    case "verify": {
      if (!positional[0]) throw new UsageError("Informe o arquivo: verify <dump.sql>");
      return report(positional[0], verifyDump(positional[0], { keep: flags.keep }), started);
    }
    case "restore": {
      const ws = restoreInto({ dump: positional[0], dir: flags.dir });
      console.log(`D1 local restaurado em ${ws.state}`);
      console.log(
        `Consultar: npx wrangler d1 execute ${ws.name} --local --persist-to "${ws.state}" -c "${ws.config}" --command "SELECT COUNT(*) FROM pedidos"`
      );
      return 0;
    }
    case "normalize": {
      if (!positional[0] || !flags.out)
        throw new UsageError("Uso: normalize <dump.sql> --out <arquivo.sql>");
      writeFileSync(flags.out, normalizeDump(readFileSync(positional[0], "utf8")));
      console.log(`SQL normalizado gravado em ${flags.out}`);
      return 0;
    }
    default: {
      const header = readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(0, 16);
      console.log(header.map(line => line.replace(/^\/\/ ?/, "")).join("\n"));
      return command ? 2 : 0;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`${error instanceof UsageError ? "Uso inválido" : "Erro"}: ${error.message}`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
