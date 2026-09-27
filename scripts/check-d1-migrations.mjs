// Proteção de migrations D1 antes do deploy (SOMENTE LEITURA).
//
// Compara migrations/*.sql com a tabela d1_migrations do banco REMOTO e bloqueia
// a publicação se houver migration pendente, histórico inconsistente ou se a
// verificação não puder ser concluída. NUNCA aplica migrations: só executa
// SELECT pela API REST do Cloudflare (token com a permissão "D1 Read").
//
// Códigos de saída (qualquer valor != 0 bloqueia o deploy):
//   0  banco em dia e consistente
//   1  migration pendente ou histórico inconsistente (ação necessária)
//   2  autenticação/permissão/configuração (401, 403, 404, token ou ID ausente)
//   3  Cloudflare indisponível (rede, timeout, 5xx, 429) após as tentativas
//   4  resposta inesperada da API
//
// Ambiente: CLOUDFLARE_D1_READ_TOKEN (token dedicado, só "D1 Read"; o
// CLOUDFLARE_API_TOKEN do deploy do Pages NUNCA é usado aqui), CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID (opcional:
// lido do wrangler.toml). Só para testes: CF_API_BASE, MIGRATIONS_DIR,
// WRANGLER_TOML, MIGRATION_CHECK_RETRIES, MIGRATION_CHECK_DELAY_MS,
// MIGRATION_CHECK_TIMEOUT_MS.

import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const EXIT = { OK: 0, BLOCKED: 1, AUTH: 2, UNAVAILABLE: 3, BAD_RESPONSE: 4 };

export class CheckError extends Error {
  constructor(exitCode, message, details = []) {
    super(message);
    this.exitCode = exitCode;
    this.details = details;
  }
}

// Numeração atual (0001_...) e legada (001_..., de antes do rebaseline de
// 23/09/2026): o remoto guarda as duas, o repositório só a atual.
const CURRENT = /^\d{4}_.+\.sql$/;
const LEGACY = /^\d{3}_.+\.sql$/;

