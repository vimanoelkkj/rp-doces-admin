import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const persistDir = path.join(root, ".tmp", "schema-full-d1");
const outputPath = path.join(root, "schema_full.sql");
const wranglerBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler"
);

function runWrangler(args, { input } = {}) {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : wranglerBin;
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", wranglerBin, ...args] : args;

  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.error) {
    console.error(`Falha ao iniciar Wrangler: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }

  return result.stdout;
}

rmSync(persistDir, { recursive: true, force: true });
mkdirSync(persistDir, { recursive: true });

console.log("Aplicando migrations em um D1 local isolado...");
const migrationOutput = runWrangler(
  [
    "d1",
    "migrations",
    "apply",
    "rp-doces-db",
    "--local",
    "--persist-to",
    persistDir
  ],
  { input: "y\n" }
);

if (migrationOutput.trim()) process.stdout.write(migrationOutput);

const query = `
SELECT "type" AS object_type, name, tbl_name, sql
FROM sqlite_master
WHERE sql IS NOT NULL
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND name <> 'd1_migrations'
ORDER BY
  CASE "type"
    WHEN 'table' THEN 0
    WHEN 'index' THEN 1
    WHEN 'trigger' THEN 2
    ELSE 3
  END,
  name;
`.trim();

console.log("Lendo sqlite_master do banco recém-migrado...");
const raw = runWrangler([
  "d1",
  "execute",
  "rp-doces-db",
  "--local",
  "--persist-to",
  persistDir,
  "--command",
  query,
  "--json"
]);

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("Não foi possível interpretar a saída JSON do Wrangler.");
  process.stderr.write(raw);
  process.exit(1);
}

const resultBlock = Array.isArray(parsed) ? parsed[0] : parsed;
const rows = resultBlock?.results || resultBlock?.result?.[0]?.results || [];

if (!rows.length) {
  console.error("Nenhum objeto de schema foi encontrado no sqlite_master.");
  process.exit(1);
}

const header = `-- AUTO-GERADO. NÃO EDITE MANUALMENTE.\n-- Fonte de verdade: migrations/*.sql\n-- Gere novamente com: npm run schema:generate\n-- Snapshot estrutural do D1 após aplicar todas as migrations atuais.\n\n`;

const body = rows
  .map(row => {
    const sql = String(row.sql || "").trim().replace(/;\s*$/, "");
    return `-- ${row.object_type}: ${row.name}\n${sql};`;
  })
  .join("\n\n");

writeFileSync(outputPath, `${header}${body}\n`, "utf8");

console.log(`Schema consolidado gerado em: ${path.relative(root, outputPath)}`);
console.log(`Objetos exportados: ${rows.length}`);
console.log("A pasta temporária fica em .tmp/ e pode ser removida a qualquer momento.");
