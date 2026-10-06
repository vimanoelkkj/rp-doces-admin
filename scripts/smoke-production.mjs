#!/usr/bin/env node
// Smoke test pós-deploy para R&P Doces (SOMENTE LEITURA).
//
// Valida que o ambiente de produção (ou preview) está funcional e consistente
// nos pontos essenciais sem executar qualquer mutação:
//   1. Frontend principal (HTML raiz com casca do SPA);
//   2. Asset estático principal (bundle JS ou CSS gerado no build);
//   3. Catálogo público (/api/produtos com estrutura válida);
//   4. Configurações da loja (/api/config com contrato válido);
//   5. Rota administrativa protegida (/api/admin/pedidos rejeita não autenticado com 401);
//   6. Rota inexistente (/api/... responde 404 sem erro interno);
//   7. Ausência de respostas 5xx em todos os endpoints read-only;
//   8. Ausência de stack traces ou segredos nas respostas.
//
// Variáveis de ambiente:
//   SMOKE_BASE_URL (ou PRODUCTION_URL, default: https://rpdoces.com.br)
//   SMOKE_TIMEOUT_MS (default: 10000)
//   SMOKE_RETRIES (default: 3)
//   SMOKE_RETRY_DELAY_MS (default: 2000)
//   GITHUB_STEP_SUMMARY (opcional: caminho para resumo do GitHub Actions)

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXIT = { OK: 0, FAIL: 1 };

const SENSITIVE_PATTERNS = [
  /\bBEGIN (?:RSA |EC )?PRIVATE KEY\b/i,
  /\bCLOUDFLARE_API_TOKEN\b/i,
  /\bCLOUDFLARE_ACCOUNT_ID\b/i,
  /\bVAPID_PRIVATE_KEY\b/i,
  /\bMP_ACCESS_TOKEN\b/i,
  /\bsenha_hash\b/i,
  /\btoken_hash\b/i,
  /\b(?:D1_ERROR|SQLITE_ERROR)\b/i,
  /\bat\s+(?:async\s+)?[a-zA-Z0-9_$.<>]+\s+\([^)]+:\d+:\d+\)/,
  /node_modules[\\/]/
];

export function detectLeaks(text) {
  if (typeof text !== "string") return [];
  const found = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      found.push(`Padrão proibido detectado: ${pattern.toString()}`);
    }
  }
  return found;
}

export function parseConfig(argv = [], env = process.env) {
  let urlFromArg = null;
  for (const arg of argv) {
    if (arg.startsWith("--url=")) urlFromArg = arg.slice(6);
    else if (arg.startsWith("--base-url=")) urlFromArg = arg.slice(11);
  }

  const rawBase =
    urlFromArg || env.SMOKE_BASE_URL || env.PRODUCTION_URL || "https://rpdoces.com.br";
  const baseUrl = rawBase.trim().replace(/\/+$/, "");

  const timeoutMs = Math.max(1000, Number(env.SMOKE_TIMEOUT_MS) || 10_000);
  const envRetries = env.SMOKE_RETRIES !== undefined ? Number(env.SMOKE_RETRIES) : 3;
  const retries = Math.max(0, Number.isFinite(envRetries) ? envRetries : 3);
  const retryDelayMs = Math.max(100, Number(env.SMOKE_RETRY_DELAY_MS) || 2_000);

  return { baseUrl, timeoutMs, retries, retryDelayMs };
}

async function fetchWithTimeout(url, { timeoutMs = 10_000, headers = {} } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "rp-doces-smoke-test/1.0",
      Accept: "*/*",
      ...headers
    },
    signal
  });
  const text = await res.text();
  return { res, text };
}