export function listLocalMigrations(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

// ---------- análise do histórico (pura, testável) ----------
export function analyze({ localNames, remoteRows }) {
  const local = new Set(localNames);
  const remoteNames = remoteRows.map(r => r.name);
  const remoteSet = new Set(remoteNames);

  const pending = localNames.filter(n => !remoteSet.has(n));
  const legacy = remoteNames.filter(n => LEGACY.test(n) && !local.has(n));
  const unknownCurrent = remoteNames.filter(n => CURRENT.test(n) && !local.has(n));
  const unrecognized = remoteNames.filter(
    n => !CURRENT.test(n) && !LEGACY.test(n) && !local.has(n)
  );

  const seen = new Set();
  const duplicates = [
    ...new Set(
      remoteNames.filter(n => {
        if (seen.has(n)) return true;
        seen.add(n);
        return false;
      })
    )
  ];

  // Lacuna: alguma migration anterior está pendente e uma posterior já foi aplicada.
  const applied = localNames.filter(n => remoteSet.has(n));
  const gaps = pending.filter(p => applied.some(a => a > p));

  // Ordem de aplicação: pelas ids, os nomes no formato atual devem crescer.
  const outOfOrder = [];
  const byId = remoteRows.filter(r => CURRENT.test(r.name)).sort((a, b) => a.id - b.id);
  for (let i = 1; i < byId.length; i++) {
    if (byId[i].name < byId[i - 1].name)
      outOfOrder.push(`${byId[i].name} aplicada depois de ${byId[i - 1].name}`);
  }

  return { pending, legacy, unknownCurrent, unrecognized, duplicates, gaps, outOfOrder, applied };
}

// ---------- marcadores de schema da migration mais recente ----------
// Só o NOME registrado não prova que o schema existe. Extrai do SQL o estado
// final esperado (tabelas/índices/triggers criados e colunas adicionadas),
// processando os comandos na ordem: DROP remove, RENAME move, CREATE adiciona.
export function schemaMarkers(sql) {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const id = "[\"'`\\[]?(\\w+)[\"'`\\]]?";
  const pattern = new RegExp(
    [
      `CREATE\\s+(?:UNIQUE\\s+)?(TABLE|INDEX|TRIGGER)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${id}`,
      `ALTER\\s+TABLE\\s+${id}\\s+ADD\\s+COLUMN\\s+${id}`,
      `ALTER\\s+TABLE\\s+${id}\\s+RENAME\\s+TO\\s+${id}`,
      `DROP\\s+(TABLE|INDEX|TRIGGER)\\s+(?:IF\\s+EXISTS\\s+)?${id}`
    ].join("|"),
    "gi"
  );
  const objects = new Map(); // "table:nome" -> {type, name}
  const columns = new Map(); // tabela -> Set(colunas)
  for (const m of text.matchAll(pattern)) {
    if (m[1]) {
      const type = m[1].toLowerCase();
      objects.set(`${type}:${m[2]}`, { type, name: m[2] });
    } else if (m[3]) {
      if (!columns.has(m[3])) columns.set(m[3], new Set());
      columns.get(m[3]).add(m[4]);
    } else if (m[5]) {
      objects.delete(`table:${m[5]}`);
      objects.set(`table:${m[6]}`, { type: "table", name: m[6] });
      if (columns.has(m[5])) {
        columns.set(m[6], columns.get(m[5]));
        columns.delete(m[5]);
      }
    } else if (m[7]) {
      const type = m[7].toLowerCase();
      objects.delete(`${type}:${m[8]}`);
      if (type === "table") columns.delete(m[8]);
    }
  }
  return {
    objects: [...objects.values()],
    columns: [...columns].map(([table, cols]) => ({ table, columns: [...cols] }))
  };
}

// ---------- acesso à API (somente SELECT) ----------
export function assertReadOnly(sql) {
  const body = sql.trim().replace(/;\s*$/, "");
  if (!/^SELECT\b/i.test(body) || body.includes(";")) {
    throw new Error(`Bug do verificador: só SELECT é permitido, recebido: ${sql.slice(0, 60)}`);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function makeClient({
  base,
  accountId,
  databaseId,
  token,
  retries = 3,
  delayMs = 2000,
  timeoutMs = 15000
}) {
  const url = `${base}/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function post(payload) {
    for (const stmt of payload.batch ?? [payload]) assertReadOnly(stmt.sql);
    let lastProblem = "";
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        });
        const text = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new CheckError(
            EXIT.AUTH,
            `Cloudflare recusou as credenciais (HTTP ${response.status}). Confira o secret CLOUDFLARE_D1_READ_TOKEN: precisa estar válido e ter a permissão Account > D1 > Read.`,
            apiErrors(text)
          );
        }
        if (response.status === 404) {
          throw new CheckError(
            EXIT.AUTH,
            "Banco D1 ou conta não encontrados (HTTP 404): confira CLOUDFLARE_ACCOUNT_ID e o database_id do wrangler.toml.",
            apiErrors(text)
          );
        }
        if (response.status === 429 || response.status >= 500) {
          lastProblem = `HTTP ${response.status}`;
        } else {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            throw new CheckError(
              EXIT.BAD_RESPONSE,
              `Resposta da API não é JSON (HTTP ${response.status}).`
            );
          }
          if (response.status >= 400 || json.success !== true) {
            const errors = Array.isArray(json.errors) ? json.errors : [];
            const message = errors.map(e => e.message).join("; ");
            if (/no such table/i.test(message))
              throw new CheckError(
                EXIT.BLOCKED,
                "A tabela d1_migrations não existe no banco remoto: nenhuma migration foi registrada.",
                errors.map(e => `código ${e.code}: ${e.message}`)
              );
            throw new CheckError(
              EXIT.BAD_RESPONSE,
              `API respondeu HTTP ${response.status} sem sucesso.`,
              errors.map(e => `código ${e.code}: ${e.message}`)
            );
          }
          if (!Array.isArray(json.result))
            throw new CheckError(EXIT.BAD_RESPONSE, "Resposta da API sem o campo result.");
          return json.result;
        }
      } catch (error) {
        if (error instanceof CheckError) throw error;
        lastProblem =
          error?.name === "TimeoutError"
            ? `tempo esgotado (${timeoutMs} ms)`
            : `falha de rede (${error?.cause?.code ?? error?.message ?? error})`;
      }
      if (attempt < retries) await sleep(delayMs * attempt);
    }
    throw new CheckError(
      EXIT.UNAVAILABLE,
      `Cloudflare indisponível após ${retries} tentativas (${lastProblem}). Sem confirmar as migrations, o deploy fica bloqueado.`
    );
  }

  return {
    // Uma instrução -> linhas.
    async select(sql, params = []) {
      const result = await post({ sql, params });
      const first = result[0];
      if (!first || first.success === false || !Array.isArray(first.results))
        throw new CheckError(EXIT.BAD_RESPONSE, "Resultado da consulta com formato inesperado.");
      return first.results;
    },
    // Várias instruções -> lista de listas de linhas.
    async batch(statements) {
      const result = await post({ batch: statements });
      if (
        result.length !== statements.length ||
        result.some(r => r.success === false || !Array.isArray(r.results))
      ) {
        throw new CheckError(EXIT.BAD_RESPONSE, "Resultado do lote com formato inesperado.");
      }
      return result.map(r => r.results);
    }
  };
}

function apiErrors(text) {
  try {
    return (JSON.parse(text).errors ?? []).map(e => `código ${e.code}: ${e.message}`);
  } catch {
    return [];
  }
}

// ---------- verificação completa ----------
export async function checkMigrations({ client, migrationsDir }) {
  const localNames = listLocalMigrations(migrationsDir);
  if (localNames.length === 0)
    throw new CheckError(
      EXIT.BLOCKED,
      `Nenhuma migration em ${migrationsDir}: verificação impossível.`
    );

  const rows = await client.select("SELECT id, name, applied_at FROM d1_migrations ORDER BY id");
  if (!rows.every(r => Number.isInteger(r.id) && typeof r.name === "string")) {
    throw new CheckError(EXIT.BAD_RESPONSE, "Linhas de d1_migrations com formato inesperado.");
  }
  const report = analyze({ localNames, remoteRows: rows });
  const problems = [];

  if (report.pending.length) {
    problems.push(
      `Migrations PENDENTES no banco de produção (${report.pending.length}): ${report.pending.join(", ")}. Aplique-as ANTES do deploy: npx wrangler d1 migrations apply rp-doces-db --remote`
    );
  }
  if (report.gaps.length)
    problems.push(
      `Histórico com lacuna: ${report.gaps.join(", ")} está pendente, mas migrations posteriores já foram aplicadas.`
    );
  if (report.unknownCurrent.length)
    problems.push(
      `O banco remoto tem migrations que não existem neste commit: ${report.unknownCurrent.join(", ")}. Este commit está desatualizado em relação a produção (ou o SQL foi aplicado fora do repositório).`
    );
  if (report.unrecognized.length)
    problems.push(
      `Nomes de migration fora do padrão no banco remoto: ${report.unrecognized.join(", ")}.`
    );
  if (report.duplicates.length)
    problems.push(`Migrations registradas mais de uma vez: ${report.duplicates.join(", ")}.`);
  if (report.outOfOrder.length)
    problems.push(`Migrations aplicadas fora de ordem: ${report.outOfOrder.join("; ")}.`);

  // Schema: a migration mais recente, se registrada como aplicada, precisa ter deixado seus objetos.
  const latest = localNames[localNames.length - 1];
  let schemaChecked = false;
  if (report.applied.includes(latest)) {
    const markers = schemaMarkers(readFileSync(path.join(migrationsDir, latest), "utf8"));
    const statements = [];
    for (let i = 0; i < markers.objects.length; i += 90) {
      const chunk = markers.objects.slice(i, i + 90);
      statements.push({
        kind: "objects",
        chunk,
        sql: `SELECT type, name FROM sqlite_master WHERE name IN (${chunk.map(() => "?").join(",")})`,
        params: chunk.map(o => o.name)
      });
    }
    for (const c of markers.columns) {
      statements.push({
        kind: "columns",
        table: c.table,
        columns: c.columns,
        sql: "SELECT name FROM pragma_table_info(?)",
        params: [c.table]
      });
    }
    if (statements.length) {
      schemaChecked = true;
      const results = await client.batch(statements.map(({ sql, params }) => ({ sql, params })));
      const missing = [];
      statements.forEach((s, i) => {
        if (s.kind === "objects") {
          const found = new Set(results[i].map(r => `${r.type}:${r.name}`));
          for (const o of s.chunk)
            if (!found.has(`${o.type}:${o.name}`)) missing.push(`${o.type} ${o.name}`);
        } else {
          const found = new Set(results[i].map(r => r.name));
          for (const col of s.columns)
            if (!found.has(col)) missing.push(`coluna ${s.table}.${col}`);
        }
      });
      if (missing.length)
        problems.push(
          `${latest} consta como aplicada, mas o schema remoto não tem: ${missing.join(", ")}. O registro em d1_migrations não corresponde ao schema.`
        );
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    report,
    latest,
    schemaChecked,
    remoteCount: rows.length,
    localCount: localNames.length
  };
}

// ---------- CLI ----------
function databaseIdFromWrangler(file) {
  const toml = readFileSync(file, "utf8");
  const block = toml.split("[[d1_databases]]")[1]?.split(/\n\[/)[0] ?? "";
  return block.match(/database_id\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

export async function main(env = process.env) {
  const token = env.CLOUDFLARE_D1_READ_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId =
    env.D1_DATABASE_ID ||
    databaseIdFromWrangler(env.WRANGLER_TOML || path.join(root, "wrangler.toml"));
  if (!token) {
    throw new CheckError(
      EXIT.AUTH,
      "Secret CLOUDFLARE_D1_READ_TOKEN ausente ou vazio (environment production). Crie um token Cloudflare só com a permissão Account > D1 > Read e cadastre-o com esse nome; o CLOUDFLARE_API_TOKEN do deploy não é usado nesta verificação."
    );
  }
  if (!accountId || !databaseId) {
    throw new CheckError(
      EXIT.AUTH,
      "Faltam CLOUDFLARE_ACCOUNT_ID ou o database_id do D1 (wrangler.toml): verificação impossível."
    );
  }
  const client = makeClient({
    base: env.CF_API_BASE || "https://api.cloudflare.com/client/v4",
    accountId,
    databaseId,
    token,
    retries: Number(env.MIGRATION_CHECK_RETRIES || 3),
    delayMs: Number(env.MIGRATION_CHECK_DELAY_MS || 2000),
    timeoutMs: Number(env.MIGRATION_CHECK_TIMEOUT_MS || 15000)
  });
  return checkMigrations({
    client,
    migrationsDir: env.MIGRATIONS_DIR || path.join(root, "migrations")
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main();
    if (!result.ok) {
      console.error("::error::Deploy BLOQUEADO: as migrations do D1 de produção não estão em dia.");
      result.problems.forEach(p => console.error(`  - ${p}`));
      summary(["### Deploy bloqueado: migrations D1", "", ...result.problems.map(p => `- ${p}`)]);
      process.exit(EXIT.BLOCKED);
    }
    const r = result.report;
    console.log(
      `Migrations D1 em dia: ${result.localCount} arquivos, todos aplicados em produção (${r.legacy.length} legadas de 3 dígitos ignoradas; ${result.remoteCount} registros no total).`
    );
    console.log(
      result.schemaChecked
        ? `Schema conferido para a migration mais recente (${result.latest}).`
        : `Sem marcadores de schema a conferir em ${result.latest}.`
    );
    summary([
      "### Migrations D1 em dia",
      "",
      `${result.localCount} migrations locais aplicadas; schema de \`${result.latest}\` ${result.schemaChecked ? "conferido" : "sem marcadores"}.`
    ]);
  } catch (error) {
    const exitCode = error instanceof CheckError ? error.exitCode : EXIT.BAD_RESPONSE;
    console.error(
      `::error::Deploy BLOQUEADO: não foi possível confirmar as migrations do D1. ${error.message}`
    );
    (error.details ?? []).forEach(d => console.error(`  - ${d}`));
    summary(["### Deploy bloqueado: verificação de migrations D1 falhou", "", error.message]);
    process.exit(exitCode);
  }
}
