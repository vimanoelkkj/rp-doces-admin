import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Sem argumentos: comportamento original (todos os arquivos, em sequência,
// parando no primeiro que falhar). Opções, usadas pelo CI:
//   --shard=i/n         roda só a fatia i (1-based) de n — partição determinística
//   --keep-going        não para na primeira falha; reporta todas no final
//   --list              só lista os arquivos que seriam executados
//   --verify-shards=n   confere que as n fatias cobrem cada arquivo exatamente uma vez
// Os arquivos são descobertos por glob (tests/*.test.mjs): um teste novo entra
// sozinho na suíte e em alguma fatia, sem lista para manter.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testsDir = path.join(root, "tests");

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name) => args.includes(`--${name}`);

const files = readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join(testsDir, file));

const rel = (file) => path.relative(root, file).split(path.sep).join("/");

// Peso estimado só para equilibrar as fatias (nunca decide o que roda). O
// custo de um teste vem quase todo da bancada D1/Miniflare de tests/helpers;
// os de UI (JSDOM) são baratos. Arquivo novo ou fora do padrão pesa ao menos 1.
function weightOf(file) {
  const source = readFileSync(file, "utf8");
  const declared = (source.match(/\btest\(/g) ?? []).length;
  const usaBancadaD1 = /helpers\/b\d/.test(source);
  return Math.max(1, declared) * (usaBancadaD1 ? 1 : 0.3);
}

// Longest-processing-time: arquivos mais pesados primeiro, sempre na fatia
// mais leve. Determinístico, então cada arquivo cai em exatamente uma fatia.
function partition(allFiles, total) {
  const bins = Array.from({ length: total }, () => ({ weight: 0, files: [] }));
  const ordered = allFiles
    .map((file) => ({ file, weight: weightOf(file) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const { file, weight } of ordered) {
    const bin = bins.reduce((lightest, candidate) =>
      candidate.weight < lightest.weight ||
      (candidate.weight === lightest.weight && candidate.files.length < lightest.files.length)
        ? candidate
        : lightest);
    bin.weight += weight;
    bin.files.push(file);
  }
  return bins.map((bin) => ({ ...bin, files: bin.files.sort() }));
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Valor inválido para ${label}: ${value}`);
    process.exit(2);
  }
  return n;
}

// Testes que o runner NÃO enxerga (fora de tests/*.test.mjs) ficariam de fora
// da suíte em silêncio: a verificação falha se existirem.
function orphanTestFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.(mjs|cjs|js|ts|mts)$/.test(entry.name) && !files.includes(full)) found.push(full);
    }
  };
  walk(testsDir);
  return found;
}

const verifyTotal = option("verify-shards");
if (verifyTotal !== undefined) {
  const total = parsePositiveInt(verifyTotal, "--verify-shards");
  const bins = partition(files, total);
  const seen = bins.flatMap((bin) => bin.files);
  const problems = [];
  if (seen.length !== files.length) problems.push(`${seen.length} arquivos nas fatias, ${files.length} descobertos`);
  if (new Set(seen).size !== seen.length) problems.push("há arquivo repetido entre fatias");
  for (const file of files) if (!seen.includes(file)) problems.push(`fora de todas as fatias: ${rel(file)}`);
  for (const orphan of orphanTestFiles()) problems.push(`teste fora do runner (não seria executado): ${rel(orphan)}`);
  bins.forEach((bin, i) =>
    console.log(`fatia ${i + 1}/${total}: ${bin.files.length} arquivos, peso ${bin.weight.toFixed(1)}`));
  if (problems.length) {
    problems.forEach((p) => console.error(`ERRO: ${p}`));
    process.exit(1);
  }
  console.log(`OK: ${files.length} arquivos, cada um em exatamente uma das ${total} fatias.`);
  process.exit(0);
}

let selected = files;
let label = "";
const shard = option("shard");
if (shard !== undefined) {
  const [index, total] = shard.split("/").map((v) => parsePositiveInt(v, "--shard"));
  if (!total || index > total) {
    console.error(`--shard inválido: ${shard} (esperado i/n com 1 <= i <= n)`);
    process.exit(2);
  }
  selected = partition(files, total)[index - 1].files;
  label = `fatia ${index}/${total}`;
  console.log(`${label}: ${selected.length} de ${files.length} arquivos`);
}

if (flag("list")) {
  selected.forEach((file) => console.log(rel(file)));
  process.exit(0);
}

const keepGoing = flag("keep-going");
const results = [];

for (const file of selected) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, ["--test", file], {
    cwd: root,
    stdio: "inherit",
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;

  if (result.error) throw result.error;
  const ok = result.status === 0;
  results.push({ file: rel(file), seconds, ok });
  console.log(`[tempo] ${rel(file)} ${seconds.toFixed(1)}s ${ok ? "ok" : "FALHOU"}`);

  if (!ok && !keepGoing) {
    process.exit(result.status ?? 1);
  }
}

// Resumo de tempos (mais lentos primeiro), também no resumo do job do GitHub.
const total = results.reduce((sum, r) => sum + r.seconds, 0);
const failed = results.filter((r) => !r.ok);
const slowest = [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
console.log(`\nResumo${label ? ` (${label})` : ""}: ${results.length} arquivos em ${total.toFixed(0)}s, ${failed.length} com falha`);
slowest.forEach((r) => console.log(`  ${r.seconds.toFixed(1).padStart(7)}s  ${r.file}`));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Testes${label ? ` — ${label}` : ""}`,
    "",
    `${results.length} arquivos em ${total.toFixed(0)}s, ${failed.length} com falha.`,
    "",
    "| Arquivo | Tempo | Resultado |",
    "| --- | ---: | --- |",
    ...[...results]
      .sort((a, b) => b.seconds - a.seconds)
      .map((r) => `| ${r.file} | ${r.seconds.toFixed(1)}s | ${r.ok ? "ok" : "**FALHOU**"} |`),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

if (failed.length) {
  console.error(`\nArquivos com falha:\n${failed.map((r) => `  - ${r.file}`).join("\n")}`);
  process.exit(1);
}
