// Operações do Wrangler sobre um D1 LOCAL e descartável. Usado por d1-backup.mjs e pelos testes.
//
// Nada aqui alcança produção: todo comando roda com --local, --remote/--preview são recusados e as
// credenciais da Cloudflare são removidas do ambiente do processo filho.
//
// Compatível com wrangler 3.114.x (versão do lockfile): `d1 export` não tem --persist-to, então o estado
// local é sempre <pasta do wrangler.toml>/.wrangler/state (o mesmo caminho que `wrangler pages dev` usa).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

// Erro de uso ou de ambiente (a CLI sai com código 2).
export class UsageError extends Error {}

// ID falso de propósito: nos bancos descartáveis ele só dá nome ao arquivo local e não aponta para nada real.
const FAKE_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function databaseName() {
  const toml = readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const block = toml.split("[[d1_databases]]")[1]?.split(/\n\[/)[0] ?? "";
  return block.match(/database_name\s*=\s*"([^"]+)"/)?.[1] ?? "rp-doces-db";
}

export function runWrangler(args, { cwd }) {
  if (args.some(arg => /^--(remote|preview)\b/.test(arg))) {
    throw new Error("Recusado: só D1 local é permitido (--remote e --preview não são aceitos).");
  }
  if (args[0] === "d1" && !args.includes("--local")) {
    throw new Error("Recusado: comando d1 sem --local.");
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(CLOUDFLARE_|CF_)/i.test(name))
  );
  Object.assign(env, { WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" });
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    timeout: 10 * 60 * 1000
  });
  if (result.error) throw result.error;
  return result;
}

export function workspaceAt(dir) {
  return {
    dir,
    name: databaseName(),
    config: path.join(dir, "wrangler.toml"),
    state: path.join(dir, ".wrangler", "state")
  };
}

// Pasta de trabalho com um wrangler.toml mínimo (só o binding do D1, com ID falso).
export function createWorkspace({ dir, migrationsDir } = {}) {
  const target = dir ?? mkdtempSync(path.join(tmpdir(), "rp-doces-d1-"));
  const ws = workspaceAt(target);
  const lines = [
    'name = "rp-doces-d1-local"',
    'compatibility_date = "2024-09-23"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${ws.name}"`,
    `database_id = "${FAKE_DATABASE_ID}"`
  ];
  if (migrationsDir) lines.push(`migrations_dir = "${migrationsDir.replace(/\\/g, "/")}"`);
  writeFileSync(ws.config, `${lines.join("\n")}\n`);
  return ws;
}

export function removeWorkspace(ws) {
  rmSync(ws.dir, { recursive: true, force: true, maxRetries: 3 });
}

export function hasLocalDatabase(ws) {
  const dir = path.join(ws.state, "v3", "d1", "miniflare-D1DatabaseObject");
  return existsSync(dir) && readdirSync(dir).some(file => file.endsWith(".sqlite"));
}

// Executa --file ou --command no D1 local. Devolve uma lista de linhas por instrução; lança o texto do
// erro do SQLite (ex.: "CHECK constraint failed: ...") se qualquer instrução falhar.
export function execLocal(ws, { file, command }) {
  const target = file ? ["--file", file] : ["--command", command];
  const result = runWrangler(
    [
      "d1",
      "execute",
      ws.name,
      "--local",
      "--persist-to",
      ws.state,
      "-c",
      ws.config,
      "--json",
      ...target
    ],
    { cwd: ws.dir }
  );
  let body = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    // saída não-JSON: tratada abaixo
  }
  if (result.status !== 0 || body?.error || !Array.isArray(body)) {
    const detail = body?.error?.text ?? (result.stderr || result.stdout).trim().slice(0, 500);
    throw new Error(detail || `wrangler terminou com status ${result.status}`);
  }
  return body.map(item => item.results ?? []);
}

