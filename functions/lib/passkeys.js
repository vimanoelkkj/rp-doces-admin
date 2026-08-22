import { randomToken } from "./auth.js";

const CHALLENGE_MINUTES = 5;

export function passkeyContext(request) {
  const url = new URL(request.url);
  return { origin: url.origin, rpID: url.hostname };
}

export function passkeyUserID(userId) {
  return new TextEncoder().encode(`admin:${userId}`);
}

export function parseTransports(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function publicKeyBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  throw new Error("Chave pública inválida.");
}

export async function savePasskeyChallenge(env, { userId, type, challenge, rpID, origin }) {
  const id = randomToken(24);
  const expires = new Date(Date.now() + CHALLENGE_MINUTES * 60000).toISOString();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_passkey_challenges WHERE expira_em <= ?").bind(now),
    env.DB.prepare(`
      INSERT INTO admin_passkey_challenges
        (id, usuario_id, tipo, challenge, rp_id, origin, expira_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, userId ?? null, type, challenge, rpID, origin, expires),
  ]);
  return id;
}

export async function consumePasskeyChallenge(env, { id, type, rpID, origin }) {
  if (typeof id !== "string" || id.length < 20 || id.length > 100) return null;
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT id, usuario_id, challenge, rp_id, origin
    FROM admin_passkey_challenges
    WHERE id=? AND tipo=? AND rp_id=? AND origin=? AND expira_em>?
    LIMIT 1
  `).bind(id, type, rpID, origin, now).first();
  if (!row) return null;

  const claimed = await env.DB.prepare(`
    DELETE FROM admin_passkey_challenges
    WHERE id=? AND tipo=? AND rp_id=? AND origin=? AND expira_em>?
  `).bind(id, type, rpID, origin, now).run();
  return Number(claimed.meta?.changes || 0) === 1 ? row : null;
}

export function passkeyError(error, fallback = "Não foi possível validar a biometria.") {
  console.warn(JSON.stringify({ event: "passkey_error", message: String(error?.message || error) }));
  return fallback;
}