export async function checkFrontendHtml(baseUrl, { timeoutMs = 10_000 } = {}) {
  const url = `${baseUrl}/`;
  const { res, text } = await fetchWithTimeout(url, { timeoutMs });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  if (res.status !== 200) {
    return {
      ok: false,
      error: `Status HTTP inesperado: ${res.status} (esperado 200)`,
      status: res.status
    };
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return {
      ok: false,
      error: `Content-Type inesperado: "${contentType}" (esperado text/html)`,
      status: res.status
    };
  }

  if (
    !text.includes('<div id="root"') &&
    !text.includes("<!doctype html>") &&
    !text.includes("<html")
  ) {
    return {
      ok: false,
      error: "HTML raiz não contém marcadores essenciais do frontend SPA",
      status: res.status
    };
  }

  // Extrai o primeiro asset principal JS ou CSS referenciado no HTML
  const assetMatch = text.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/i);
  const assetPath = assetMatch ? assetMatch[1] : null;

  return { ok: true, status: res.status, assetPath };
}

export async function checkAsset(baseUrl, assetPath, { timeoutMs = 10_000 } = {}) {
  if (!assetPath) {
    return { ok: false, error: "Caminho do asset estático não fornecido", status: 0 };
  }

  const url = `${baseUrl}${assetPath.startsWith("/") ? "" : "/"}${assetPath}`;
  const { res, text } = await fetchWithTimeout(url, { timeoutMs });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  if (res.status !== 200) {
    return {
      ok: false,
      error: `Falha ao carregar asset "${assetPath}": HTTP ${res.status} (esperado 200)`,
      status: res.status
    };
  }

  if (text.length === 0) {
    return {
      ok: false,
      error: `Asset "${assetPath}" retornou conteúdo vazio`,
      status: res.status
    };
  }

  return { ok: true, status: res.status, bytes: text.length };
}

export async function checkPublicProducts(baseUrl, { timeoutMs = 10_000 } = {}) {
  const url = `${baseUrl}/api/produtos`;
  const { res, text } = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { Accept: "application/json" }
  });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  if (res.status !== 200) {
    return {
      ok: false,
      error: `Status HTTP inesperado em /api/produtos: ${res.status} (esperado 200)`,
      status: res.status
    };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "Resposta de /api/produtos não é um JSON válido",
      status: res.status
    };
  }

  if (!body || typeof body !== "object" || !Array.isArray(body.produtos)) {
    return {
      ok: false,
      error: "Contrato inválido em /api/produtos: chave 'produtos' deve ser um array",
      status: res.status
    };
  }

  if (body.produtos.length > 0) {
    const first = body.produtos[0];
    if (
      typeof first.id !== "number" ||
      typeof first.nome !== "string" ||
      typeof first.preco_centavos !== "number" ||
      typeof first.categoria !== "string"
    ) {
      return {
        ok: false,
        error:
          "Item do catálogo em /api/produtos não possui os campos essenciais esperados (id, nome, preco_centavos, categoria)",
        status: res.status
      };
    }
  }

  return { ok: true, status: res.status, count: body.produtos.length };
}

export async function checkPublicConfig(baseUrl, { timeoutMs = 10_000 } = {}) {
  const url = `${baseUrl}/api/config`;
  const { res, text } = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { Accept: "application/json" }
  });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  if (res.status !== 200) {
    return {
      ok: false,
      error: `Status HTTP inesperado em /api/config: ${res.status} (esperado 200)`,
      status: res.status
    };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "Resposta de /api/config não é um JSON válido",
      status: res.status
    };
  }

  if (!body || typeof body !== "object" || !body.config || typeof body.config !== "object") {
    return {
      ok: false,
      error: "Contrato inválido em /api/config: objeto 'config' ausente ou inválido",
      status: res.status
    };
  }

  const { config } = body;
  if (!Array.isArray(config.days) || config.days.length !== 7) {
    return {
      ok: false,
      error: "Contrato inválido em /api/config: 'days' deve ser um array com 7 dias",
      status: res.status
    };
  }

  if (
    typeof config.openTime !== "string" ||
    typeof config.closeTime !== "string" ||
    typeof config.localName !== "string" ||
    typeof config.whatsapp !== "string" ||
    typeof config.deliveryStatus !== "string"
  ) {
    return {
      ok: false,
      error:
        "Contrato inválido em /api/config: campos essenciais ausentes (openTime, closeTime, localName, whatsapp, deliveryStatus)",
      status: res.status
    };
  }

  return { ok: true, status: res.status, deliveryStatus: config.deliveryStatus };
}

