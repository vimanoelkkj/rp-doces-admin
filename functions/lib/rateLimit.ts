/// <reference types="@cloudflare/workers-types" />

import { sha256 } from "./auth";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

interface RateLimitRow {
  falhas: number;
  janela_inicio: string;
  bloqueado_ate: string | null;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function keyFor(request: Request, username: string): Promise<string> {
  return sha256(`${clientIp(request)}|${username.toLowerCase()}`);
}

export async function checkLoginRateLimit(
  db: D1Database,
  request: Request,
  username: string,
): Promise<{ allowed: boolean; key: string; retryAfter?: number }> {
  const key = await keyFor(request, username);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT falhas, janela_inicio, bloqueado_ate FROM auth_rate_limits WHERE chave = ?`,
    )
    .bind(key)
    .first<RateLimitRow>();

  if (!row) return { allowed: true, key };

  const blockedUntil = row.bloqueado_ate ? Date.parse(row.bloqueado_ate) : 0;
  if (blockedUntil > now) {
    return {
      allowed: false,
      key,
      retryAfter: Math.max(1, Math.ceil((blockedUntil - now) / 1000)),
    };
  }

  return { allowed: true, key };
}

export const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;

export async function cleanupStaleLoginRateLimits(
  db: D1Database,
  nowMs = Date.now(),
): Promise<number> {
  const cutoffIso = new Date(nowMs - CLEANUP_RETENTION_MS).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const result = await db
    .prepare(
      `DELETE FROM auth_rate_limits
       WHERE julianday(atualizado_em) < julianday(?)
         AND (
           bloqueado_ate IS NULL
           OR julianday(bloqueado_ate) <= julianday(?)
         )`,
    )
    .bind(cutoffIso, nowIso)
    .run();

  return result.meta?.changes ?? 0;
}

// Uma única instrução atômica: o próximo número de falhas, o início da janela
// e o bloqueio são decididos pelo SQL sobre o estado ATUAL da linha, sem
// SELECT prévio. Antes, SELECT -> +1 em JS -> UPSERT perdia incrementos sob
// tentativas concorrentes (duas leituras de 4 gravavam 5, e não 6).
//
// Janela válida: janela_inicio >= agora - WINDOW (mesmo significado de antes;
// data ilegível vira NULL no julianday e reinicia a janela). No UPDATE do
// SQLite, todas as expressões do SET leem os valores ANTERIORES da linha, então
// o bloqueio é calculado a partir da mesma contagem que está sendo gravada.
export async function recordLoginFailure(
  db: D1Database,
  key: string,
): Promise<void> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const windowCutoffIso = new Date(nowMs - WINDOW_MS).toISOString();
  const blockedUntilIso = new Date(nowMs + BLOCK_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
       VALUES (?1, 1, ?2, CASE WHEN 1 >= ?4 THEN ?3 ELSE NULL END, CURRENT_TIMESTAMP)
       ON CONFLICT(chave) DO UPDATE SET
         falhas = CASE
           WHEN julianday(auth_rate_limits.janela_inicio) >= julianday(?5)
             THEN auth_rate_limits.falhas + 1
           ELSE 1
         END,
         janela_inicio = CASE
           WHEN julianday(auth_rate_limits.janela_inicio) >= julianday(?5)
             THEN auth_rate_limits.janela_inicio
           ELSE ?2
         END,
         bloqueado_ate = CASE
           WHEN (CASE
                   WHEN julianday(auth_rate_limits.janela_inicio) >= julianday(?5)
                     THEN auth_rate_limits.falhas + 1
                   ELSE 1
                 END) >= ?4
               THEN ?3
           ELSE NULL
         END,
         atualizado_em = CURRENT_TIMESTAMP`,
    )
    .bind(key, nowIso, blockedUntilIso, MAX_FAILURES, windowCutoffIso)
    .run();

  if (crypto.getRandomValues(new Uint8Array(1))[0] < 13) {
    try {
      await cleanupStaleLoginRateLimits(db, nowMs);
    } catch (err) {
      console.warn("Falha ao limpar rate limit de login", err);
    }
  }
}

export async function clearLoginFailures(
  db: D1Database,
  key: string,
): Promise<void> {
  await db.prepare(`DELETE FROM auth_rate_limits WHERE chave = ?`).bind(key).run();
}
