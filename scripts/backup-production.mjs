import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DATABASE_NAME = "rp-doces-db";
const CONFIRM_FLAG = "--confirm-production";
const CHECK_ONLY_FLAG = "--check-only";
const checkOnly = process.argv.includes(CHECK_ONLY_FLAG);

function cancel(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

if (!process.argv.includes(CONFIRM_FLAG)) {
  cancel(`Backup cancelado: confirme explicitamente o banco de produção com ${CONFIRM_FLAG}.`);
}

const wrangler = path.join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
if (!existsSync(wrangler)) {
  cancel("Backup cancelado: Wrangler local não encontrado. Execute npm install.");
}

const backupDirectory = path.join(process.cwd(), ".private-backups");
mkdirSync(backupDirectory, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const output = path.join(backupDirectory, `rp-doces-production-${timestamp}.sql`);

console.log(`Banco: ${DATABASE_NAME} (remoto/produção)`);
console.log(`Destino: ${output}`);

if (checkOnly) {
  console.log("Validação concluída. Nenhum acesso ao D1 foi realizado (--check-only).");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [wrangler, "d1", "export", DATABASE_NAME, "--remote", "--output", output],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit"
  }
);

if (result.error) {
  cancel(`Backup falhou: não foi possível executar o Wrangler. ${result.error.message}`);
}
if (result.status !== 0) {
  cancel("Backup de produção falhou. O banco não foi alterado.");
}

console.log(`Backup concluído: ${output}`);
