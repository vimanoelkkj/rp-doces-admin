import { sha256 } from "./auth.js";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
         request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
         "unknown";
}

async function keyFor(request, username) {
  return await sha256(`${clientIp(request)}|${String(username || "").toLowerCase()}`);
}

export async function checkLoginRateLimit(env, request, username) {
  const key = await keyFor(request, username);
  const now = Date.now();
  const row = await env.DB.prepare(`
    SELECT falhas, janela_inicio, bloqueado_ate
    FROM auth_rate_limits WHERE chave = ? LIMIT 1
  `).bind(key).first();

  if (!row) return { allowed: true, key };

  const blockedUntil = row.bloqueado_ate ? Date.parse(row.bloqueado_ate) : 0;
  if (blockedUntil > now) {
    return {
      allowed: false,
      key,
      retryAfter: Math.max(1, Math.ceil((blockedUntil - now) / 1000))
    };
  }

  const windowStart = Date.parse(row.janela_inicio);
  if (!Number.isFinite(windowStart) || now - windowStart > WINDOW_MS) {
    await env.DB.prepare("DELETE FROM auth_rate_limits WHERE chave = ?").bind(key).run();
  }

  return { allowed: true, key };
}

export async function recordLoginFailure(env, key) {
  const now = new Date();
  const nowIso = now.toISOString();

  const row = await env.DB.prepare(`
    SELECT falhas, janela_inicio FROM auth_rate_limits WHERE chave = ? LIMIT 1
  `).bind(key).first();

  let failures = 1;
  let windowStart = nowIso;

  if (row) {
    const startMs = Date.parse(row.janela_inicio);
    if (Number.isFinite(startMs) && now.getTime() - startMs <= WINDOW_MS) {
      failures = Number(row.falhas || 0) + 1;
      windowStart = row.janela_inicio;
    }
  }

  const blockedUntil = failures >= MAX_FAILURES
    ? new Date(now.getTime() + BLOCK_MS).toISOString()
    : null;

  await env.DB.prepare(`
    INSERT INTO auth_rate_limits (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chave) DO UPDATE SET
      falhas=excluded.falhas,
      janela_inicio=excluded.janela_inicio,
      bloqueado_ate=excluded.bloqueado_ate,
      atualizado_em=CURRENT_TIMESTAMP
  `).bind(key, failures, windowStart, blockedUntil).run();
}

export async function clearLoginFailures(env, key) {
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE chave = ?").bind(key).run();
}
