import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  return { status: result.status, output: String(result.stdout || "").trim() };
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

assertCleanTree();

console.log("Branch main confirmada. Executando testes...");
const tests = run("npm", ["test"]);
if (tests.status !== 0) cancel("Deploy cancelado: os testes falharam.");

const adminV2Dir = path.join(process.cwd(), "admin-v2");
const adminV2Modules = path.join(adminV2Dir, "node_modules");
if (!existsSync(adminV2Modules)) {
  cancel(
    "Deploy cancelado: dependências do Admin V2 não encontradas.",
    "Execute npm install dentro de admin-v2 antes de publicar."
  );
}

console.log("Executando testes do Admin V2...");
const adminV2Tests = run("npm", ["test"], { cwd: adminV2Dir });
if (adminV2Tests.status !== 0) cancel("Deploy cancelado: os testes do Admin V2 falharam.");

console.log("Gerando bundle de produção do Admin V2...");
const adminV2Build = run("npm", ["run", "build"], { cwd: adminV2Dir });
if (adminV2Build.status !== 0) cancel("Deploy cancelado: o build do Admin V2 falhou.");

// Impede que testes ou hooks deixem artefatos versionados não commitados antes da publicação.
// O bundle gerado em public/admin-v2 é ignorado pelo Git e é publicado pelo Wrangler logo abaixo.
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