export function exportLocal(ws, output) {
  const result = runWrangler(
    ["d1", "export", ws.name, "--local", "-c", ws.config, "--output", output],
    {
      cwd: ws.dir
    }
  );
  if (result.status !== 0) {
    throw new Error(`d1 export falhou: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  }
}

// O export do Wrangler lista as tabelas na ordem de criação do banco. Uma tabela recriada por migration
// (rebuild) fica DEPOIS das que a referenciam, e o INSERT de uma tabela filha falha com "no such table".
// Aqui todos os CREATE TABLE sobem para o topo (mantendo a ordem relativa); o resto segue como veio.
export function normalizeDump(sql) {
  const blocks = [];
  for (const line of sql.split("\n")) {
    if (/^(CREATE|INSERT|DELETE|PRAGMA)\b/i.test(line) || blocks.length === 0) blocks.push([line]);
    else blocks.at(-1).push(line);
  }
  const text = block => block.join("\n").trimEnd();
  const isTable = block => /^CREATE\s+TABLE\b/i.test(block[0]);
  const isPragma = block => /^PRAGMA\b/i.test(block[0]);
  const tables = blocks.filter(isTable);
  for (const block of tables) {
    if (!text(block).endsWith(";")) {
      throw new Error(`Dump inesperado: CREATE TABLE sem ";" final (${block[0].slice(0, 60)}).`);
    }
  }
  const ordered = [
    ...blocks.filter(isPragma),
    ...tables,
    ...blocks.filter(block => !isTable(block) && !isPragma(block))
  ];
  return `${ordered.map(text).join("\n")}\n`;
}

// No Windows, os arquivos do SQLite do D1 local têm nome de 64 caracteres (hash): em pasta funda o caminho
// passa de 259 caracteres (MAX_PATH) e o Wrangler só diz "internal error", sem apontar o motivo.
function assertPathFits(ws) {
  if (process.platform !== "win32") return;
  const hash = "0".repeat(64);
  const deepest = path.join(
    ws.state,
    "v3",
    "d1",
    "miniflare-D1DatabaseObject",
    `${hash}.sqlite-journal`
  );
  if (deepest.length > 259) {
    throw new UsageError(
      `Caminho longo demais para o Windows (${deepest.length} caracteres no arquivo mais fundo do D1 local; o limite é 259). Use uma pasta mais curta, por exemplo C:\\tmp\\d1.`
    );
  }
}

// O dump usa PRAGMA defer_foreign_keys: a violação de chave estrangeira só estoura no commit, e o Wrangler 4
// devolve esse erro apenas como "internal error; reference = ...". Este SELECT, no fim do script e ainda dentro
// da transação, falha com "integer overflow" se o foreign_key_check achar violação (o D1 local não autoriza
// tabela TEMP, e RAISE só existe em trigger): a prova vem do foreign_key_check, não do texto da CLI. Nenhuma
// outra instrução estoura assim: o dump só tem literais.
const FOREIGN_KEY_GUARD =
  "SELECT abs(-9223372036854775808) WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);";

// Restaura o dump (normalizado) num D1 local que ainda não existe na pasta de trabalho.
export function restoreDump(ws, dumpPath) {
  if (hasLocalDatabase(ws)) throw new UsageError(`Já existe D1 local em ${ws.state}.`);
  assertPathFits(ws);
  const tmp = mkdtempSync(path.join(tmpdir(), "rp-doces-restore-"));
  try {
    const file = path.join(tmp, "restore.sql");
    writeFileSync(file, `${normalizeDump(readFileSync(dumpPath, "utf8"))}${FOREIGN_KEY_GUARD}\n`);
    execLocal(ws, { file });
  } catch (error) {
    // Falha no meio da importação: não deixa um D1 pela metade (a pasta não tinha banco antes).
    rmSync(path.join(ws.state, "v3", "d1"), { recursive: true, force: true });
    throw /integer overflow/.test(error.message)
      ? new Error(
          "FOREIGN KEY constraint failed: o dump deixa linhas sem a linha-pai (foreign_key_check antes do commit)."
        )
      : error;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
