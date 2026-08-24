const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 6;

/**
 * Extrai o endereço IP da requisição de forma segura para Cloudflare Pages / Workers.
 * Em produção na borda, CF-Connecting-IP é autenticado pela Cloudflare e infalsificável.
 * Em testes/local, utiliza fallback determinístico para "127.0.0.1".
 */
export function extractClientIp(request) {
  const cfIp = request?.headers?.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  return "127.0.0.1";
}

/**
 * Gera assinatura HMAC-SHA-256 para pseudonimização do IP e bucket no banco.
 */
export async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Limpeza probabilística isolada de registros de rate limit expirados.
 * Executada de forma assíncrona para não atrasar a resposta nem interferir na decisão de rate limit.
 */
async function triggerLazyCleanup(env, nowSec) {
  try {
    if (Math.random() < 0.05) {
      await env.DB.prepare("DELETE FROM checkout_rate_limits WHERE expira_em < ?")
        .bind(nowSec)
        .run();
    }
  } catch (err) {
    console.warn("Falha no cleanup de rate limit:", err?.message);
  }
}

/**
 * Verifica e incrementa atomicamente o contador de rate limit de checkout para o IP da requisição.
 *
 * @param {object} env - Cloudflare environment (env.DB, env.RATE_LIMIT_SECRET, etc.)
 * @param {Request} request - Requisição HTTP recebida
 * @param {number} [overrideTimestamp] - Timestamp opcional em ms para testes determinísticos
 * @returns {Promise<{
 *   allowed: boolean,
 *   retryAfter: number,
 *   count: number,
 *   misconfigured?: boolean
 * }>}
 */
export async function checkCheckoutRateLimit(env, request, overrideTimestamp = null) {
  if (!env?.RATE_LIMIT_SECRET) {
    console.error("RATE_LIMIT_SECRET não configurado no ambiente.");
    return {
      allowed: false,
      misconfigured: true,
      retryAfter: 60,
      count: 0
    };
  }

  const clientIp = extractClientIp(request);
  const nowMs = overrideTimestamp !== null ? overrideTimestamp : Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const bucket = Math.floor(nowSec / WINDOW_SECONDS);
  const expiraEm = (bucket + 1) * WINDOW_SECONDS + 60; // Expira após o término da janela + margem
  const retryAfter = Math.max(1, (bucket + 1) * WINDOW_SECONDS - nowSec);

  const chave = await hmacSha256(env.RATE_LIMIT_SECRET, `checkout:${clientIp}:${bucket}`);

  // Execução atômica no banco com UPSERT e RETURNING
  const row = await env.DB.prepare(
    `
    INSERT INTO checkout_rate_limits (chave, tentativas, expira_em)
    VALUES (?, 1, ?)
    ON CONFLICT(chave) DO UPDATE SET
      tentativas = tentativas + 1
    RETURNING tentativas
  `
  )
    .bind(chave, expiraEm)
    .first();

  const count = Number(row?.tentativas || 1);
  const allowed = count <= MAX_ATTEMPTS;

  // Dispara cleanup leve em segundo plano (sem aguardar e sem travar o checkout)
  triggerLazyCleanup(env, nowSec);

  return {
    allowed,
    retryAfter,
    count
  };
}
