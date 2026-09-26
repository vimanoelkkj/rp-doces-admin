import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
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

// Marcas de tempo para correlacionar o log do GitHub (carimbado quando o
// RUNNER processa a linha) com o que o processo Node fez de fato: instante
// UTC + relógio monotônico desde o início do script.
const scriptStart = process.hrtime.bigint();
const utc = () => new Date().toISOString();
const monotonic = () => (Number(process.hrtime.bigint() - scriptStart) / 1e9).toFixed(1);

// Saída dos testes -> log do CI. Testes que importam o bundle por
// `data:text/javascript;base64,...` sem `//# sourceURL` fazem TODO frame de
// stack trace carregar o bundle inteiro (~1,5 MB por linha). O GitHub Actions
// leva ~70 s para processar cada uma dessas linhas: na execução #3 do CI, 21
// linhas (33 MB) seguraram o passo por ~25 min, embora o Node tivesse
// terminado em 187 s. Aqui as linhas são reduzidas antes de chegar ao log;
// mensagem e posição (arquivo:linha:coluna) de cada frame continuam visíveis.
const MAX_LINE_LENGTH = 4000;
const DATA_URL = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g;

function sanitizeLine(line) {
  let out = line.replace(DATA_URL, (match) => `data:<bundle base64 omitido: ${match.length} caracteres>`);
  if (out.length > MAX_LINE_LENGTH) {
    out = `${out.slice(0, MAX_LINE_LENGTH)} ...[linha truncada: ${out.length} caracteres]`;
  }
  return out;
}

function forwardLines(stream, target) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      target.write(`${sanitizeLine(pending.slice(0, newline))}\n`);
      pending = pending.slice(newline + 1);
    }
  });
  stream.on("end", () => {
    if (pending) target.write(sanitizeLine(pending));
  });
}

// Roda um arquivo de teste isolado; resolve só depois que todas as linhas de
// stdout/stderr foram repassadas (evento "close"), então `[tempo]` nunca
// aparece antes da saída do próprio arquivo.
function runTestFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", file], {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
    });
    forwardLines(child.stdout, process.stdout);
    forwardLines(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status }));
  });
}

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

console.log(`[tempo] script iniciado ${utc()}`);
process.on("exit", (code) => console.log(`[tempo] processo Node encerrando ${utc()} (código ${code})`));

for (const file of selected) {
  const started = process.hrtime.bigint();
  const startedAt = utc();
  const result = await runTestFile(file);
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;

  const ok = result.status === 0;
  results.push({ file: rel(file), seconds, ok });
  console.log(
    `[tempo] ${rel(file)} ${seconds.toFixed(1)}s ${ok ? "ok" : "FALHOU"} (${startedAt} -> ${utc()})`,
  );

  if (!ok && !keepGoing) {
    process.exit(result.status ?? 1);
  }
}

// Resumo de tempos (mais lentos primeiro), também no resumo do job do GitHub.
console.log(`[tempo] gerando resumo ${utc()} (monotônico ${monotonic()}s)`);
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

// Se o passo do CI durar bem mais que isto, o tempo foi gasto FORA do script
// (fila de log do runner, npm, shell): compare com o carimbo do próprio GitHub.
console.log(`[tempo] fim do script ${utc()} (monotônico ${monotonic()}s desde o início)`);

if (failed.length) {
  console.error(`\nArquivos com falha:\n${failed.map((r) => `  - ${r.file}`).join("\n")}`);
  process.exit(1);
}