export async function checkAdminProtection(baseUrl, { timeoutMs = 10_000 } = {}) {
  const url = `${baseUrl}/api/admin/pedidos`;
  const { res, text } = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { Accept: "application/json" }
  });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  // Rota administrativa sem cookie DEVE responder exatamente 401 Unauthorized
  if (res.status !== 401) {
    return {
      ok: false,
      error: `Falha de segurança: /api/admin/pedidos respondeu HTTP ${res.status} sem credencial (esperado 401)`,
      status: res.status
    };
  }

  return { ok: true, status: res.status };
}

export async function checkNotFoundEndpoint(baseUrl, { timeoutMs = 10_000 } = {}) {
  const url = `${baseUrl}/api/smoke-test-endpoint-inexistente-${Date.now()}`;
  const { res, text } = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { Accept: "application/json" }
  });

  const leaks = detectLeaks(text);
  if (leaks.length > 0) {
    return { ok: false, error: leaks.join("; "), status: res.status };
  }

  // Comportamento esperado em Cloudflare Pages:
  // - Ou responde HTTP 404 (caso exista regra/função de 404 específica);
  // - Ou responde HTTP 200 entregando o fallback da SPA (index.html), padrão da plataforma Pages
  //   quando não há match estático ou de Function.
  if (res.status === 404) {
    return { ok: true, status: 404, type: "not_found" };
  }

  if (res.status === 200) {
    const contentType = res.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");
    const hasAppShell =
      text.includes('<div id="root"') ||
      (text.includes("<html") && text.includes("<!doctype html>"));

    if (isHtml && hasAppShell) {
      return { ok: true, status: 200, type: "spa_fallback" };
    }

    return {
      ok: false,
      error: `Rota inexistente respondeu HTTP 200 com corpo não reconhecido como fallback SPA (Content-Type: "${contentType}")`,
      status: res.status
    };
  }

  return {
    ok: false,
    error: `Comportamento inesperado em rota inexistente: HTTP ${res.status} (esperado 404 ou 200 SPA fallback)`,
    status: res.status
  };
}

export async function runSmokeSuite(config) {
  const { baseUrl, timeoutMs } = config;
  const checks = [];

  // 1. Frontend principal HTML
  const htmlResult = await checkFrontendHtml(baseUrl, { timeoutMs });
  checks.push({
    name: "Frontend HTML raiz (/)",
    ...htmlResult
  });

  // 2. Asset estático
  if (htmlResult.ok && htmlResult.assetPath) {
    const assetResult = await checkAsset(baseUrl, htmlResult.assetPath, { timeoutMs });
    checks.push({
      name: `Asset principal (${htmlResult.assetPath})`,
      ...assetResult
    });
  } else if (htmlResult.ok) {
    checks.push({
      name: "Asset principal",
      ok: true,
      skipped: true,
      status: 200
    });
  }

  // 3. Catálogo público /api/produtos
  const productsResult = await checkPublicProducts(baseUrl, { timeoutMs });
  checks.push({
    name: "Catálogo público (/api/produtos)",
    ...productsResult
  });

  // 4. Configurações da loja /api/config
  const configResult = await checkPublicConfig(baseUrl, { timeoutMs });
  checks.push({
    name: "Configurações da loja (/api/config)",
    ...configResult
  });

  // 5. Proteção de rota admin /api/admin/pedidos
  const adminResult = await checkAdminProtection(baseUrl, { timeoutMs });
  checks.push({
    name: "Proteção admin não autenticado (/api/admin/pedidos -> 401)",
    ...adminResult
  });

  // 6. Rota inexistente (404 ou SPA fallback sem erro 5xx)
  const notFoundResult = await checkNotFoundEndpoint(baseUrl, { timeoutMs });
  checks.push({
    name: "Rota inexistente (/api/smoke-... -> 404 ou SPA fallback)",
    ...notFoundResult
  });

  const allPassed = checks.every(c => c.ok);
  return { ok: allPassed, checks };
}

