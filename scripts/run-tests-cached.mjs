import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const clearCache = args.includes("--clear-cache");
const force = args.includes("--force");

const cacheDir = path.join(rootDir, ".test-cache");

if (clearCache) {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
    console.log("Cache cleared: .test-cache/ removed.");
  } else {
    console.log("Cache already clean.");
  }
  process.exit(0);
}

const DIRS_TO_HASH = [
  "functions",
  "src",
  "shared",
  "tests",
  "scripts",
  "migrations",
  "seed",
  "public",
];

const FILES_TO_HASH = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "wrangler.toml",
  "index.html",
];

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".wrangler",
  ".test-cache",
  ".qoder",
]);

function collectFiles(relDir) {
  const fullDir = path.join(rootDir, relDir);
  if (!existsSync(fullDir)) return [];
  const entries = readdirSync(fullDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const childRel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(childRel));
    } else if (entry.isFile()) {
      results.push(childRel.replace(/\\/g, "/"));
    }
  }
  return results;
}

function computeGlobalFingerprint() {
  const filesSet = new Set();

  for (const dir of DIRS_TO_HASH) {
    for (const file of collectFiles(dir)) {
      filesSet.add(file);
    }
  }

  for (const file of FILES_TO_HASH) {
    const fullPath = path.join(rootDir, file);
    if (existsSync(fullPath)) {
      filesSet.add(file.replace(/\\/g, "/"));
    }
  }

  const sortedFiles = Array.from(filesSet).sort();

  const hash = createHash("sha256");
  hash.update(`node:${process.version}\n`);
  hash.update(`platform:${process.platform}\n`);
  hash.update(`arch:${process.arch}\n`);

  for (const relPath of sortedFiles) {
    hash.update(`file:${relPath}\n`);
    const content = readFileSync(path.join(rootDir, relPath));
    hash.update(content);
    hash.update("\n");
  }

  return hash.digest("hex");
}

function parseTestLog(logText) {
  const testsMatch = logText.match(/ℹ\s+tests\s+(\d+)/);
  const passMatch = logText.match(/ℹ\s+pass\s+(\d+)/);
  const failMatch = logText.match(/ℹ\s+fail\s+(\d+)/);
  const durationMatch = logText.match(/ℹ\s+duration_ms\s+([\d.]+)/);

  return {
    tests: testsMatch ? parseInt(testsMatch[1], 10) : null,
    pass: passMatch ? parseInt(passMatch[1], 10) : null,
    fail: failMatch ? parseInt(failMatch[1], 10) : null,
    duration_ms: durationMatch ? parseFloat(durationMatch[1]) : null,
  };
}

const fingerprint = computeGlobalFingerprint();
const fingerprintDir = path.join(cacheDir, fingerprint);
const logsDir = path.join(fingerprintDir, "logs");
const resultsJsonPath = path.join(fingerprintDir, "results.json");

let cacheData = {
  fingerprint,
  createdAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  suites: {},
};

if (!force && existsSync(resultsJsonPath)) {
  try {
    cacheData = JSON.parse(readFileSync(resultsJsonPath, "utf-8"));
  } catch {
    // Mantém objeto vazio caso o arquivo esteja corrompido
  }
}

const testsDir = path.join(rootDir, "tests");
const testFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

mkdirSync(logsDir, { recursive: true });

let executedCount = 0;
let cachedCount = 0;
let suitePassCount = 0;
let suiteFailCount = 0;
let totalTestsPass = 0;
let totalTestsFail = 0;
const failingSuites = [];

for (const suite of testFiles) {
  const suiteLogName = suite.replace(/\.mjs$/, ".log");
  const logFilePath = path.join(logsDir, suiteLogName);
  const cached = cacheData.suites?.[suite];

  const isCacheHit =
    !force && cached?.status === "PASS" && existsSync(logFilePath);

  if (isCacheHit) {
    cachedCount++;
    suitePassCount++;
    totalTestsPass += cached.pass ?? cached.tests ?? 1;
    console.log(`[CACHE] ${suite}`);
    continue;
  }

  executedCount++;
  console.log(`[MISS] ${suite}`);

  const suitePath = path.join(testsDir, suite);
  const logFd = openSync(logFilePath, "w");
  const start = Date.now();

  const result = spawnSync(process.execPath, ["--test", suitePath], {
    cwd: rootDir,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });

  closeSync(logFd);
  const durationMs = Date.now() - start;

  const logContent = existsSync(logFilePath)
    ? readFileSync(logFilePath, "utf-8")
    : "";
  const parsed = parseTestLog(logContent);

  const isSuccess = result.status === 0;

  if (isSuccess) {
    suitePassCount++;
    const pCount = parsed.pass ?? parsed.tests ?? 1;
    totalTestsPass += pCount;

    cacheData.suites[suite] = {
      status: "PASS",
      tests: parsed.tests ?? pCount,
      pass: pCount,
      fail: 0,
      duration_ms: parsed.duration_ms ?? durationMs,
      timestamp: new Date().toISOString(),
      logPath: path.relative(rootDir, logFilePath).replace(/\\/g, "/"),
    };

    console.log(`[PASS] ${suite}`);
  } else {
    suiteFailCount++;
    const fCount = parsed.fail ?? 1;
    const pCount = parsed.pass ?? 0;
    totalTestsFail += fCount;
    totalTestsPass += pCount;

    const relLog = path.relative(rootDir, logFilePath).replace(/\\/g, "/");
    failingSuites.push({ suite, log: relLog });

    cacheData.suites[suite] = {
      status: "FAIL",
      tests: parsed.tests ?? pCount + fCount,
      pass: pCount,
      fail: fCount,
      duration_ms: parsed.duration_ms ?? durationMs,
      timestamp: new Date().toISOString(),
      logPath: relLog,
    };

    console.log(`[FAIL] ${suite} -> ${relLog}`);
  }

  writeFileSync(resultsJsonPath, JSON.stringify(cacheData, null, 2), "utf-8");
}

console.log("\n=== TEST SUMMARY ===\n");
console.log(`Fingerprint: ${fingerprint}`);
console.log(`Suites: ${testFiles.length}`);
console.log(`Executed: ${executedCount}`);
console.log(`Cached: ${cachedCount}`);
console.log(`PASS: ${suitePassCount}`);
console.log(`FAIL: ${suiteFailCount}`);
console.log("\nTests conhecidos:");
console.log(`PASS: ${totalTestsPass}`);
console.log(`FAIL: ${totalTestsFail}`);

if (failingSuites.length > 0) {
  console.log("\nSuites com falha:");
  for (const item of failingSuites) {
    console.log(`- ${item.suite}`);
    console.log(`  log: ${item.log}`);
  }
}

process.exit(suiteFailCount > 0 ? 1 : 0);
