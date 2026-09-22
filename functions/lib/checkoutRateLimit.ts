/// <reference types="@cloudflare/workers-types" />

import { sha256 } from "./auth";

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 6;
const CLEANUP_GRACE_SECONDS = 5 * 60;

interface RateLimitRow {
  tentativas: number;
}

function clientIp(request: Request): string {
  // Em produção, a Cloudflare fornece este header na borda.
  // Não usamos X-Forwarded-For como fallback para não aceitar um valor
  // facilmente falsificável como identidade do cliente.
  return request.headers.get("CF-Connecting-IP")?.trim() || "local";
}

export async function checkCheckoutRateLimit(
  db: D1Database,
  request: Request,
  nowMs = Date.now(),
): Promise<{ allowed: boolean; retryAfter: number; count: number }> {
  const nowSec = Math.floor(nowMs / 1000);
  const bucket = Math.floor(nowSec / WINDOW_SECONDS);
  const bucketEnd = (bucket + 1) * WINDOW_SECONDS;
  const retryAfter = Math.max(1, bucketEnd - nowSec);
  const key = await sha256(`checkout:${clientIp(request)}:${bucket}`);
  const expiresAt = bucketEnd + CLEANUP_GRACE_SECONDS;

  const row = await db
    .prepare(
      `INSERT INTO checkout_rate_limits (chave, tentativas, expira_em, atualizado_em)
       VALUES (?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chave) DO UPDATE SET
         tentativas = checkout_rate_limits.tentativas + 1,
         atualizado_em = CURRENT_TIMESTAMP
       RETURNING tentativas`,
    )
    .bind(key, expiresAt)
    .first<RateLimitRow>();

  const count = Number(row?.tentativas ?? 1);

  // Limpeza probabilística pequena para a tabela não crescer para sempre.
  // A decisão do rate limit acima não depende desta limpeza.
  if (crypto.getRandomValues(new Uint8Array(1))[0] < 13) {
    try {
      await db
        .prepare(`DELETE FROM checkout_rate_limits WHERE expira_em < ?`)
        .bind(nowSec)
        .run();
    } catch (err) {
      console.warn("Falha ao limpar rate limit do checkout", err);
    }
  }

  return {
    allowed: count <= MAX_ATTEMPTS,
    retryAfter,
    count,
  };
}
