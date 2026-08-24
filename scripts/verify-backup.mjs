import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DATABASE_NAME = "rp-doces-db";
const backupDirectory = path.resolve(process.cwd(), ".private-backups");
const wrangler = path.resolve(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
let persistence;

class ValidationError extends Error {}

function cancel(message) {
  throw new ValidationError(message);
}

function selectedBackup() {
  const fileFlag = process.argv.indexOf("--file");
  if (fileFlag !== -1 && !process.argv[fileFlag + 1]) {
    cancel("informe um arquivo depois de --file.");
  }

  if (fileFlag !== -1) return path.resolve(process.cwd(), process.argv[fileFlag + 1]);
  if (!existsSync(backupDirectory)) cancel("a pasta .private-backups não existe.");

  const backups = readdirSync(backupDirectory)
    .filter(name => name.startsWith("rp-doces-production-") && name.endsWith(".sql"))
    .map(name => path.join(backupDirectory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (!backups.length) cancel("nenhum backup de produção foi encontrado.");
  return backups[0];
}

function runWrangler(args, capture = false) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: path.join(persistence, "wrangler.log")
    }
  });

  if (result.error) cancel(`não foi possível executar o Wrangler: ${result.error.message}`);
  if (result.status !== 0) {
    if (capture && result.stdout) console.error(result.stdout.trim());
    if (capture && result.stderr) console.error(result.stderr.trim());
    cancel("o backup não pôde ser restaurado ou validado.");
  }
  return String(result.stdout || "");
}

const temporaryRoot = path.resolve(os.tmpdir());

try {
  if (process.argv.includes("--remote")) {
    cancel("--remote é proibido neste verificador; somente D1 local é permitido.");
  }
  if (!existsSync(wrangler)) cancel("Wrangler local não encontrado. Execute npm install.");

  const backup = selectedBackup();
  if (!existsSync(backup) || path.extname(backup).toLowerCase() !== ".sql") {
    cancel("o arquivo selecionado não existe ou não é SQL.");
  }

  persistence = mkdtempSync(path.join(temporaryRoot, "rp-doces-backup-verify-"));
  console.log(`Backup: ${path.basename(backup)}`);
  console.log("Restaurando em um D1 local temporário e isolado...");

  const localArgs = [DATABASE_NAME, "--local", "--persist-to", persistence];
  runWrangler(["d1", "execute", ...localArgs, "--file", backup, "--yes"], true);

  const validationSql = [
    "SELECT COUNT(*) AS schema_tables FROM sqlite_master WHERE type = 'table' AND name IN ('produtos','pedidos','pedido_itens','usuarios_admin','admin_passkeys','d1_migrations')",
    "SELECT COUNT(*) AS produtos FROM produtos",
    "SELECT COUNT(*) AS pedidos FROM pedidos",
    "SELECT COUNT(*) AS pedido_itens FROM pedido_itens",
    "SELECT COUNT(*) AS usuarios_admin FROM usuarios_admin",
    "SELECT COUNT(*) AS admin_passkeys FROM admin_passkeys",
    "SELECT COUNT(*) AS migrations FROM d1_migrations",
    "SELECT COUNT(*) AS migration_017 FROM d1_migrations WHERE name = '017_passkey_login_sem_usuario.sql'",
    `SELECT
      (SELECT COUNT(*) FROM pedido_itens item LEFT JOIN pedidos pedido ON pedido.id = item.pedido_id WHERE pedido.id IS NULL) +
      (SELECT COUNT(*) FROM pedido_itens item LEFT JOIN produtos produto ON produto.id = item.produto_id WHERE item.produto_id IS NOT NULL AND produto.id IS NULL) +
      (SELECT COUNT(*) FROM admin_passkeys passkey LEFT JOIN usuarios_admin usuario ON usuario.id = passkey.usuario_id WHERE usuario.id IS NULL)
      AS foreign_key_problems`
  ].join(";");

  const output = runWrangler(
    ["d1", "execute", ...localArgs, "--command", validationSql, "--json"],
    true
  );
  const results = JSON.parse(output);
  const schemaTables = results[0]?.results?.[0]?.schema_tables;
  const migration017 = results[7]?.results?.[0]?.migration_017;
  const foreignKeyProblems = results[8]?.results?.[0]?.foreign_key_problems;

  if (schemaTables !== 6) cancel("uma ou mais tabelas críticas estão ausentes.");
  if (migration017 !== 1) cancel("a migration 017 não está registrada no backup.");
  if (foreignKeyProblems !== 0) cancel("foram encontradas referências inválidas.");

  const counts = results.slice(1, 7).map(entry => entry.results?.[0] || {});
  console.log("Estrutura e integridade aprovadas:");
  for (const count of counts) {
    const [table, total] = Object.entries(count)[0] || [];
    console.log(`- ${table}: ${total}`);
  }
  console.log("Backup restaurável. Nenhum banco remoto foi acessado.");
} catch (error) {
  const prefix = error instanceof ValidationError ? "Validação cancelada" : "Validação falhou";
  console.error(`\n${prefix}: ${error.message}`);
  process.exitCode = 1;
} finally {
  const resolvedPersistence = persistence && path.resolve(persistence);
  if (
    resolvedPersistence &&
    resolvedPersistence.startsWith(`${temporaryRoot}${path.sep}`) &&
    path.basename(resolvedPersistence).startsWith("rp-doces-backup-verify-")
  ) {
    rmSync(resolvedPersistence, { recursive: true, force: true });
  }
}
