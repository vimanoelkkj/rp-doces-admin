import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CHECK_ONLY = process.argv.includes("--check-only");

function cancel(message, detail = "") {
  console.error(`\n${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) cancel(`Não foi possível executar ${command}.`, result.error.message);
  return result;
}

function gitOutput(args) {
  const result = run("git", args, { capture: true });
  // Não remover espaços do início: no porcelain do Git eles fazem parte dos
  // códigos XY (ex.: " M arquivo" para modificação no working tree).
  return { status: result.status, output: String(result.stdout || "").trimEnd() };
}

function isAndroidOnlyChange(line) {
  const porcelainPath = line.slice(3).trim().replaceAll("\\", "/");
  const effectivePath = porcelainPath.includes(" -> ")
    ? porcelainPath.split(" -> ").at(-1)
    : porcelainPath;
  return effectivePath?.startsWith("apps/android/") ?? false;
}

function assertCleanTree() {
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) cancel("Deploy cancelado: não foi possível verificar o working tree.");

  // O deploy publica apenas public/. Alterações locais do app Android não entram
  // no bundle do site e não devem bloquear uma publicação web.
  const webChanges = status.output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(line => !isAndroidOnlyChange(line));

  if (webChanges.length)
    cancel("Deploy cancelado: existem alterações locais não commitadas no site.", webChanges.join("\n"));
}

const branch = gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"]);
if (branch.status !== 0 || !branch.output) {
  cancel("Deploy cancelado: o Git está em detached HEAD.");
}
if (branch.output !== "main") {
  cancel("Deploy cancelado: você não está na branch main.", `Branch atual: ${branch.output}`);
}

// Remove o bundle gerado pelo antigo caminho /admin-v2 para não deixar lixo local
// após a consolidação do painel em /admin.
rmSync(path.join(process.cwd(), "public", "admin-v2"), { recursive: true, force: true });

assertCleanTree();

console.log("Branch main confirmada. Executando testes...");
const tests = run("npm", ["test"]);
if (tests.status !== 0) cancel("Deploy cancelado: os testes falharam.");

const adminDir = path.join(process.cwd(), "admin");
const adminModules = path.join(adminDir, "node_modules");
if (!existsSync(adminModules)) {
  cancel(
    "Deploy cancelado: dependências do Admin não encontradas.",
    "Execute npm install dentro de admin antes de publicar."
  );
}

console.log("Executando testes do Admin...");
const adminTests = run("npm", ["test"], { cwd: adminDir });
if (adminTests.status !== 0) cancel("Deploy cancelado: os testes do Admin falharam.");

console.log("Gerando bundle de produção do Admin...");
const adminBuild = run("npm", ["run", "build"], { cwd: adminDir });
if (adminBuild.status !== 0) cancel("Deploy cancelado: o build do Admin falhou.");

// Impede que testes ou hooks deixem artefatos versionados não commitados antes da publicação.
// O bundle gerado em public/admin é ignorado pelo Git e é publicado pelo Wrangler logo abaixo.
assertCleanTree();

if (CHECK_ONLY) {
  console.log("Validação de produção concluída. Nenhum deploy foi executado (--check-only).");
  process.exit(0);
}

const wranglerName = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const wrangler = path.join(process.cwd(), "node_modules", ".bin", wranglerName);
if (!existsSync(wrangler)) {
  cancel("Deploy cancelado: Wrangler local não encontrado. Execute npm install.");
}

console.log("Testes e build aprovados. Publicando explicitamente a branch main...");
const deploy = run(wrangler, [
  "pages",
  "deploy",
  "public",
  "--project-name=rp-doces",
  "--branch",
  "main"
]);
if (deploy.status !== 0) cancel("Deploy de produção falhou.");