export async function executeSmokeWithRetries(config, logger = console) {
  const { retries, retryDelayMs } = config;
  let attempt = 0;
  let lastReport = null;

  while (attempt <= retries) {
    attempt++;
    if (attempt > 1) {
      logger.log(
        `[smoke] Aguardando propagação (${retryDelayMs}ms antes da tentativa ${attempt}/${retries + 1})...`
      );
      await new Promise(r => setTimeout(r, retryDelayMs));
    }

    try {
      lastReport = await runSmokeSuite(config);
      if (lastReport.ok) {
        return { ok: true, attempt, report: lastReport };
      }
    } catch (err) {
      lastReport = {
        ok: false,
        checks: [{ name: "Execução geral", ok: false, error: err.message, status: 0 }]
      };
    }
  }

  return { ok: false, attempt, report: lastReport };
}

function writeSummary(markdownLines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${markdownLines.join("\n")}\n`, "utf8");
  } catch {
    // Falha de escrita de step summary não derruba o script
  }
}

export async function main() {
  const config = parseConfig(process.argv.slice(2));
  console.log(`[smoke] Iniciando smoke test pós-deploy em: ${config.baseUrl}`);
  const startTime = Date.now();

  const { ok, attempt, report } = await executeSmokeWithRetries(config);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  if (!ok) {
    console.error(
      `::error::Smoke test pós-deploy FALHOU em ${config.baseUrl} (${elapsedSec}s, ${attempt} tentativa(s)):`
    );
    const summaryLines = [
      "### ❌ Smoke test pós-deploy FALHOU",
      "",
      `URL: \`${config.baseUrl}\` | Tempo: ${elapsedSec}s | Tentativas: ${attempt}`,
      "",
      "| Teste | Status | Detalhes |",
      "| :--- | :---: | :--- |"
    ];

    for (const check of report.checks) {
      if (check.ok) {
        console.log(`[smoke] ✔ ${check.name} (HTTP ${check.status})`);
        summaryLines.push(`| ${check.name} | ✔ OK (${check.status}) | - |`);
      } else {
        console.error(`[smoke] ✖ ${check.name}: ${check.error || "falhou"}`);
        summaryLines.push(
          `| ${check.name} | ✖ FALHOU | ${check.error || "HTTP " + check.status} |`
        );
      }
    }

    writeSummary(summaryLines);
    return EXIT.FAIL;
  }

  console.log(`[smoke] Sucesso em ${elapsedSec}s (tentativa ${attempt}):`);
  const summaryLines = [
    "### ✔ Smoke test pós-deploy aprovado",
    "",
    `Ambiente: \`${config.baseUrl}\` | Tempo: ${elapsedSec}s`,
    "",
    "| Verificação | Status | Resultado |",
    "| :--- | :---: | :--- |"
  ];

  for (const check of report.checks) {
    const extra =
      check.count !== undefined
        ? `${check.count} produto(s)`
        : check.deliveryStatus !== undefined
          ? `delivery: ${check.deliveryStatus}`
          : check.bytes !== undefined
            ? `${check.bytes} bytes`
            : "OK";
    console.log(`[smoke] ✔ ${check.name} (${extra})`);
    summaryLines.push(`| ${check.name} | ✔ Aprovado (HTTP ${check.status}) | ${extra} |`);
  }

  console.log("[smoke] Sanitização: nenhuma resposta vazou segredos ou stack traces.");
  summaryLines.push("| Sanitização de segredos | ✔ Seguro | Sem vazamentos detectados |");

  writeSummary(summaryLines);
  return EXIT.OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}
