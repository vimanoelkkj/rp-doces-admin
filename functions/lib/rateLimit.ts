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

export async function recordLoginFailure(
  db: D1Database,
  key: string,
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  const row = await db
    .prepare(
      `SELECT falhas, janela_inicio FROM auth_rate_limits WHERE chave = ?`,
    )
    .bind(key)
    .first<RateLimitRow>();

  let failures = 1;
  let windowStart = nowIso;

  if (row) {
    const startMs = Date.parse(row.janela_inicio);
    if (Number.isFinite(startMs) && now.getTime() - startMs <= WINDOW_MS) {
      failures = row.falhas + 1;
      windowStart = row.janela_inicio;
    }
  }

  const blockedUntil =
    failures >= MAX_FAILURES
      ? new Date(now.getTime() + BLOCK_MS).toISOString()
      : null;

  await db
    .prepare(
      `INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chave) DO UPDATE SET
         falhas = excluded.falhas,
         janela_inicio = excluded.janela_inicio,
         bloqueado_ate = excluded.bloqueado_ate,
         atualizado_em = CURRENT_TIMESTAMP`,
    )
    .bind(key, failures, windowStart, blockedUntil)
    .run();
}

export async function clearLoginFailures(
  db: D1Database,
  key: string,
): Promise<void> {
  await db.prepare(`DELETE FROM auth_rate_limits WHERE chave = ?`).bind(key).run();
}
